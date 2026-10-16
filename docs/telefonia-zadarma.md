# Zadarma en FALCON CAD

Cómo se conecta la centralita de Zadarma, qué está hecho, qué falta, y qué hay
que tocar en su panel.

> **Zadarma es UNA planta, no el modelo.** FALCON trata a todos los
> proveedores de telefonía por el mismo puerto: cada uno declara qué sabe
> hacer y qué credenciales pide, y el camino del aviso —instancia, encendido,
> firma, traducción, cola, bitácora— es uno solo. Cómo se da de alta un
> proveedor nuevo está en
> [`telefonia-proveedores.md`](telefonia-proveedores.md); esta página es el
> detalle de Zadarma.

> **Para qué sí, y para qué todavía no.** Esto convierte a Zadarma en la planta
> telefónica de una instancia de FALCON: las llamadas entran a la cola de
> Recepción, se dirigen al operador que tiene esa extensión y quedan en el
> registro. Es exactamente el banco de pruebas que recomienda
> [`telefonia-cadena-de-la-llamada.md`](telefonia-cadena-de-la-llamada.md) §9.
>
> Ese documento dejaba dos objeciones abiertas —residencia de datos en
> Colombia y enrutamiento del 1XY— y **las dos quedaron resueltas como
> decisión de negocio el 15/10/2026**, no como hallazgo técnico: por ahora no
> condicionan el trabajo. El enrutamiento del 123, además, nunca pasó por
> Zadarma: llega por troncal SIP a través del proveedor del municipio —ver
> §1.1—. Conviene volver a mirarlas antes de firmar un 123 de producción,
> porque una decisión comercial puede cambiar y un requisito regulatorio no.

---

## 1. Qué hace cada pieza

| Eslabón | Quién lo pone |
|---|---|
| Número que marca el ciudadano (DID) | Zadarma |
| Troncal y transporte del audio | Zadarma |
| Centralita, colas, IVR | Zadarma (su «centralita virtual») |
| Teléfono del operador | Hoy: softphone (MicroSIP) o teléfono IP. Mañana: dentro de FALCON, por WebRTC |
| Aviso de la llamada, cola, caso, informes | **FALCON** |
| Grabación | Zadarma graba; FALCON la descargará y la pegará al caso (pendiente) |

FALCON **no enruta**: quién recibe cada llamada lo decide la centralita. Lo que
FALCON hace es traducir «se la estoy ofreciendo a la extensión 101» a «avísale
a Juan Pérez, que es el dueño de la 101».

### 1.1 De dónde sale el número de cada municipio

Esta es la parte comercial, y explica por qué el 1XY no es un problema de
Zadarma. Hay **tres casos**, y cada municipio cae en uno:

| Caso | Qué tiene el municipio | Qué hay que hacer |
|---|---|---|
| **A** | Piloto **123** | Pedirle a su operador que la **troncal física pase a troncal SIP en la nube**. Con eso, todas las llamadas del 123 de ese municipio se pueden entregar a la plataforma de comunicaciones, y de ahí bajan a FALCON |
| **B** | Sin 123, pero con **línea fija o WhatsApp** | El número de WhatsApp se **absorbe** en la plataforma: en vez de vivir en el celular de alguien, queda asociado a la barra y la llamada entra directo a FALCON (ya probado). Una línea fija es igual que el caso A: hay que pasarla a troncal SIP |
| **C** | **Nada** (ni 123, ni fija, ni WhatsApp) | Nosotros le damos el número en la nube —fijo o WhatsApp— como **servicio facturable**, y ese pasa a ser el número del municipio |

Lo que FALCON ve es lo mismo en los tres: una llamada entrante con su número.
La diferencia es de quién es la troncal y quién factura.

**Dónde encaja Zadarma:** es la pieza del caso **C** —el número en la nube que
podemos dar nosotros— y, mientras tanto, el banco de pruebas de toda la
cadena. El caso A no depende de ella: ahí el 123 entra por la troncal SIP del
operador del municipio.

> **Y sobre YACO, para no confundirse.** La integración **CTI / YACO (barra
> embebida)** —la de [`integracion-cti-yaco.md`](integracion-cti-yaco.md)—
> está en FALCON **solo como esqueleto**: el proveedor todavía no ha
> desarrollado la barra. Las llamadas que hoy llegan de YACO entran por la
> integración **Planta telefónica (PBX)**, el mismo webhook genérico que usa
> esta página, no por la de CTI. YACO sigue siendo quien controla la llamada y
> quien la baja a FALCON; lo que se construye aquí es la alternativa.

---

## 2. Lo que ya está hecho

- `POST /api/pbx/zadarma/:clave` — recibe los eventos de la centralita.
- Responde la validación `zd_echo` del panel (por GET y por POST).
- Verifica la **firma** de cada evento (`Signature`), que es lo único que
  autentica: la llave de la URL solo elige de qué instancia se habla.
- Traduce la secuencia de Zadarma al modelo de llamada de FALCON, el mismo que
  usa la planta actual:

  | Evento de Zadarma | Qué hace FALCON |
  |---|---|
  | `NOTIFY_START` | La llamada entra a la cola y empieza a sonar en pantalla |
  | `NOTIFY_INTERNAL` | La misma llamada, ya dirigida a una extensión → se le avisa a ese operador |
  | `NOTIFY_ANSWER` | Anota quién descolgó (no abre el caso: eso lo hace el operador al «atender») |
  | `NOTIFY_END`, `NOTIFY_INTERNAL_END`, `NOTIFY_OUT_END` | Cierran la llamada que nombra su `pbx_call_id`, si queda alguna abierta. Si la central dice `answered`, **no** se cuenta como perdida. Ver *El fin de la llamada no tiene un solo nombre* |
  | `NOTIFY_OUT_START` | Saliente: queda en la bitácora, no entra a la cola |
  | `NOTIFY_RECORD` | Todavía no se usa (ver *Lo que falta*) |

- **Contestar DENTRO de FALCON** (softphone propio, SIP sobre WebSocket): el
  operador descuelga en la misma pantalla donde escribe el caso, y con ese
  mismo clic la llamada de la cola queda **tomada para él** —desaparece de la
  cola de los demás— y su número viaja a Recepción. Un gesto en vez de dos
  programas.
  - Se enciende a mano (botón *Encender* en el panel del teléfono): registrarse
    toma el micrófono y hace que la central empiece a entregarle llamadas a ese
    navegador, y eso no debe pasarle a quien entró a consultar un caso.
  - **Hace falta configurar tres cosas**: el *WebSocket SIP* y el *Dominio SIP*
    de la instancia (Plataforma → Planta telefónica) y la **clave SIP de cada
    extensión** (Administración → Usuarios, botón *SIP* al lado de la
    extensión). Sin eso el panel dice exactamente qué falta y la telefonía
    sigue funcionando igual: se contesta en el teléfono de siempre.
  - La clave SIP **sí baja al navegador**, y es inevitable: en un softphone web
    el que se registra es el navegador. Lo que se acota es el alcance —solo la
    del propio usuario, solo por la ruta del softphone, nunca en un listado de
    administración ni en un registro—.
- **Llamar desde el caso** (`POST /api/pbx/marcar`): la central llama primero a
  la extensión del operador y, al descolgar, al ciudadano. Por eso funciona sin
  softphone: el audio nunca pasa por el navegador. El botón está junto al
  teléfono en el detalle del caso y en Recepción, y **solo se dibuja** si la
  planta de esa instancia declara que sabe marcar.
  - La extensión sale del usuario que pide la llamada, **nunca del navegador**:
    es una llamada facturable que queda a nombre de alguien en el registro de
    la central.
  - Cada intento —salga o no— queda en la bitácora de administración con el
    número que de verdad se marcó, y el caso recibe una nota.
  - Diez por minuto por operador: alcanzan de sobra para una sala de despacho y
    evitan que un botón repetido gaste la cuenta del municipio.
- Configuración por instancia en `config_pbx`: las credenciales se guardan como
  JSON en una sola columna y **lo que el proveedor marca como secreto va
  cifrado**. Antes eran dos columnas con nombre de Zadarma; ahora los campos
  los declara su descriptor, y de ahí sale también el formulario de la
  pantalla —etiquetas, ayudas y cuáles son de solo escritura—.
- **Dos interruptores**, como las demás integraciones:
  - la integración `pbx` del tenant: si no la tiene, no hay telefonía;
  - `activo` en `config_pbx`: la hay, pero esta planta está apagada ahora mismo.
    Lo que llegue se anota en la bitácora y no toca la cola.

Sin fila en `config_pbx`, una instancia sigue funcionando como siempre con el
webhook genérico de YACO. Esto no puede romper lo que ya opera.

---

## 3. Qué hay que hacer en el panel de Zadarma

### 3.1 Antes de empezar: qué debe estar listo

> **El endpoint tiene que existir en producción ANTES de tocar el panel.**
> Zadarma valida la dirección en el momento de guardarla: si FALCON todavía no
> está desplegado con este cambio, el panel la rechaza y parece un problema de
> la URL. Primero `./deploy-falcon.sh`, después el panel.


| | Dónde se ve | Estado que necesita |
|---|---|---|
| Centralita virtual creada | *PBX* | Activa |
| Extensiones | *PBX → Internal numbers* | Una por operador (ya tiene tres) |
| Un número entrante (DID) | *My numbers* | Apuntando a la centralita |
| Escenario de entrada | *PBX → Incoming call scenarios* | Que el DID caiga en el grupo o la extensión |
| Llaves de la API | <https://my.zadarma.com/api/> | `key` y `secret` a la mano |

Lo que ya probó con MicroSIP cubre los cuatro primeros: si marcando el número
suena la extensión y se puede hablar, el audio ya funciona. Lo que falta es
que la centralita le **cuente** a FALCON lo que está pasando.

**Se puede probar el webhook sin número entrante.** Una llamada de extensión a
extensión (101 marca 102) dispara `NOTIFY_INTERNAL` y `NOTIFY_END`, que basta
para comprobar que la dirección, la firma y la bitácora funcionan. Para la
cadena completa —el ciudadano marca y entra a la cola— sí hace falta un DID
apuntando a la centralita, y saldo: un DID colombiano son unos 12 USD de
conexión y entre 12 y 18 al mes.

### 3.2 El webhook

El panel cambió de forma y la documentación de Zadarma todavía habla de una
pestaña «CRM» que ya no se llama así. Hoy (octubre de 2026) la ruta es:

> **Configuración → Integraciones y API → pestaña «Integraciones» →
> bloque «Servicios Zadarma» → mosaico «Notificaciones de eventos».**

Ese mosaico **es** el webhook: ahí se activa y ahí va la dirección. Mientras
diga *Activadas (0)* no hay ninguna notificación saliendo, y por eso no se ve
ningún campo de URL en el resto del panel.

La pestaña **«Claves y API»** dice en su propio encabezado que desde ahí se
«configura el enlace para las notificaciones»; si el campo no aparece a
primera vista, sale al pulsar **MODIFICAR CLAVES**. Las dos rutas llevan al
mismo sitio.

Al abrir **Notificaciones de eventos** salen dos pasos:

- **«Paso 1. Agrega el código al inicio de script»**, con un fragmento de PHP
  (`if (isset($_GET['zd_echo'])) exit($_GET['zd_echo']);`). **No hay que hacer
  nada**: eso es para quien recibe el webhook en un script propio, y es
  exactamente lo que FALCON ya hace. De paso confirma el mecanismo: la
  validación llega por **GET, con `zd_echo` en la cadena de consulta**.
- **«Paso 2. Inserta enlaces»**, con DOS campos. Solo sirve el primero:

  | Campo | Qué manda | ¿La URL de FALCON? |
  |---|---|---|
  | **Sobre llamadas a la centralita** | `NOTIFY_START`, `NOTIFY_INTERNAL`, `NOTIFY_ANSWER`, `NOTIFY_END`, `NOTIFY_RECORD` | **Sí, aquí** |
  | Sobre eventos | SMS, consultas de número, saldo, *call tracking* | No, vacío |

1. Abra **Notificaciones de eventos**.
2. En **«Sobre llamadas a la centralita»** pegue, **con la llave de la
   instancia al final**:

   ```
   https://falconcad.com.co/api/pbx/zadarma/<API_KEY_DE_LA_INSTANCIA>
   ```

   La API key es la que ya existe para el webhook de la planta — en FALCON,
   *Administración → la instancia*. Si no la tiene a mano, rótela y copie la
   nueva (se muestra una sola vez).
3. Pulse **Agregar**. Es en ESE momento cuando Zadarma llama a la dirección
   con un `zd_echo` para comprobar que es suya — de ahí que el endpoint tenga
   que estar ya desplegado.
4. Si después aparece una lista de eventos para marcar, marque **NOTIFY_START,
   NOTIFY_INTERNAL, NOTIFY_ANSWER y NOTIFY_END**. Los demás pueden quedar
   marcados: FALCON los acepta y los ignora sin quejarse.

**Si dice que la URL no es válida**, compruébelo usted mismo antes de pelear
con el panel:

```bash
curl "https://falconcad.com.co/api/pbx/zadarma/<API_KEY>?zd_echo=prueba123"
# tiene que imprimir exactamente:  prueba123
```

Si imprime otra cosa —comillas, un JSON, un espacio— el panel lo rechaza. Si no
imprime nada, el problema es de red o de nginx, no de FALCON.

### 3.3 Las llaves, en FALCON

Con el superadmin, en **Plataforma → Configuración e integraciones → Planta
telefónica**:

1. Elija la **instancia**.
2. Proveedor **Zadarma**. Queda elegida y **apagada**: sin el secreto no se
   puede verificar nada de lo que llegue, así que la pantalla lo dice y espera.
3. Pegue la **Key** y el **Secret** —los campos aparecen al elegir el
   proveedor, con su ayuda, porque los declara el propio proveedor— y el
   **número entrante** si ya lo tiene; después, *Guardar credenciales*. Al
   quedar completas **la planta se enciende sola**: la única razón por la que
   estaba apagada era que faltaban. Si la quiere apagada, se apaga, que es un
   clic.
4. El panel dice en cada momento qué falta, nombrando los campos:
   *falta Key de la API, Secret de la API* → *apagada* → *lista, falta pegar la
   dirección en Zadarma*. Y dice también **qué sabe hacer** el proveedor, para
   no ofrecer lo que no puede.
5. El panel arma la **dirección del webhook** y la deja lista para copiar; solo
   hay que agregarle al final la API key de esa instancia.

El secreto se guarda cifrado y **no vuelve a bajar al navegador**, ni para
mostrarlo: el campo dice si está puesto y nada más. Eso no es una regla
escrita para Zadarma —sale de que su descriptor marca ese campo como secreto,
así que vale igual para cualquier proveedor que venga—. Activar la planta
**sin** las credenciales requeridas se rechaza a propósito —sin ellas no se
puede verificar nada de lo que llegue— y la pantalla muestra ese motivo tal
cual.

Cambiar el proveedor o apagar la integración **no borra** el secreto: el campo
solo escribe, así que dejarlo vacío conserva el que había.

### 3.4 Las extensiones, con su dueño

En FALCON, *Administración → Usuarios*, columna **Extensión PBX**: cada
operador lleva el número de su extensión de Zadarma (101, 102, 103). Sin eso la
llamada entra a la cola pero no se le anuncia a nadie en particular — funciona,
pero pierde la mitad de la gracia.

### 3.5 Comprobar que llegó

**Sin DID todavía**, la prueba que sí se puede hacer es entre extensiones:
regístrese con MicroSIP (o el teléfono web de *Mi centralita*, o la app) en la
101, marque `102`, conteste en la otra y cuelgue. No es una llamada del
ciudadano, pero recorre toda la cadena: URL, firma, cola, operador y cierre.

> **Ojo con el nombre del evento.** Aquí decía que una llamada entre
> extensiones entra por `NOTIFY_INTERNAL`. **No es lo que hace esta cuenta.**
> La bitácora de producción del 16/10/2026 no tiene ni un `NOTIFY_INTERNAL`:
> una 102 → 100 llega como **`NOTIFY_OUT_START`**, porque desde la 102 es una
> saliente. Es la misma asimetría del fin de llamada (ver §5), ahora en el
> comienzo. FALCON ahora acepta las dos formas, así que la prueba funciona
> igual; lo que no se puede es confiar en el nombre del evento para saber la
> dirección de la llamada.

Con DID, llámelo desde un celular. En los dos casos mire, en este orden:

1. La llamada aparece en la cola de *Recepción* mientras suena.
2. Al sonar la extensión, el aviso se dirige a ese operador —siempre que esa
   extensión esté puesta en su usuario (§3.4); sin eso se anuncia a todos.
3. Al colgar, queda en el registro con su duración.

Si no aparece, el rastro está en la base, no en los logs del proceso:

```sql
SELECT "creadoEn", exitoso, "estadoHttp", left(motivo, 80) AS motivo, left(cuerpo, 200)
FROM pbx_webhook_log ORDER BY "creadoEn" DESC LIMIT 10;
```

La tabla se lee como una transcripción de la llamada. `motivo` dice **qué se
hizo**, no solo qué falló:

```
 exitoso |       evento        | motivo
---------+---------------------+--------------------------------------------------
 t       | NOTIFY_INTERNAL     | Dirigida a la extensión 102
 t       | NOTIFY_ANSWER       | Contestada por la extensión 102
 t       | NOTIFY_OUT_END      | Colgada (answered, 37 s)
 t       | NOTIFY_INTERNAL_END | Ya estaba cerrada (finalizada); no cambió nada
 t       | NOTIFY_OUT_START    | Interna 102 → 100, dirigida a la extensión 100
 t       | NOTIFY_OUT_START    | Saliente 101 → 573009999999, no entra a la cola
 t       | NOTIFY_START        | Entrante de 573001234567
 t       | NOTIFY_END          | Colgada (no answer, 0 s)
 f       | NOTIFY_END          | La firma no corresponde al cuerpo de la petición.
```

| Lo que dice `motivo` | Qué pasó |
|---|---|
| `Llave de instancia desconocida` | La API key de la URL no es la de ninguna instancia |
| `El módulo de pbx no está habilitado` | A la instancia le falta la integración `pbx` |
| `Esta instancia no tiene Zadarma…` | Falta `config_pbx`, o el proveedor quedó en `YACO` |
| `…está apagada para esta instancia` | `activo = false`; es a propósito |
| `La firma no corresponde…` | El secreto guardado no es el de esa cuenta de Zadarma |
| `Entrante de …` / `Dirigida a la extensión …` | Entró a la cola |
| `Colgada (…)` | Se cerró la llamada; entre paréntesis, lo que dijo la central |
| `Ya estaba cerrada (…)` | Aviso de fin repetido —llegan dos—; no cambió nada |
| `… no estaba en la cola, nada que cerrar` | Fin de una saliente de verdad: nunca creó fila |
| `Interna … dirigida a la extensión …` | Llamada entre extensiones: para la que recibe, entra a la cola |
| `Saliente … no entra a la cola` | La marcó un operador hacia un abonado; la cola es de lo que entra |

Si no hay NINGUNA fila, la petición no llegó: es Zadarma, el DNS o nginx.

> Hasta el 15/10/2026 esta tabla no servía para nada con Zadarma: TODA
> petición quedaba como `exitoso = true`, sin motivo, sin tenant y sin el
> nombre del evento, porque esta ruta responde 200 incluso cuando rechaza y el
> interceptor genérico tomaba ese `{ ok: false }` por un éxito. Si está
> mirando una fila vieja así, no significa que estuviera bien.

### 3.6 El softphone: si no suena, si no se oye, si no aparece en Recepción

Los tres síntomas se vieron juntos la primera vez que se probó en la instancia
**demo** (16/10/2026), y tienen tres causas distintas. Conviene separarlas
antes de tocar nada.

**«No suena nada.»** El teléfono de FALCON **suena** —un doble timbrazo cada
tres segundos— y la barra **salta** además de cambiar de color: el operador
está mirando el mapa, no la esquina de la pantalla. Si no suena:

- **¿Está encendido?** La barra tiene que decir *registrado*. El sonido se
  prepara en ese clic y no antes: un `AudioContext` nace suspendido si la
  pestaña no ha tenido ninguna interacción, así que un teléfono que nunca se
  encendió a mano tampoco puede sonar.
- **¿La extensión tiene clave SIP en FALCON?** Administración → el usuario →
  *clave SIP*. Sin ella el softphone no se registra y la barra lo dice.
- **¿Hay otro softphone registrado en la misma extensión?** MicroSIP, la app
  de Zadarma o el teléfono web del panel se registran en la MISMA extensión.
  Para probar FALCON, ciérrelos: así no hay duda de dónde sonó.

**«Hablo y me oyen, pero no oigo a la otra parte.»** Esto fue un defecto, y
está corregido. Eran dos cosas, las dos del lado de FALCON:

1. Los servidores ICE iban en una llave que SIP.js ignora en silencio
   (`iceServers` suelto en vez de dentro de `peerConnectionConfiguration`).
2. El `<audio>` vive dentro de `@if (disponible())`, que es **falso en el
   primer render** porque las capacidades de la planta llegan del servidor.
   `ngAfterViewInit` corría una sola vez, no encontraba el elemento y nunca se
   lo entregaba a la pila SIP. El micrófono sí funcionaba, porque se captura
   por otro camino — de ahí que fuera de una sola vía y no mudo del todo.

Ahora el flujo remoto se engancha **explícitamente** al contestar y se cuentan
las pistas de audio. Si no llega ninguna, la barra lo dice —*«En llamada · sin
audio»*— en vez de dejar al operador hablando solo. Y si la pista llega tarde
(SIP.js documenta que el flujo remoto nace sin pistas), el aviso **se
retracta**: un aviso que no se corrige hace que la segunda vez nadie le crea.
Si el aviso se queda, el problema es de red —RTP bloqueado, coturn caído— y no
de la llamada.

**«Contesto y no aparece nada en Recepción.»** Aquí hay **cuatro** causas con
cuatro arreglos distintos, y la barra las distingue. Antes de concluir nada,
FALCON **le vuelve a preguntar la cola al servidor**: la cola que el navegador
tiene en memoria la llena Socket.IO, y ese canal tiene huecos —una caída de
red, la pantalla suspendida, un despliegue que reinicia las tres réplicas una
por una—. Decidir con la copia vieja mandaba media hora al panel de la
centralita por un aviso que este navegador se perdió.

| Lo que dice la barra | Qué pasó | Dónde se arregla |
|---|---|---|
| «Tomada para usted. Complete el caso en Recepción» | Todo bien | — |
| «no se pudo consultar la cola de FALCON» | No se sabe: el servidor no contestó. La conversación sí está en pie | Red o servidor, no la centralita |
| «ninguna de las llamadas que están timbrando corresponde a esta» | El webhook llega bien; falló el emparejamiento | La **extensión** del usuario (§3.4) tiene que ser la misma con la que se registró el teléfono |
| «esta llamada no entró a la cola… SÍ le llegan avisos» | La API key de la URL **es la correcta** —hay llamadas anteriores—; lo que no llegó es el aviso de ESTA | `pbx_webhook_log`: firma rechazada, o la central no manda evento para este tipo de llamada |
| «la cola de esta instancia está vacía: nunca ha llegado un aviso» | A esta instancia no le ha llegado nada, nunca | La **API key** de la URL del webhook (§3.2) |

Esa distinción entre las dos últimas es la que importa: *«hay historial pero
nada timbrando»* significa que la llave está bien y no hay que tocarla. Solo
*«nunca ha llegado un aviso»* señala la llave.

Y sobre la llave: la dirección del webhook lleva la API key de **UNA**
instancia, así que una cuenta de Zadarma entrega sus llamadas a **una sola**
instancia de FALCON. Para probar en *demo* con una cuenta que estaba apuntando
a *itagui* hay que cambiar la llave de la URL en el panel —o comprar una
segunda cuenta—. No hay forma de que una cuenta alimente dos instancias a la
vez, y es a propósito: la llave en la URL es lo que identifica al inquilino
**antes** de verificar la firma.

---

## 4. Lo que falta, en orden

1. ~~**Contestar dentro de FALCON.**~~ El softphone propio está hecho y
   probado; **falta un dato que Zadarma no publica**. Ver §4.1.
   - ✅ **dominio autorizado**: `https://falconcad.com.co` ya está en
     *Integraciones y API → WebRTC* (15/10/2026).
   - ⬜ **la dirección `wss://` y el dominio SIP**, para pegarlos en Plataforma.
   - ⬜ la **clave SIP de cada extensión**, en Administración → Usuarios. Es la
     misma que se usa en MicroSIP.

### 4.1 El dato que falta, y por qué no lo pone FALCON

La pestaña *WebRTC* de Zadarma **no ofrece un SIP sobre WebSocket**: ofrece un
**widget suyo** —su JavaScript desde `my.zadarma.com`, su interfaz en la
esquina, y una clave que hay que generar en cada carga de página con
`/v1/webrtc/get_key`—. En ninguna parte publica la dirección de señalización.

Lo que SÍ está en el panel, en *Mi centralita → Ajustes de las extensiones*,
son los datos SIP de cada extensión —los mismos que se ponen en MicroSIP—:

| Lo que dice el panel | Qué es |
|---|---|
| **Servidor** `pbx.zadarma.com` | El **dominio SIP** ✓ |
| **Nombre de usuario** `598703-101` | El **usuario SIP**: cuenta de la centralita + guión + extensión |
| **Contraseña** | La **clave SIP** de esa extensión |

> **El usuario SIP NO es el número de la extensión.** La 101 se registra como
> `598703-101`. Registrarse como `101` a secas falla con un rechazo genérico
> del servidor SIP que no dice que el usuario esté mal compuesto. Por eso en
> Plataforma hay un campo **Número de cuenta** (`598703`): FALCON compone el
> usuario y la extensión se sigue guardando como `101`, que es lo que mandan
> los webhooks y lo que se marca entre extensiones.

### La dirección `wss://`, encontrada

**`wss://pbxny2.zadarma.com`** — se leyó del teléfono web del propio panel
(*Llamadas desde el sitio*), con F12 → Red → WS: una conexión WebSocket con
estado **101** contra ese servidor, abierta por el `jssip.min.js` de Zadarma.

Dos cosas que conviene no perder de vista:

- **Zadarma SÍ admite SIP sobre WebSocket**, y con las credenciales SIP de la
  extensión: FALCON se registró y estableció una llamada con ella. El widget
  no era el único camino.
- **`pbxny2` huele a servidor regional** («ny2»). Puede no ser el mismo para
  otra cuenta, así que no se escribe en el código: es un campo de
  configuración, y al lado tiene un botón para comprobarlo.

Si hiciera falta volver a averiguarla —otra cuenta, otro proveedor—:

1. **Mirarla.** Abrir el teléfono web del panel (*Mi centralita → Llamadas
   desde el sitio*) con F12 → pestaña **Red** → filtro **WS**: la conexión con
   estado 101 es la dirección.
2. **Probarla.** Plataforma → Planta telefónica tiene un botón **«Probar
   dirección»** al lado del campo: se pega una candidata y en seis segundos
   dice si contesta y si negocia el protocolo SIP. Se prueba **desde el
   navegador** a propósito, porque el que se va a registrar es el navegador y
   los proveedores filtran por origen —una prueba desde el servidor diría que
   la dirección existe y no diría nada sobre si acepta a FALCON—.
3. **Preguntarla.** Al soporte de Zadarma: *«necesito registrar un softphone
   propio (SIP.js) contra `pbx.zadarma.com` desde el navegador, sin usar el
   widget: ¿cuál es la dirección WSS de señalización? ¿Sirve la clave SIP de
   la extensión para registrarse por ese WebSocket, o la señalización solo
   acepta la clave de `/v1/webrtc/get_key`?»* Esa última pregunta es la que
   decide: si el WebSocket solo admite la clave del widget, el softphone
   propio está cerrado.

**FALCON no adivina ninguna de las dos** a propósito: una dirección inventada
falla con un error de WebSocket que no se parece en nada a «esto nunca se
configuró», y mandaría a buscar el problema donde no está.

**Si resulta que Zadarma solo admite su widget**, el camino es montarlo
(`/v1/webrtc/get_key` con el cliente de API que ya existe) y asumir que
contestar vuelve a ser dos gestos: el widget es una caja negra y no deja leer
quién llama ni cuándo se contestó, que es justo lo que ata la llamada con la de
la cola.
2. **`NOTIFY_ANSWER` crea filas de la nada, y eso hay que revisar con una
   llamada real.** Su traducción es `entrante`, y `entrante` hace *upsert*: si
   no encuentra la llamada por `pbx_call_id`, **la crea**. La intención era
   anotar quién descolgó en una fila que ya existe. Con el arreglo del comienzo
   de llamada (§5) la fila ya existe cuando llega el `ANSWER` de una entrante,
   así que el camino normal queda bien — pero una **saliente de verdad**
   (operador → ciudadano) también produce un `NOTIFY_ANSWER`, y ahí no hay
   ninguna fila: se crearía una llamada entrante fantasma en la cola por cada
   llamada que haga un operador.

   **No se ha corregido a propósito:** no hay en la bitácora ni un
   `NOTIFY_ANSWER` de una saliente externa, y no se arregla a ciegas un cuerpo
   que no se ha visto —la decisión depende de qué manda la central en
   `caller_id` y `destination` en ese caso—. Para capturarlo basta hacer **una**
   llamada desde el botón «Llamar» de un caso y mirar:

   ```bash
   cd ~/falcon-deploy
   docker compose exec -T postgres psql -U falcon -d falcon_cad -c "
   SELECT evento, left(cuerpo, 400) FROM pbx_webhook_log
   WHERE evento IN ('NOTIFY_ANSWER','NOTIFY_OUT_START')
   ORDER BY \"creadoEn\" DESC LIMIT 4;"
   ```

3. **La grabación al caso.** `NOTIFY_RECORD` avisa que está lista; se pide con
   `/v1/pbx/record/request/` (hay que esperar unos segundos: justo después del
   aviso, el archivo todavía no está) y se guarda como adjunto del caso, con la
   misma política de retención que el video.
4. ~~**Llamada saliente desde el caso.**~~ Hecho (ver §2). Falta una sola cosa,
   y no es código: **comprobar que el servidor de producción puede SALIR** a
   `api.zadarma.com`. El webhook va en la dirección contraria —lo inicia
   Zadarma—, así que que las llamadas entren no dice nada sobre si se pueden
   originar. Si la salida está cerrada, el botón dice «No se pudo hablar con la
   centralita» y se arregla apuntando `ZADARMA_API_URL` a un proxy de salida.
5. **El número de verdad.** Hoy no hay DID: la cuenta solo tiene extensiones,
   así que se puede probar todo menos la llamada del ciudadano. Para el caso
   **C** de §1.1 —el número en la nube que vendemos nosotros— basta comprar
   uno en Zadarma y ponerlo en *Número entrante* en Plataforma. El 123 del
   caso **A** no sale de aquí: eso es troncal SIP del operador del municipio.

---

## 5. Dónde vive

| Pieza | Archivo |
|---|---|
| Firma de sus webhooks | `backend/src/pbx/zadarma/zadarma.firma.ts` |
| Firma de las llamadas a su API | `backend/src/pbx/zadarma/zadarma.api.ts` |
| Su descriptor y su traductor | `backend/src/pbx/proveedores/zadarma.proveedor.ts` |
| Endpoint del webhook (solo su saludo) | `backend/src/pbx/zadarma/zadarma.controller.ts` |
| El camino común de un aviso | `backend/src/pbx/avisos.service.ts` |
| Credenciales: leer, descifrar, guardar | `backend/src/pbx/pbx-credenciales.service.ts` |
| Configuración por instancia | `backend/src/pbx/config-pbx.entity.ts`, `pbx-config.service.ts` |
| Pantalla de configuración (armada del catálogo) | `frontend/src/app/pages/plataforma/` |
| Cola, casos y avisos (comunes a todas las plantas) | `backend/src/pbx/pbx.service.ts` |
| El puerto y el registro de proveedores | `backend/src/pbx/proveedores/` |

### El fin de la llamada no tiene un solo nombre

Lo encontró la primera llamada real, entre dos extensiones: entró a la cola,
se colgó en el softphone y en FALCON **siguió timbrando**; hubo que cerrarla a
mano por la API.

La causa es que Zadarma cuenta esa llamada desde los dos lados. Para la 102 es
una entrante y FALCON la encola; para la 101, que fue la que marcó, es una
**saliente**, y su fin llega como `NOTIFY_OUT_END` —que se ignoraba, por
saliente—. Y a veces llegan los dos finales, el de la pata interna y el de la
saliente, por la misma llamada.

Las dos salidas obvias eran malas: ignorar `NOTIFY_OUT_END` deja la llamada
colgada en la cola para siempre, y tratarlo como un `colgada` cualquiera
responde 404 cuando sí era una saliente de verdad —y un 404 lo reintenta la
central sin fin—. Así que lo que decide **no es el nombre del evento sino el
`pbx_call_id`**:

| Llega | Hay una llamada con ese `pbx_call_id` | Qué se hace |
|---|---|---|
| `NOTIFY_END`, `NOTIFY_INTERNAL_END`, `NOTIFY_OUT_END` | Sí, abierta | Se cierra |
| lo mismo | Sí, ya cerrada | Nada; se anota «ya estaba cerrada» |
| lo mismo | No | Nada; era una saliente de verdad |
| `NOTIFY_OUT_START` a un abonado | — | Nada: la cola es de lo que ENTRA |
| `NOTIFY_OUT_START` a una extensión | — | Entra a la cola — ver abajo |

Tres detalles que solo se ven con tráfico real:

- En `NOTIFY_OUT_END`, `internal` es la extensión que **marcó**, no la que
  contestó. Tomarla por el agente dejaba la llamada 101→102 atribuida a la
  101 en el historial del municipio.
- El segundo aviso de fin no vuelve a guardar ni a mover la cola en la
  pantalla del operador, pero sí se distingue en la bitácora.
- **Y el COMIENZO tiene la misma asimetría**, que costó un segundo hallazgo
  (16/10/2026). Esta cuenta no manda `NOTIFY_INTERNAL`: una 102 → 100 empieza
  como `NOTIFY_OUT_START`. Mientras eso se ignoraba por «saliente», la fila de
  la cola no la creaba el timbrazo sino `NOTIFY_ANSWER` —que llega **cuando ya
  se contestó**—, así que al contestar dentro de FALCON no había nada con qué
  emparejar y el softphone decía que la cola estaba vacía. En la bitácora se ve
  el hueco: `OUT_START 11:55:06`, `ANSWER 11:55:11`.

  Lo que decide ahora es el **destino**, no el nombre del evento: si
  `destination` tiene menos de siete dígitos es una extensión de la propia
  centralita, y entonces esa llamada ENTRA para quien la recibe. Con siete o
  más es un abonado, y sigue sin entrar a la cola. Y la extensión que se encola
  es `destination`, **no `internal`**: aquí `internal` es otra vez quien marcó.

  **Consecuencia que conviene tener presente:** una llamada de un operador a un
  compañero entra ahora a la cola de ese compañero. Es lo que hace posible
  probar sin DID, y es lo que FALCON ya hacía —pero tarde y sin servir para
  nada—. Si más adelante molesta en una sala con tráfico real, el arreglo es
  marcarlas como internas y filtrarlas en la cola del despachador, no volver a
  ignorar el evento.

### La firma, que es donde se pierde una tarde

`base64( HEX( HMAC-SHA1(cadena, secreto) ) )` — base64 **del texto
hexadecimal**, no del digest binario. Viene de que el ejemplo oficial está en
PHP y `hash_hmac` devuelve hex por defecto. Con el binario no coincide nunca, y
el síntoma («Zadarma manda y FALCON rechaza todo») no se parece a la causa.

Y cada evento firma una cadena distinta, con tres campos pegados sin separador:

| Evento | Cadena firmada |
|---|---|
| `NOTIFY_START`, `NOTIFY_INTERNAL`, `NOTIFY_END`, `NOTIFY_IVR` | `caller_id` + `called_did` + `call_start` |
| `NOTIFY_ANSWER` | `caller_id` + **`destination`** + `call_start` |
| `NOTIFY_OUT_START`, `NOTIFY_OUT_END` | `internal` + `destination` + `call_start` |
| `NOTIFY_RECORD` | `pbx_call_id` + `call_id_with_rec` |

`NOTIFY_ANSWER` es el que se escapa: si se le copia la fila del primero, ese
evento —y solo ese— se rechaza siempre, y la llamada se queda sin saber quién
contestó. Hay una prueba por evento (`zadarma.firma.spec.ts`).
