# Nuestra planta por municipio: cómo provisionar, cómo escala y qué cuesta

> La centralita propia, multi-instancia. Cómo dar de alta un municipio, por
> qué los puertos se reparten solos, qué hace falta comprarle a quién, y qué
> falta todavía.
>
> Escrito el 19/10/2026, después de la primera llamada real de punta a punta:
> un celular colombiano → Infobip → nuestro Asterisk → el navegador del
> operador, con audio por los dos lados.
>
> El montaje manual que llevó hasta ahí está en
> [`telefonia-asterisk-propio.md`](telefonia-asterisk-propio.md). Este
> documento es lo que vino después: convertir ese montaje en algo que se repite
> sin terminal.

---

## 1. La arquitectura, en una frase

**Un contenedor de Asterisk por municipio, sobre un servidor compartido, en la
red del host, con nginx delante repartiendo por nombre.**

Cada pieza de esa frase es una decisión, y conviene saber de qué protege:

| Decisión | De qué protege | Qué cuesta |
|---|---|---|
| **Un contenedor por municipio** | Que un `extensions.conf` mal editado tumbe la línea del 123 de otro municipio. El peor caso pasa a ser un municipio sin teléfono, no todos | Hay que repartir puertos; ~100 MB de RAM por planta |
| **Servidor compartido** | Un servidor por municipio es una factura y una actualización de sistema por municipio | El reparto de puertos es finito: 24 plantas por servidor con el plan actual |
| **Red del host** | Publicar cientos de puertos RTP por el NAT de Docker es inviable, y el SIP que ORIGINA la planta saldría con un puerto de origen que el SBC del operador rechaza con 403 | Los puertos son del host: tienen que ser únicos, y de ahí el asignador |
| **nginx por nombre** | Un puerto abierto en la nube y un certificado por municipio vendido | Un comodín (`*.falconcad.com.co`) y un subdominio por planta |

El aislamiento que se busca es el de la **configuración**, no el de la red.

---

## 2. Lo que FALCON guarda, y lo que no

Tres tablas nuevas, y una que ya existía:

- **`planta_asterisk`** — la infraestructura: servidor, IP pública, nombre
  (lo que enruta nginx), puerto SIP, tajada RTP, puerto HTTP/ARI, estado.
  Una por instancia.
- **`pbx_troncal`** — por dónde entra la llamada: operador, SBC, puerto,
  autenticación (IP / registro / digest), credenciales, subredes, canales.
  Varias por instancia, con prioridad, para tener respaldo con otro operador.
- **`pbx_numero`** — lo que marca el ciudadano: el DID en E.164 o el número
  corto, y a dónde entra (la cola o una extensión).
- **`config_pbx`** (ya existía) — **cómo le habla FALCON a la planta**, sea
  nuestra o de un tercero. Lo escribe la planta al provisionarse: nadie copia
  el dominio de una pantalla a la otra, porque eso se desincroniza el día que
  se migra de servidor y el síntoma es un softphone «conectando» para siempre.

**Dos unicidades que no son simetría:** `(tenant, numero)` siempre, y `(numero)`
**solo para los DID**. Un DID es único en el planeta —si dos instancias dicen
tener el mismo, una se equivocó y una emergencia va a timbrar en el municipio
vecino—; el 123 de Itagüí y el de Envigado son legítimamente el mismo número.

---

## 3. El reparto de puertos

Lo decide una función pura y probada (`backend/src/pbx/planta/asignador-puertos.ts`),
no el ojo de quien instala. Entra lo que ya está ocupado en ese servidor y sale
la primera ranura libre, con los tres puertos derivados del MISMO número de
ranura para poder auditar el servidor de un vistazo:

| Ranura | SIP (udp) | RTP (udp) | HTTP/ARI (127.0.0.1) |
|---|---|---|---|
| 0 | 5060 | 20500–20999 | 8100 |
| 1 | 5061 | 21000–21499 | 8101 |
| … | … | … | … |
| 23 | 5083 | 32000–32499 | 8123 |

Y las bandas no son arbitrarias:

- **RTP arranca en 20500** para no cruzarse con el 10000–20000 por defecto de
  Asterisk, que es donde corre la centralita que montamos a mano.
- **RTP termina en 32499** porque desde 32768 el kernel reparte puertos a
  cualquier socket saliente (`net.ipv4.ip_local_port_range`). Un rango ahí
  arriba funciona semanas hasta que un `curl` le gana el puerto y se cae el
  audio de UNA llamada, sin dejar rastro en ningún log.
- **HTTP arranca en 8100**, por encima del 8088 de `secad-api`. Ese choque ya
  nos pasó: Asterisk no pudo tomar el 8088 y el síntoma fue un «Server
  Disabled» que se llevó también el WebSocket del softphone.
- **500 puertos por planta** son 250 llamadas simultáneas, contra los 10
  canales que da una troncal. Sobra por un factor de 25.

La base lo respalda con lo que una función no puede: únicos
`(servidor, puertoSip)` y `(servidor, puertoHttp)`, y una **restricción de
exclusión** que prohíbe que dos tajadas RTP se CRUCEN en el mismo servidor —el
fallo más caro, porque no impide arrancar: deja audio de un municipio entrando
por el puerto de otro—.

---

## 4. Provisionar un municipio, paso a paso

Todo lo que sigue se hace en **Plataforma → Nuestras centralitas**, salvo los
dos pasos marcados con 🖐, que viven fuera de FALCON.

1. **La instancia existe** (Plataforma → Instancias) y tiene la integración
   `pbx` habilitada.
2. **Los funcionarios tienen extensión** (Administración → Funcionarios). La
   clave SIP **no** hay que inventarla: la genera FALCON al aplicar. Las
   extensiones son únicas por instancia, y ahora también a nivel de base.
3. **Dar de alta la planta**: instancia, servidor y —si el servidor es un
   nombre y no una IP— la IP pública. El nombre de la planta se deriva
   (`<instancia>-pbx.falconcad.com.co`) y los puertos se reservan solos. Queda
   en **borrador**: la fila existe y nadie puede llevarse esos puertos, pero el
   contenedor todavía no.
4. **La troncal**: operador, SBC, puerto y autenticación. Con autenticación por
   IP —la troncal estática de Infobip— hay que registrar **las subredes del
   SBC**: sin ellas no hay `identify`, y sin `identify` la troncal no recibe
   nada. La pantalla lo marca en rojo.
5. **El número**: el DID en E.164 (se normaliza al guardar) y a dónde entra. Lo
   normal es «la cola».
6. **Ver la configuración** para revisarla. No toca nada y las claves aparecen
   sustituidas.
7. **Aplicar**. Genera los archivos de verdad, crea las claves SIP que falten,
   la de ARI si es la primera vez, y **renueva la API key de la instancia**
   —FALCON guarda su digest, no la clave, así que no hay forma de reutilizar la
   actual—. Mientras los archivos no estén instalados, la central no puede
   avisar de las llamadas.
8. **Llevar `aplicar.sh` al servidor y ejecutarlo**:
   ```bash
   scp aplicar.sh ubuntu@<servidor>:/tmp/
   ssh ubuntu@<servidor> 'sudo bash /tmp/aplicar.sh && shred -u /tmp/aplicar.sh'
   ```
   Escribe los diez archivos con sus permisos, enlaza el sitio de nginx, lo
   PRUEBA antes de recargar —un nginx que no arranca se lleva a los otros
   municipios del servidor—, levanta el contenedor y comprueba transportes,
   troncal, cola y que `chan_sip` quedó descargado. **Lleva todas las claves de
   la planta dentro: hay que borrarlo al terminar.**
9. 🖐 **Abrir en la nube** el puerto SIP y la tajada RTP de esa planta (udp).
   Eso vive en la consola del proveedor y no en un script.
10. 🖐 **Decirle al operador** a qué IP y puerto entregar las llamadas. En
    Infobip: *Troncales SIP → la troncal → Host de destino*, donde el puerto
    **es editable**.
11. **Encender la barra** en FALCON con un operador y llamar al número. Si algo
    falla, la lista de «qué le falta a esta planta» y los archivos en pantalla
    son el primer sitio donde mirar.

**En el servidor de telefonía no hay nada que actualizar con `git`.** La
configuración la genera FALCON y el paquete trae todo lo que hace falta —
incluido el `Dockerfile`, que `aplicar.sh` construye la primera vez—. Lo único
que viaja a ese servidor es `aplicar.sh`.

Lo que sí es por servidor y una sola vez: el **certificado comodín** y el
registro DNS de cada `<instancia>-pbx`. Sin el nombre y el certificado, el
navegador del operador no puede registrarse —entra por nginx en el 443, por
nombre— y la planta queda sin softphone aunque la troncal funcione.

---

## 5. La cola de operadores

Una por municipio (`cola-<instancia>`), con los funcionarios que tengan
extensión como miembros. Tres decisiones que no son las de un centro de
atención comercial:

- **`ringall`** — timbra en TODOS los puestos y atiende el primero que pueda.
  En atención comercial se reparte parejo para que nadie trabaje más que otro;
  en una línea de emergencias manda el tiempo de respuesta.
- **`joinempty = yes`** — la llamada entra aunque no haya nadie conectado.
  Rechazar una emergencia porque el turno no se ha conectado es peor que
  dejarla timbrando mientras alguien entra.
- **Timbre, no música** (opción `r` de `Queue()`) — el timbre es lo que le dice
  al ciudadano que su llamada está viva.

El aviso que la central le manda a FALCON cuando la llamada entra a la cola va
**sin extensión**, y es correcto: todavía no se sabe quién va a contestar. La
barra de cada operador reconoce su llamada por el número y quien contesta
primero la reclama.

---

## 6. Escalar: qué se comparte y qué no

| Pieza | ¿Compartida? | Por qué |
|---|---|---|
| Servidor | Sí, hasta 24 plantas | Una factura, una actualización de sistema |
| Imagen de Docker | Sí, una por servidor | Si fuera por municipio, actualizar Asterisk sería un trabajo por municipio |
| Certificado | Sí, un comodín | Un certificado por municipio es un trámite por venta |
| nginx | Sí, un sitio por planta | El nombre decide a qué contenedor entra cada operador |
| **Troncal** | **No, una por municipio** | Los canales son un cupo: una troncal de 10 compartida entre tres municipios deja a dos sin línea en una emergencia grande. Y la factura es del municipio: compartirla nos convierte en revendedores de minutos |
| **Número (DID)** | **No, uno por municipio** | Es lo que el ciudadano marca, y es lo que identifica de quién es la llamada. Deducirlo de otra cosa es mandar una emergencia a la sala del municipio vecino |
| Cola y extensiones | No | Son del municipio |

**La troncal por municipio es además lo que simplifica todo lo demás:** si cada
uno entra por la suya, no hay que deducir de quién es una llamada. Llegó por su
troncal, es suya.

### El modelo de negocio, en los términos de esto

- El municipio contrata y paga **su** troncal y **su** número. Son su línea y
  su factura, igual que hoy pagan la del operador local.
- Nosotros cobramos **la plataforma y la operación de la planta**: el servidor,
  la configuración, el soporte y el módulo. Eso es lo que hoy le pagan a un
  tercero por una barra CTI, y es lo que una alcaldía entiende como servicio.
- Los minutos no pasan por nuestra factura. Es deliberado: facturar minutos
  trae cartera, riesgo y una contabilidad que no es nuestro negocio.

---

## 7. La grabación de la llamada

Graba `MixMonitor` con la opción `b` —solo cuando la llamada queda
establecida, así no quedan cientos de archivos de cero segundos— y al terminar
dispara `subir-grabacion.sh`, que la **sube a FALCON**. Queda como **archivo
del caso**, con `origen = GRABACION` y atada a la llamada.

**No es una URL, y esa es la decisión.** `casos.urlGrabacion` se queda para una
central ajena, que graba en su almacenamiento y entrega un enlace. Para la
planta propia no sirve: el archivo lo tiene nuestro contenedor en un volumen al
que nadie llega desde internet. Entrando por `archivos` hereda cuatro cosas que
una URL no da: el permiso `casos.ver_grabaciones`, el archivado al
almacenamiento de objetos sin borrar nada, el SHA-256 calculado antes de
liberar los bytes —lo que permite demostrar años después que lo que se oye es
byte a byte lo que se grabó— y el barrido de subidas cortadas.

Lo que hay que saber al operar:

- **La planta empuja; FALCON no va a buscar.** La planta solo tiene abierto el
  puerto SIP hacia fuera, y abrirle uno para que FALCON le lea archivos sería
  abrir una puerta para leer archivos del servidor. Usa el mismo `curl` con la
  API key de la instancia que el dialplan, pero con **otro archivo de
  credencial** (`falcon-api.conf`): el del webhook fija
  `Content-Type: application/json`, que rompería el multipart.
- **Solo borra el archivo local cuando FALCON confirma.** Si la subida falla
  —la red, FALCON caído, un caso que todavía no existe— el WAV se queda en la
  planta y queda anotado en `/var/log/asterisk/falcon-grabaciones.log`. Un
  archivo que sobra se ve; uno borrado no vuelve.
- **Dos negativas son situaciones normales**, no errores: que la llamada no
  esté en FALCON (la central atendió algo de lo que FALCON no se enteró) y que
  la llamada no haya quedado en un caso (el operador contestó y no guardó). En
  `archivos` no hay archivos sueltos, y esa invariante no se rompe por una
  grabación.
- **Comprime si puede.** Con `lame` en la imagen, un minuto de llamada pasa de
  ~960 KB (WAV de 8 kHz) a ~180 KB. Sin `lame` sube el WAV igual.
- **El reintento no duplica.** Un único parcial en la base garantiza una sola
  grabación por llamada, excluyendo los `FALLIDO` para que un intento cortado
  no bloquee al que sí va a funcionar.
- **Las salientes se graban pero no se suben.** FALCON todavía no registra la
  saliente como llamada propia, así que no habría a qué atarla; quedan en el
  volumen de la planta. Es la razón por la que ese volumen hay que vigilarlo.

En FALCON se oye en la ficha del caso, con cuatro estados: por oír, sonando,
«en el archivo permanente» —existe e íntegra, con el nombre que hay que pedirle
al administrador— y «subida incompleta», que significa que el archivo sigue en
la centralita.

---

## 8. Si contestar tarda

El síntoma: el operador oprime **Contestar**, no pasa nada, y la llamada se
conecta cinco o seis segundos después. Pasó en la primera prueba con la línea
de Infobip, y la causa no es la troncal.

**Dónde se van esos segundos.** SIP no manda candidatos ICE a cuentagotas como
el navegador: la respuesta SDP sale UNA vez, con los candidatos que haya, así
que SIP.js espera a que el navegador termine de recolectarlos antes de
contestar. Su tope por defecto son **5000 ms**, y se agotan enteros cuando la
recolección no termina — y no termina cuando algún servidor ICE no contesta: el
navegador reintenta con espera creciente hasta rendirse.

Lo que se hizo:

- **El tope bajó a 1500 ms** (`ESPERA_ICE_MS`). No menos: si se contesta antes
  de tener el candidato público (srflx), la central solo recibe direcciones
  privadas y la llamada se establece **sin audio**, que es peor que lenta.
- **La barra reacciona en el acto** («Contestando… · conectando el audio», el
  botón deshabilitado). El retraso es de red, pero «parece que no hice nada» es
  de la interfaz.
- **Un solo intento por llamada.** Insistir llamaba a `answer()` sobre una
  sesión que ya no estaba entrando; SIP.js lo rechazaba y ese rechazo abortaba
  el resto del contestar — el que reclama la llamada en la cola. Insistir podía
  dejar la llamada contestada y sin tomar.
- **Las credenciales de TURN se leen en cada llamada**, no al encender la
  barra. Van firmadas con vencimiento y la barra se queda encendida todo el
  turno: con un valor congelado, a media jornada el relevo contesta «no
  autorizado» y el navegador se queda reintentando.

**Qué falta por averiguar: CUÁL servidor ICE no contesta.** No está medido, y
conviene no dar por buena una causa que no se comprobó. Los candidatos: el
coturn no alcanzable desde la red de la sala, una credencial vencida (ya
mitigado), o una URL de TURN sobre TLS/TCP filtrada.

Cómo saberlo, en la próxima llamada:

1. En la consola del navegador del operador: `[softphone] contestar tardó N ms`.
   Si son ~1500 ms, es la recolección y sigue faltando el servidor que no
   contesta. Si son ~100 ms y el audio igual tarda, **el que tarda es la central
   o la troncal**, y hay que mirar allá.
2. En `chrome://webrtc-internals`, durante la llamada: qué candidato se quedó
   esperando y cuál ganó.
3. Si el relevo no se usa nunca, revisar que el rango de relevo del coturn esté
   abierto en el cortafuegos de la nube. Hoy **no lo está** en el servidor de
   pruebas; en producción no se ha medido.

---

## 9. Qué falta

Por orden de lo que más duele:

1. **Un número de respaldo para la cola**: si nadie contesta en X segundos,
   timbrar a un celular. Hoy el ciudadano oye timbre hasta que la cola se rinde.
2. **El diagnóstico desde la pantalla**: «¿está viva la troncal?», «¿quién está
   registrado?» —hoy eso se ve con `pjsip show aors` por SSH—.
3. **Aplicar por SSH desde FALCON**, para no copiar el script a mano.
4. **La saliente como llamada propia de FALCON**, que es lo que falta para
   poder subir también su grabación.
5. **Puertos reservados por servidor**: hoy el asignador solo sabe de las
   plantas, no de los otros servicios del host. Las bandas se eligieron lejos
   de lo que sabemos que hay (coturn en el 3478, `secad-api` en el 8088), y los
   puertos se pueden poner a mano cuando haga falta, pero el servidor no lo
   declara en ninguna parte.
6. **La imagen no se ha construido todavía en ningún servidor.** Es lo primero
   a comprobar al aplicar.

Y de la deuda que viene de antes: el rango de relevo de coturn sigue cerrado en
los dos servidores (la videollamada funciona porque nunca ha necesitado
relevo), y las credenciales que se expusieron en pruebas siguen pendientes de
rotar.
