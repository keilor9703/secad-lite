# Opción B, de cero a cien: troncal colombiana + Asterisk propio

> Cómo montar la centralita que a FALCON le falta, sin que la llamada salga
> de Colombia y sin depender de la barra de nadie.
>
> Escrito el 16/10/2026. Los comandos están pensados para Ubuntu en Oracle
> Cloud, que es donde corre todo hoy.
>
> **Esto es el montaje A MANO, y es el que llevó a la primera llamada real.**
> Desde el 19/10/2026 la configuración la GENERA FALCON por municipio
> —puertos, dialplan, cola, nginx y un `aplicar.sh` que lo instala todo—; ver
> [`telefonia-planta-multitenant.md`](telefonia-planta-multitenant.md). Este
> documento se queda porque explica POR QUÉ cada archivo dice lo que dice, y
> porque es la referencia cuando algo no cuadra. Las plantillas de
> `deploy/asterisk/` ya no son la fuente de verdad.

---

## 0. Lo primero: cuánto código hace falta de verdad

Dije «una semana» para el lado de FALCON. **Es menos, y conviene saberlo
antes de planear nada**, porque cambia dónde está el trabajo.

Asterisk **no necesita un traductor de eventos**. FALCON ya tiene un webhook
genérico —`POST /api/pbx/webhook`, autenticado con la API key de la
instancia— que es por donde entran hoy las llamadas de YACO. Asterisk puede
llamarlo desde el *dialplan* con un `curl`. Eso es cero código nuevo en
FALCON.

Lo único que hay que escribir es un archivo de proveedor con dos métodos:

| Método | Para qué | Tamaño real |
|---|---|---|
| `softphone()` | Entregarle al navegador `wss`, dominio, usuario y clave SIP | ~10 líneas. Más simple que Zadarma: en Asterisk el usuario SIP **es** la extensión, sin prefijo de cuenta |
| `marcar()` | Originar la llamada saliente del botón «Llamar» | ~30 líneas contra ARI (`POST /ari/channels`) |

**El lado de FALCON es 1–2 días, no una semana.** El trabajo está en Asterisk
y en la troncal. Dicho de otro modo: la parte que yo haría es la corta; la
larga es suya y del operador.

---

## 1. Fase 0 — Comprobar antes de tocar (medio día)

### 1.1 ¿En qué región está el servidor?

Todo el argumento de la opción B es que la llamada no sale de Colombia. Si el
servidor está en São Paulo, no sale nada ganando. **Desde dentro del
servidor**, sin entrar a la consola:

```bash
curl -s -H "Authorization: Bearer Oracle" \
  http://169.254.169.254/opc/v2/instance/ | grep -E '"region"|"canonicalRegionName"'
```

Hágalo en el servidor B (`129.80.243.118`) **y** en el de producción
(`157.137.211.196`). Si ninguno está en Bogotá, es un dato importante por sí
solo: la aplicación ya está fuera del país.

> ⚠️ **Always Free solo aplica en la región de origen (*home region*) de la
> cuenta.** Si su *home region* no es Bogotá, una máquina en Bogotá se paga.
> Como ya están en pago por uso, no es un bloqueo — pero sí una línea en el
> presupuesto que conviene no descubrir después.

### 1.2 ¿Qué puertos están libres?

```bash
sudo ss -tulnp | grep LISTEN
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Asterisk va a querer **8089/tcp** (WSS), **5060/udp** (troncal) y un rango
**10000–20000/udp** (audio RTP).

### 1.3 Un nombre de dominio para la centralita

Hace falta un `pbx-lab.falconcad.com.co` apuntando al servidor, porque **WSS
exige un certificado válido**: el navegador no acepta un certificado
autofirmado para un WebSocket seguro.

> ⚠️ **En Cloudflare, ese registro va en gris (sin proxy).** Cloudflare no
> hace de intermediario del WebSocket de Asterisk en el 8089, y con la nube
> naranja el registro del softphone simplemente no conecta. Es media hora de
> desconcierto si no se sabe de antemano.

### 1.4 Dónde NO montarlo

El servidor B ya corre SECAD, el Falcon de pruebas y el coturn. **Abrir el
5060 ahí tiene consecuencias**: un puerto SIP expuesto recibe barridos de
robo de credenciales a los pocos minutos de existir, siempre, sin excepción.

- **Para el laboratorio**: el servidor B sirve, **siempre que el 5060 quede
  abierto solo a las IP del proveedor de la troncal** (§3).
- **Para producción**: máquina aparte. Una centralita y un CAD no comparten
  servidor — si el PBX se satura o lo atacan, se lleva por delante la
  aplicación.

---

## 2. Fase 1 — Levantar Asterisk (2–3 días)

### 2.1 Nativo, no en Docker

**Instálelo con `apt`, no en un contenedor.** El audio RTP usa un rango de
diez mil puertos UDP; publicarlos en Docker es lento de arrancar y frágil con
el NAT. Si insiste en Docker, tiene que ser `network_mode: host`, con lo cual
el contenedor ya no aísla nada y solo queda la molestia.

```bash
sudo apt update && sudo apt install -y asterisk certbot
sudo systemctl stop asterisk
```

### 2.2 El certificado

```bash
sudo certbot certonly --standalone -d pbx-lab.falconcad.com.co
# queda en /etc/letsencrypt/live/pbx-lab.falconcad.com.co/
```

Asterisk necesita leerlo; se copia a `/etc/asterisk/keys/` con dueño
`asterisk` y se renueva con un *hook* de certbot (si el certificado vence, el
softphone deja de registrarse de un día para otro, sin aviso).

### 2.3 Lo mínimo de `pjsip.conf`

Dos transportes: uno para los navegadores (WSS) y otro para la troncal (UDP).

```ini
[transport-wss]
type = transport
protocol = wss
bind = 0.0.0.0:8089

[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:5060
external_media_address = LA_IP_PUBLICA     ; sin esto, audio de una sola vía
external_signaling_address = LA_IP_PUBLICA
```

> El `external_media_address` es el equivalente, del lado del servidor, del
> problema de audio de una sola vía que ya vivimos en el navegador: si
> Asterisk anuncia su IP privada en el SDP, el audio de vuelta no llega.

Y una extensión por operador (la 101, la 102…), con `webrtc = yes`, que en
Asterisk moderno activa de un golpe lo que el navegador exige: ICE, DTLS,
`rtcp-mux` y AVPF.

```ini
[101]
type = endpoint
transport = transport-wss
webrtc = yes
context = entrantes
disallow = all
allow = opus,ulaw
auth = 101
aors = 101
```

**La clave de cada extensión es la que se guarda en FALCON** en el campo
*clave SIP* del usuario (Administración → el usuario), igual que se hizo con
Zadarma.

### 2.4 Códecs: `opus` y `ulaw`, en ese orden

El navegador habla **Opus**; las troncales colombianas entregan casi siempre
**G.711 (`ulaw`/`alaw`)**. Asterisk transcodifica, y eso **consume CPU**:
para veinte llamadas simultáneas transcodificando, no sirve la máquina más
pequeña. Es la variable de dimensionamiento que importa — mídala con tráfico
antes de prometer capacidad.

---

## 3. Fase 2 — Abrir los puertos sin regalar la centralita (medio día)

Son **dos cortafuegos**, y olvidar el segundo es el error clásico de OCI.

### 3.1 La *Security List* o NSG, en la consola de Oracle

| Puerto | Origen | Para qué |
|---|---|---|
| 8089/tcp | 0.0.0.0/0 | WSS: los navegadores de los operadores |
| 10000–20000/udp | 0.0.0.0/0 | El audio |
| 5060/udp | **solo las IP del proveedor de la troncal** | La troncal |

### 3.2 El `iptables` de la imagen de Ubuntu

**Las imágenes de Ubuntu de Oracle traen reglas que descartan todo menos el
22.** Abrir el puerto en la consola y no aquí es la causa número uno de
«configuré todo y no conecta».

```bash
sudo iptables -I INPUT -p tcp --dport 8089 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 10000:20000 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 5060 -s IP_DEL_PROVEEDOR -j ACCEPT
sudo netfilter-persistent save        # si no, se pierden al reiniciar
```

### 3.3 Lo que no es opcional

- `allowguest = no` en `pjsip.conf` — sin esto, cualquiera puede intentar
  cursar llamadas por su centralita y **a usted le llega la factura**.
- **fail2ban** con el *jail* de Asterisk. Un 5060 expuesto recibe barridos de
  credenciales permanentemente; no es paranoia, es el estado de internet.
- Claves de extensión largas y aleatorias. Nunca `101/101`.

---

## 4. Fase 3 — Que Asterisk le avise a FALCON (1 día)

Aquí está el ahorro: **se usa el webhook genérico que ya existe**, el mismo
de YACO. En `extensions.conf`:

```ini
[entrantes]
exten => _X.,1,NoOp(Entrante ${CALLERID(num)} -> ${EXTEN})
 same => n,System(curl -s -m 3 -X POST https://falcon-test.falconcad.com.co/api/pbx/webhook
        -H "Content-Type: application/json" -H "x-api-key: LA_API_KEY_DE_LA_INSTANCIA"
        -d '{"evento":"entrante","callId":"${UNIQUEID}","numero":"${CALLERID(num)}","extension":"${EXTEN}"}' &)
 same => n,Dial(PJSIP/${EXTEN},30)
 same => n,Hangup()

exten => h,1,System(curl -s -m 3 -X POST https://falcon-test.falconcad.com.co/api/pbx/webhook
        -H "Content-Type: application/json" -H "x-api-key: LA_API_KEY_DE_LA_INSTANCIA"
        -d '{"evento":"colgada","callId":"${UNIQUEID}"}' &)
```

Tres cosas que no son evidentes:

1. **El `&` del final y el `-m 3` no son adorno.** Sin ellos, si FALCON tarda
   en responder, el *dialplan* se queda esperando y **el teléfono no timbra**.
   La notificación nunca puede retrasar la llamada.
2. **`${UNIQUEID}` es el `callId`**, y es lo que ata el `entrante` con el
   `colgada` y con la llamada que el navegador ve por SIP. Es exactamente el
   papel que cumplía `pbx_call_id` en Zadarma.
3. Para producción esto se hace mejor con **ARI** (una aplicación Stasis que
   escucha los eventos) en vez de `curl` desde el *dialplan*. Para el piloto,
   `curl` funciona y se monta en una tarde.

Se verifica en la misma tabla de siempre:

```sql
SELECT "creadoEn", exitoso, evento, left(motivo,70) FROM pbx_webhook_log
ORDER BY "creadoEn" DESC LIMIT 10;
```

---

## 5. Fase 4 — El proveedor «ASTERISK» en FALCON ✅ HECHO

`backend/src/pbx/proveedores/asterisk.proveedor.ts`, registrado en
`registro.ts`. Ya aparece en Plataforma → Planta telefónica.

- **Capacidades:** `['entrantes', 'marcar', 'softphone']`.
- **Credenciales:** `wss` y `dominio` (obligatorias); `ariUrl`, `ariUsuario`,
  `ariClave` (opcionales, solo para el botón «Llamar»; la clave es **secreta**,
  así que se cifra y nunca vuelve al navegador) y `contextoSaliente`.
- **`softphone()`:** `usuario = extension`, sin prefijo de cuenta.
- **`traducir()`: no existe**, a propósito. Las llamadas entran por el webhook
  genérico, como YACO.
- **`marcar()`:** `POST {ariUrl}/channels` con Basic, `endpoint=PJSIP/{ext}`.

Probado y saboteado: ponerle prefijo al usuario SIP, llamar primero al
ciudadano, meter la clave de ARI en la URL, e intentar marcar sin ARI
configurado. Las cuatro las atrapa una prueba.

**Y las plantillas de Asterisk están en [`../deploy/asterisk/`](../deploy/asterisk/)**
— `pjsip.conf`, `extensions.conf`, `http.conf`, `ari.conf` y un `instalar.sh`
que las rellena preguntando. Lo que sigue en este documento explica qué hace
cada una y por qué; para montarlo, basta correr el script.

---

## 6. Fase 5 — La troncal (el tiempo lo pone el operador)

Lo de afuera: cotizar, contratar, que le entreguen servidor, usuario y clave
SIP (los cuatro campos de §1.2 de [`telefonia-zadarma.md`](telefonia-zadarma.md)).
Lo de adentro es un bloque más en `pjsip.conf` —`[troncal]` con `type=registration`
y `type=auth`— y una ruta de entrada hacia el contexto `entrantes`.

**Pida un número de pruebas antes del definitivo.** No estrene la integración
con el número que la gente marca.

---

## 6.5 Lo que salió mal en la primera instalación real (16/10/2026)

Servidor B, `129.80.243.118`. Tres tropiezos, **dos de ellos culpa de las
plantillas**, y ya están corregidos en el repositorio. Quedan escritos porque
el síntoma no se parece a la causa en ninguno de los tres.

### El 80 lo tenía Docker, no el nginx del sistema

`certbot --standalone` falló con *«Could not bind TCP port 80»* después de
`systemctl stop nginx`. Lógico: en ese servidor **nginx corre en un
contenedor** (`falcon-deploy-nginx-1`), y el puerto lo publica `docker-proxy`.
Parar el servicio del sistema no suelta nada.

```bash
docker stop $(docker ps --filter publish=80 -q)
sudo certbot certonly --standalone -d centralita.appjeylor.com
docker start $(docker ps -a --filter publish=80 -q)
```

Eso deja el Falcon de pruebas caído **un minuto**. En un servidor de
laboratorio es aceptable; en producción se usa el reto DNS-01 o se sirve
`/.well-known/` desde el propio nginx.

### «Server Disabled», y el mensaje no dice por qué

`http show status` respondió **«Server Disabled»**, con lo cual no hay
WebSocket ni ARI. La plantilla pedía el puerto **8088 en 0.0.0.0** para el
HTTP sin TLS, y en ese servidor el 8088 **ya estaba tomado** por el contenedor
`secad-api`. Asterisk no pudo abrirlo y apagó su servidor web entero — el
8089 incluido, que es el único que importa. En ningún momento menciona el
puerto ocupado.

**Corregido:** el puerto sin TLS ahora es **127.0.0.1:8090** —no tiene por qué
ser alcanzable desde fuera— y `instalar.sh` **comprueba que 8089 y 8090 estén
libres antes de escribir nada**, y se detiene nombrando al proceso que los
tiene.

> Faltaba también el certificado, así que no se puede afirmar cuál de las dos
> cosas apagó el servidor. Las dos había que arreglarlas.

### Una troncal vacía no es una troncal apagada

Al dejar en blanco los datos del operador, las sustituciones dejaron
`server_uri = sip:` y, peor, **`match =` vacío** en el `type=identify` — que
es justo la regla que decide quién puede entregar llamadas por el 5060. Vacía
no protege nada.

**Corregido:** la troncal vive ahora en `pjsip-troncal.conf`, un archivo
aparte que el script **solo escribe si hay datos**; si no, lo deja vacío y
Asterisk arranca igual.

### Y un detalle que habría costado una tarde de depuración

A la pregunta de la URL de FALCON se respondió `falconcad.com.co`, **sin
`https://`**. El dialplan arma `falconcad.com.co/api/pbx/webhook`; `curl`
asume `http://`, el servidor redirige a HTTPS, y como la llamada va con `-s`
y sin `-L`, **la redirección no se sigue y el webhook nunca llega** — sin un
solo mensaje de error en ningún lado. Ahora el script le pone el esquema y lo
dice.

> Y una advertencia aparte: esa URL era la de **producción**. Una centralita
> de laboratorio apuntando a la cola de producción mete llamadas de prueba en
> la instancia que usan de verdad. Use `falcon-test…` y la API key de la
> instancia de pruebas.

---

## 6.6 Montarla sin poder abrir puertos en la nube

Pasó de verdad (18/10/2026): se perdió el teléfono con el 2FA de Oracle y la
consola quedó inaccesible durante días. Sin consola no se tocan las *Security
Lists*, y **SIP necesita un puerto de entrada**. Se resolvió, y el método
sirve para cualquier servidor con el cortafuegos de la nube cerrado.

### Primero: distinguir CUÁL de los dos cortafuegos bloquea

`tcpdump` captura **antes** de `iptables`. Eso lo convierte en el instrumento
que separa los dos:

```bash
# en el servidor que recibe
sudo tcpdump -ni any udp port 49200
# desde otra máquina
echo prueba | nc -u -w2 LA_IP 49200
```

| Lo que ve | Quién bloquea | ¿Se puede arreglar sin consola? |
|---|---|---|
| tcpdump no ve nada | La nube (Security List / NSG) | **No** |
| tcpdump lo ve, el servicio no contesta | `iptables` del servidor | **Sí** |

Para TCP, desde otra máquina, el mismo diagnóstico sale de `nc -vz`:
**«connection refused»** significa que la nube **sí** lo permite y no hay nadie
escuchando; **timeout** significa que la nube lo bloquea.

### Después: encontrar qué está abierto — MIDIENDO, no deduciendo

El instinto es buscar un servicio que funcione desde internet y colarse por su
puerta. Aquí el candidato era **coturn**: si la videollamada funciona, su rango
de relevo tiene que estar permitido.

```bash
sudo grep -E "^(listening-port|min-port|max-port)" /etc/turnserver.conf
# listening-port=3478
# min-port=49152
# max-port=49252
```

**Esa deducción resultó FALSA**, y conviene que quede escrita porque es una
trampa elegante. Al medirlo de verdad:

| Puerto | ¿Llega? |
|---|---|
| **3478/udp** (escucha de coturn) | **sí** |
| 49152, 49200, 49252 (relevo de coturn) | no |
| 5060, 10000 | no |

Solo está abierto el puerto de **escucha**. El rango de **relevo** no.

Y eso no es un detalle del experimento: significa que **el TURN de ese
servidor nunca ha relevado nada**. El navegador del otro extremo no puede
mandarle media al relevo. Las videollamadas que funcionan son las que se
arreglan con STUN; las que necesitan relevo —NAT simétrico, redes
corporativas, algunas móviles— **vienen fallando en silencio**. Buscando un
puerto para SIP se encontró un defecto de la videollamada.

> **La lección de método, que es la que vale:** un resultado negativo no
> significa nada sin un control positivo. El primer `tcpdump` no vio el
> paquete y se dio por cerrado el puerto, cuando igual de probable era que
> `nc` no lo hubiera enviado. Mandar paquetes a varios puertos **incluyendo
> uno que se sabe abierto**, en una sola corrida, cuesta lo mismo y la
> diferencia es saber si el instrumento funciona.

### Y entonces, con un solo puerto abierto

Cuando lo único que entra es el puerto de un servicio que ya está corriendo,
quedan dos caminos y hay que elegir con los ojos abiertos:

| Camino | Qué cuesta |
|---|---|
| **Quitarle el puerto a ese servicio** | Aquí: parar coturn y darle el 3478 a Asterisk. Se pierde el STUN propio — pero el relevo, que es lo que de verdad importaba, ya no funcionaba |
| **Troncal CON REGISTRO** | El PBX abre la conexión hacia afuera y no hace falta ningún puerto de entrada. Es la solución correcta, y la única que sigue siéndolo cuando vuelva la consola |

**El RTP es otra historia, y con suerte no hace falta abrirlo.** Las reglas de
OCI son *stateful*: el primer paquete que Asterisk manda hacia afuera abre el
flujo, y el retorno entra por ahí aunque el puerto no esté permitido. Con
`rtp_symmetric = yes` es el comportamiento normal. Puede haber un recorte en
el primer segundo. **No se promete: se comprueba con una llamada.** Por eso el
rango de `rtp.conf` se deja en el 10000–20000 de siempre y no se mete con
calzador en un rango prestado: si ninguno está abierto, el rango estrecho no
compra nada.

### Lo que hay que saber de este arreglo

- **Es prestado, y se devuelve.** Cuando vuelva la consola, lo correcto es
  abrir 5060/udp y 10000–20000/udp, devolverle a coturn su puerto **y abrirle
  por fin su rango de relevo**, que es el defecto que esto destapó. Queda
  anotado para que nadie se encuentre esto dentro de un año sin saber por qué.
- **Parar coturn corta las videollamadas en curso** y deja sin STUN propio a
  esa instancia. No se hace en hora pico.
- **El proveedor tiene que aceptar un puerto distinto del 5060.** En Infobip
  es *Direcciones IP → Hosts de destino → Puerto*, y es editable. Si un
  proveedor no lo permite, la única salida es una troncal **con registro**
  (el PBX inicia la conexión hacia afuera y el retorno entra por el flujo ya
  establecido), que no necesita ningún puerto de entrada.
- **La barra del operador no necesita puerto nuevo**: el WebSocket se publica
  por el **443 de nginx**, que ya estaba abierto (§6.7).

### Un puerto abierto puede servir para DOS cosas

Cuando lo único que entra es un puerto, conviene recordar que **SIP va por UDP
y el WebSocket por TCP**. Son protocolos distintos: los dos pueden usar el
mismo número sin chocar.

Aquí el único puerto permitido era el 3478 (el de coturn, abierto en UDP y en
TCP). Con coturn apagado quedaron los dos libres:

| Servicio | Protocolo | Puerto |
|---|---|---|
| SIP de la troncal | **UDP** | 3478 |
| WebSocket de la barra | **TCP** | 3478 |

Eso evitó tener que montar un proxy de WebSocket en nginx —que habría
obligado a tocar el `docker-compose` de otro servicio, montar el certificado
dentro del contenedor y recrearlo— para un servidor de pruebas. La barra se
conecta a `wss://centralita.ejemplo.com:3478/ws` y ya.

**Dos condiciones:** el certificado tiene que ser válido para ese nombre (ya
lo era), y el DNS tiene que apuntar **directo al servidor**. Si está en
Cloudflare con la nube naranja, no sirve: Cloudflare solo hace de
intermediario en un puñado de puertos, y el 3478 no está entre ellos.

### chan_sip le roba el WebSocket a PJSIP, y el síntoma engaña

Costó una tarde (18/10/2026) y conviene reconocerlo de inmediato.

Asterisk 18 **todavía trae `chan_sip`**, el driver SIP viejo, y el paquete de
Debian/Ubuntu lo carga por defecto. Las dos pilas —`chan_sip` y `res_pjsip`—
compiten por el subprotocolo `sip` del WebSocket, y **gana la que cargue
primero**.

Cuando gana chan_sip, lo que se ve es:

- el WebSocket conecta bien: `101 Switching Protocols`, `sec-websocket-protocol: sip`;
- el navegador manda `REGISTER`, recibe el desafío `401` y responde el digest;
- y Asterisk contesta **`403 Forbidden`**.

Todo apunta a la clave SIP, y la clave está bien: chan_sip simplemente **no
conoce la extensión**, porque esa vive en `pjsip.conf`.

**Cómo reconocerlo en el trazado**, sin tocar nada:

| | chan_sip (el viejo) | res_pjsip (el bueno) |
|---|---|---|
| Etiqueta en `To:` | `;tag=as4b4f731e` — empieza por **`as`** | aleatoria, sin prefijo |
| `Supported:` | `replaces, timer` | `100rel, timer, replaces, norefersub` |

Si en la misma centralita ve las dos firmas —una en las respuestas a la
troncal y otra en las del navegador— no son dos configuraciones: **son dos
pilas**.

**El arreglo** es una línea en `/etc/asterisk/modules.conf` — **dentro de la
sección `[modules]`**:

```bash
sudo sed -i '/^\[modules\]/a noload => chan_sip.so' /etc/asterisk/modules.conf
sudo systemctl restart asterisk      # restart, no reload: hay que descargar el módulo
```

> **Y ojo con dónde cae esa línea.** `modules.conf` está por secciones: un
> `noload` añadido al **final del archivo** queda fuera de `[modules]` y
> Asterisk **lo ignora sin decir nada**. Se ve exactamente igual que si
> estuviera puesto, y el 403 sigue. Costó un segundo intento.

Para probarlo en el acto, sin reiniciar:

```bash
sudo asterisk -rx "module unload chan_sip.so"
```

Si con eso la barra registra, el diagnóstico está confirmado y solo falta
dejarlo permanente. `instalar.sh` ya lo hace, y además **comprueba que el
módulo quedó descargado de verdad** en vez de confiar en que escribir la
línea bastó.

### Y lo entrante no es lo único

Con una troncal estática el tráfico **saliente** ya funciona desde el primer
día: el proveedor autoriza por IP de origen, y salir nunca estuvo bloqueado.
Así que el botón «Llamar» del caso se puede probar **antes** que las
entrantes, y conviene: separa los problemas en dos mitades.

---

## 7. Fase 6 — Operarla (permanente, y es el costo real)

Lo que de verdad cuesta la opción B no es montarla, es sostenerla:

- **Monitoreo** de que Asterisk está vivo, de que la troncal está registrada
  y de que el certificado no está por vencer. Lo segundo y lo tercero fallan
  en silencio: nadie se entera hasta que entra una llamada y no entra.
- **Respaldo de `/etc/asterisk`** en cada cambio. Es texto; va a git.
- **Revisar fail2ban** de vez en cuando, para saber qué tan atacado está.
- **Y para un 123, eventualmente dos centralitas** con conmutación. Eso ya no
  es este documento.

---

## 8. El orden, y cuánto dura

| | Qué | Quién | Tiempo |
|---|---|---|---|
| 0 | Región, puertos, subdominio en gris | usted | medio día |
| 1 | Asterisk + certificado + extensiones | usted | 2–3 días |
| 2 | Puertos y seguridad (los **dos** cortafuegos) | usted | medio día |
| 3 | Dialplan que avisa a FALCON | usted | 1 día |
| 4 | ~~Proveedor «ASTERISK» en FALCON~~ | yo | ✅ **hecho** (16/10/2026) |
| 5 | Troncal | el operador | 1–3 semanas de trámite |
| 6 | Operación | alguien, siempre | permanente |

**Las fases 1 a 4 se pueden hacer YA, sin troncal.** Entre extensiones —una
llamada de la 101 a la 102 contestada en el navegador de FALCON— se prueba
toda la cadena menos la troncal: WSS, audio en los dos sentidos, webhook,
cola, caso y cierre. Es exactamente lo que ya probamos con Zadarma, y por eso
sabemos que funciona.

Cuando llegue la troncal, lo único nuevo es un bloque en `pjsip.conf`.
