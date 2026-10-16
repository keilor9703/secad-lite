# Opción B, de cero a cien: troncal colombiana + Asterisk propio

> Cómo montar la centralita que a FALCON le falta, sin que la llamada salga
> de Colombia y sin depender de la barra de nadie.
>
> Escrito el 16/10/2026. Los comandos están pensados para Ubuntu en Oracle
> Cloud, que es donde corre todo hoy.

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

## 5. Fase 4 — El proveedor «ASTERISK» en FALCON (1–2 días)

Un archivo en `backend/src/pbx/proveedores/asterisk.proveedor.ts` y una línea
en `registro.ts`. Ver [`telefonia-proveedores.md`](telefonia-proveedores.md).

- **Capacidades:** `['entrantes', 'marcar', 'softphone']`.
- **Credenciales que declara:** `wss` (`wss://pbx-lab…:8089/ws`), `dominio`,
  y para marcar: `ariUrl`, `ariUsuario`, `ariClave` (esta última **secreta**,
  con lo cual se cifra y nunca se devuelve — el puerto ya hace eso solo).
- **`softphone()`:** devuelve `usuario = extension`, sin prefijo. Más simple
  que Zadarma.
- **`traducir()`: no se implementa.** Las llamadas entran por el webhook
  genérico, como YACO.
- **`marcar()`:** `POST {ariUrl}/channels` con autenticación básica,
  `endpoint=PJSIP/{extension}`, y al contestar marca el número.

---

## 6. Fase 5 — La troncal (el tiempo lo pone el operador)

Lo de afuera: cotizar, contratar, que le entreguen servidor, usuario y clave
SIP (los cuatro campos de §1.2 de [`telefonia-zadarma.md`](telefonia-zadarma.md)).
Lo de adentro es un bloque más en `pjsip.conf` —`[troncal]` con `type=registration`
y `type=auth`— y una ruta de entrada hacia el contexto `entrantes`.

**Pida un número de pruebas antes del definitivo.** No estrene la integración
con el número que la gente marca.

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
| 4 | Proveedor «ASTERISK» en FALCON | yo | 1–2 días |
| 5 | Troncal | el operador | 1–3 semanas de trámite |
| 6 | Operación | alguien, siempre | permanente |

**Las fases 1 a 4 se pueden hacer YA, sin troncal.** Entre extensiones —una
llamada de la 101 a la 102 contestada en el navegador de FALCON— se prueba
toda la cadena menos la troncal: WSS, audio en los dos sentidos, webhook,
cola, caso y cierre. Es exactamente lo que ya probamos con Zadarma, y por eso
sabemos que funciona.

Cuando llegue la troncal, lo único nuevo es un bloque en `pjsip.conf`.
