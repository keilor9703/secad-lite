# Falcon CAD — Producción

**Servidor D** (`157.137.211.196`) · `falconcad.com.co`

Desplegado el 1 de octubre de 2026. Sustituye al despliegue del Servidor B,
que quedó como `falcon-test.falconcad.com.co`.

---

## Ficha del servidor

| | |
|---|---|
| **IP pública** | `157.137.211.196` — **reservada**, no efímera |
| **Hostname** | `falconcad-prod-vnic` |
| **Llave SSH** | `ssh-key-2026-10-01.key` |
| **Usuario** | `ubuntu` |
| **Nube** | Oracle Cloud · compartimento `falconcad01` · VCN `vcn-20261001-1009` |
| **Dominio** | `falconcad.com.co` (Cloudflare, proxy naranja) |
| **Dominio temporal** | `nuevo.falconcad.com.co` → mismo servidor, útil para probar sin tocar producción |
| **Carpeta** | `~/falcon-deploy` |

```bash
# Windows (PowerShell)
ssh -i "C:\Users\acer\Downloads\ssh-key-2026-10-01.key" ubuntu@157.137.211.196

# macOS / Linux
chmod 400 ~/Downloads/ssh-key-2026-10-01.key
ssh -i ~/Downloads/ssh-key-2026-10-01.key ubuntu@157.137.211.196
```

### Qué corre

| Qué | Cómo | Puerto |
|---|---|---|
| Backend Falcon ×3 réplicas | Docker Compose · `backend1/2/3` | 3000 interno |
| PostgreSQL 16 | Docker Compose · volumen `pgdata` | 5432 interno |
| Redis 7 | Docker Compose | 6379 interno |
| nginx (proxy + frontend) | Docker Compose | 80, 443 |
| coturn (TURN videollamada) | **systemd nativo**, no Docker | 3478 + 49152-65535/udp |
| pgAdmin | Docker, apagado por defecto (`profiles: ["admin"]`) | 127.0.0.1:5050 |

> **coturn no está en Docker.** Es el único servicio nativo. Un `docker compose
> down` no lo toca, y reiniciar el servidor sí lo levanta solo (`systemctl
> enable`). Si la videollamada se queda en negro en redes móviles, lo primero
> es `systemctl status coturn`.

---

## Diferencias con el Servidor B (lo que cambió al migrar)

Si viene del cuaderno del servidor viejo, esto ya **no** aplica igual:

| Antes (Servidor B) | Ahora (producción) |
|---|---|
| `ORIGEN_API` con el dominio dentro del build | `ORIGEN_API = ''` — la API se llama en el mismo origen, sin CORS |
| Cambiar de dominio exigía recompilar el frontend | El dominio se deduce de `X-Forwarded-Host`; el build sirve para cualquier dominio |
| TURN escrito en `environment.prod.ts` | TURN en `~/falcon-deploy/runtime.json`, servido por nginx |
| `DB_MIGRATE=true` en las tres réplicas | Solo en `backend1`; las otras dos en `false` |
| `FRONTEND_URL` obligatoria | Opcional: si falta, se deduce del dominio de la petición |

---

## Desplegar una versión nueva

```bash
cd ~/falcon-deploy
./deploy-falcon.sh
```

El script trae el código, reemplaza las réplicas **de una en una** (siempre
queda alguien atendiendo), compila el frontend y lo publica, y comprueba al
final. Se detiene ante el primer error en vez de dejar medio desplegado.

| Opción | Para qué |
|---|---|
| *(sin opciones)* | Backend y frontend |
| `backend` | Solo la API |
| `frontend` | Solo la interfaz |
| `--respaldo` | Respalda la base antes (ver abajo) |

**El respaldo no es automático**, a propósito: la mayoría de los despliegues no
tocan el esquema y media hora de fricción diaria no se paga sola. Pero si los
commits que entran traen **migraciones**, el script lo avisa y las lista — ahí
sí conviene `--respaldo`, porque una migración sobre datos reales no se deshace
sola.

> El frontend se publica con `rsync --delete --checksum` **dentro** del mismo
> directorio, nunca reemplazándolo. nginx tiene `frontend-dist` montado por
> *bind*, atado al inodo que existía al arrancar el contenedor: si se sustituye
> el directorio (con `mv`, o `rm -rf` + `mkdir`), nginx se queda sirviendo la
> carpeta vieja o devuelve 403. Es la misma trampa del inodo que hace que
> `sed -i` rompa el montaje de `nginx.conf`.

Instalarlo o actualizarlo (viene en el repositorio):

```bash
# Requisito del sistema: el script publica el frontend con rsync
sudo apt-get update && sudo apt-get install -y rsync

cd ~/falcon-deploy
git -C secad-lite pull
cp secad-lite/deploy/deploy-falcon.sh .
chmod +x deploy-falcon.sh
```

### A mano, si hace falta entender qué hace

```bash
cd ~/falcon-deploy

# 1. Traer el código
git -C secad-lite pull

# 2. Backend (las migraciones las corre backend1 al arrancar)
docker compose up -d --build backend1 backend2 backend3

# 3. Frontend: se compila EN EL SERVIDOR, dentro de un contenedor de Node
docker run --rm -v ~/falcon-deploy/secad-lite/frontend:/app -w /app \
  node:22-alpine sh -c "npm ci && npx ng build --configuration production"
cp -r secad-lite/frontend/dist/frontend/browser/* frontend-dist/

# 4. Comprobar
docker compose ps
curl -s https://falconcad.com.co/api/health; echo
docker compose logs --tail 40 backend1
```

> El frontend **no** tiene contenedor propio: nginx sirve los archivos
> estáticos desde `./frontend-dist`. Por eso hay que compilar y copiar.

> `cp -r dist/...` **no pisa** `config/runtime.json`: ese archivo está montado
> por separado desde el host.

---

## Archivos del despliegue

Todos en `~/falcon-deploy`:

| Archivo | Qué es | ¿Versionado? |
|---|---|---|
| `docker-compose.yml` | Definición del stack | Copia en el repo: `deploy/` |
| `nginx.conf` | Proxy, TLS, WebSocket, límite de subida | Copia en el repo: `deploy/` |
| `.env` | `DOMAIN`, `DB_PASSWORD`, `JWT_SECRET`, `VIDEO_TOKEN_SECRET` | **Nunca.** Ver `90-CREDENCIALES.md` |
| `runtime.json` | Credencial del TURN | **Nunca.** Ver `deploy/runtime.json.example` |
| `certs/origin.pem` · `origin.key` | Certificado de origen de Cloudflare | **Nunca** |
| `frontend-dist/` | Frontend compilado | No (se genera) |
| `secad-lite/` | Clon del repositorio | No |

---

## El `.env`

```bash
DOMAIN=falconcad.com.co
DB_PASSWORD=...
JWT_SECRET=...
VIDEO_TOKEN_SECRET=...
```

> ⚠️ **`JWT_SECRET` no es solo para las sesiones.** Con una llave derivada de
> él se cifran en la base **la API key de Infobip y el token de WhatsApp**
> (`sms.service.ts`, `tenants.service.ts`). Si lo cambia, esas dos credenciales
> quedan ilegibles y hay que volver a escribirlas en Plataforma. Nunca lo rote
> el mismo día que hace otra cosa grande.

> `FRONTEND_URL` **no está definida a propósito**: el enlace de la videollamada
> se arma con el dominio por el que entró la petición. Así el mismo despliegue
> sirve en `falconcad.com.co` y en `nuevo.falconcad.com.co`. Si algún día hay
> que forzarlo, se agrega al `.env` y manda sobre lo deducido.

---

## TURN de la videollamada

La credencial **no está en el código**. Vive en `~/falcon-deploy/runtime.json`,
que nginx sirve en `/config/runtime.json`:

```json
{
  "turnUrls": [
    "turn:157.137.211.196:3478?transport=udp",
    "turn:157.137.211.196:3478?transport=tcp"
  ],
  "turnUsername": "falcon",
  "turnCredential": "..."
}
```

El despliegue lo copia a `frontend-dist/config/runtime.json` y nginx lo sirve
como un archivo estático más. **No** hay volumen ni `location` que mantener:

```bash
./deploy-falcon.sh            # lo repone en cada despliegue
```

> ⚠ **No lo monte con un volumen en `/usr/share/nginx/html/config/runtime.json`.**
> Esa ruta está dentro de `frontend-dist/`, y el despliegue sincroniza esa
> carpeta con `rsync --delete`. La compilación de Angular no produce ningún
> `config/`, así que el despliegue borraría el directorio y el montaje del
> contenedor quedaría huérfano: el TURN dejaría de servirse **sin que nada falle
> a la vista**, y la videollamada se caería solo en datos móviles. Por eso se
> copia, y `rsync` lleva `--exclude=/config/`.

Cambiar de servidor TURN o rotar la credencial **no exige recompilar nada**:
se edita el archivo, `docker compose up -d --force-recreate nginx`, y los
navegadores lo toman al recargar.

```bash
# La credencial actual
sudo grep '^user=' /etc/turnserver.conf

# ¿Lo está sirviendo bien?
curl -s https://falconcad.com.co/config/runtime.json
```

Si eso devuelve el `index.html` en vez del JSON, el archivo no está en
`frontend-dist/config/`: lo resuelve el `try_files ... /index.html`.

**Si el archivo falta**, la aplicación arranca igual con solo STUN y avisa por
consola. La videollamada funciona en WiFi y falla en redes móviles con NAT
simétrico — degradado, no caído.

### Probar el TURN desde fuera

<https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>

```
URI:        turn:157.137.211.196:3478
Username:   falcon
Credential: (la de turnserver.conf)
```

Tiene que aparecer al menos un candidato de tipo **`relay`**. Si solo salen
`host` y `srflx`, el TURN no está pasando.

---

## Doble factor de autenticación (2FA)

Cada usuario presenta, además de su contraseña, un código de seis dígitos que
cambia cada 30 segundos y que genera una aplicación de autenticación en su
teléfono (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).

**El superadministrador está exento.** No es un descuido: es quien tiene que
poder entrar a desactivarlo si algo falla. Si también dependiera del código,
un problema en el 2FA dejaría la plataforma sin nadie que pudiera arreglarla.

### Apagarlo

Dos interruptores, y el del entorno manda:

| | Dónde | Cuándo usarlo |
|---|---|---|
| Plataforma → Doble factor | La pantalla | El de todos los días |
| `MFA_OBLIGATORIO=false` | `.env` + recrear backends | Si no se puede llegar a la pantalla |

```bash
# El de emergencia
cd ~/falcon-deploy
echo 'MFA_OBLIGATORIO=false' >> .env
docker compose up -d --force-recreate backend1 backend2 backend3
```

El del entorno **solo apaga**: no puede encender lo que la pantalla desactivó.
Y mientras esté puesto, la pantalla de Plataforma lo avisa, para que nadie vea
«Exigido» sin entender por qué nadie presenta código.

Desactivarlo **no borra** las vinculaciones: al volver a activarlo, los
usuarios ya enrolados no tienen que escanear de nuevo.

### El usuario perdió el teléfono

**Administración → Usuarios → columna «Doble factor» → Restablecer.** Pide
confirmación en la misma fila; al aceptar, el usuario vuelve a ver el código QR
en su siguiente ingreso y vincula el teléfono nuevo. También se levanta el
bloqueo por intentos fallidos, si lo había.

Lo pueden hacer el superadministrador y el administrador de la instancia —el
permiso es `usuarios.mfa_restablecer`, concedido junto con `usuarios.gestionar`—.
Un administrador **solo alcanza cuentas de su propio municipio**.

> La identidad la verifica quien restablece: en persona, por radio o por
> teléfono. En una central con supervisor de turno eso es más confiable que un
> código enviado a un buzón, y por eso no existe una recuperación automática.

Queda en la bitácora como `usuario.mfa_restablecer`, con quién lo hizo y a quién.

### Síntomas

| Síntoma | Causa casi siempre |
|---|---|
| «El código no es correcto» con un código recién leído | **Relojes desfasados.** La ventana es de 90 segundos. Compare `date` en el servidor con la hora del teléfono (que debe estar en automático) |
| «Ese código ya se usó» | Correcto y a propósito: un código vale una sola vez. Espere al siguiente |
| «Demasiados intentos fallidos» | Cinco fallos bloquean 15 minutos. Se espera, o se restablece el enrolamiento |
| «No se pudo verificar el segundo factor» | Cambió `JWT_SECRET`: los secretos guardados ya no se pueden descifrar y hay que volver a enrolar a todos |

> 🔴 **Cambiar `JWT_SECRET` invalida todos los enrolamientos**, porque con esa
> llave se cifran los secretos TOTP. Antes de tocarla, desactive el 2FA desde
> Plataforma; después, cada usuario tendrá que escanear otra vez.

---

## Respaldos

```bash
cd ~/falcon-deploy
./respaldo-falcon.sh              # diario: todo MENOS el video (unos MB)
./respaldo-falcon.sh completo     # TODO, incluidas las grabaciones
./respaldo-falcon.sh verificar    # restaura el último de verdad y comprueba que sirve
./respaldo-falcon.sh purgar 90    # qué grabaciones de más de 90 días sobran
ls -lh /opt/falcon-backups/       # qué hay
crontab -l                        # las rutinas
```

Instalarlo o actualizarlo:

```bash
cd ~/falcon-deploy
git -C secad-lite pull
cp secad-lite/deploy/respaldo-falcon.sh .
chmod +x respaldo-falcon.sh
rm -f respaldo.sh      # el anterior: volcaba todo junto y no verificaba nada
```

> Si queda el `respaldo.sh` viejo, alguien lo correrá —y el cron nuevo y el
> viejo dejarían copias con dos criterios de rotación distintos en el mismo
> directorio.

### Por qué son dos respaldos y no uno

Las grabaciones de videollamada viven **dentro** de la base, en
`archivos_chunks`. Es cómodo mientras el video es pequeño —un volcado se lleva
todo— y deja de serlo en cuanto pesa más que los datos: un volcado de 50 GB no
se hace a diario, ni se guardan catorce copias, ni se sube a ningún lado.

| | Qué lleva | Cada cuánto | Copias | Tamaño |
|---|---|---|---|---|
| `diario` | Casos, usuarios, catálogos, configuración, enrolamientos 2FA | Todas las noches | 14 | MB |
| `completo` | Lo anterior **más** las grabaciones | Semanal | 2 | GB |

El diario omite los **datos** de `archivos_chunks`, no la tabla: la estructura
va siempre, para que una base restaurada de un diario arranque la aplicación
—con las grabaciones viejas ausentes, pero funcionando—.

### Las rutinas

```cron
# Diario a las 2:47; completo los domingos a las 3:12; verificación los lunes.
47 2 * * *   cd ~/falcon-deploy && ./respaldo-falcon.sh diario    >> ~/respaldo.log 2>&1
12 3 * * 0   cd ~/falcon-deploy && ./respaldo-falcon.sh completo  >> ~/respaldo.log 2>&1
40 4 * * 1   cd ~/falcon-deploy && ./respaldo-falcon.sh verificar >> ~/respaldo.log 2>&1
```

### `verificar` no es opcional

Un volcado que nadie restauró no es un respaldo, es un archivo. Casi todas las
tablas llevan `FORCE ROW LEVEL SECURITY`: si el rol `falcon` dejara de poder
saltarse RLS, `pg_dump` fallaría —y en el peor caso un volcado se vería normal
con tablas vacías por dentro—. Por eso cada respaldo deja al lado un
`.conteos` con las filas que tenía la base viva, y `verificar` restaura en una
base desechable y **exige que los números coincidan**:

```
✔ casos: 1 842 de 1 842
✔ usuarios: 57 de 57
· archivos_chunks: vacía, como corresponde al respaldo diario
```

Si sale un `✖`, el respaldo no sirve y hay que resolverlo ese día, no el día
que haga falta restaurar.

### Restaurar

```bash
docker compose stop backend1 backend2 backend3
docker compose exec -T postgres pg_restore -U falcon -d falcon_cad \
  --no-owner --clean --if-exists < falcon-datos-2026-10-02-0247.dump
docker compose start backend1 backend2 backend3
```

> Se paran los backends a propósito: `--clean` borra y recrea las tablas, y una
> petición a mitad del proceso encuentra la base en un estado imposible.

Si se restaura un **diario**, las grabaciones no vuelven: para recuperarlas hay
que restaurar encima el último `completo`. Los casos y todo lo demás sí están.

### Purgar grabaciones viejas

Lo único que crece sin techo es el video. `purgar` es lo que mantiene el disco
bajo control:

```bash
./respaldo-falcon.sh purgar 90              # ensayo: dice qué borraría
./respaldo-falcon.sh purgar 90 --ejecutar   # lo borra
```

Tres salvaguardas, porque esto borra evidencia:

- **No hay plazo por defecto.** El número lo decide quien responde por la
  evidencia, no el script.
- **No borra nada sin `--ejecutar`.** Sin esa palabra solo informa.
- **No borra lo que ningún respaldo completo haya guardado todavía**, aunque
  cumpla el plazo. Si no hay ningún `falcon-completo-*.dump`, se niega entero.

Solo toca `origen = 'GRABACION'`. Los adjuntos que alguien subió a un caso no
se purgan nunca.

### Cuánto aguantan los 200 GB

La grabación tiene techo: 800 kbps de video y 64 de audio
(`VIDEO_BPS_GRABACION` en `videollamada.service.ts`), **≈390 MB por hora
grabada**. Sin ese techo, MediaRecorder elegía el bitrate según la resolución y
una llamada 720p se iba a ~1,1 GB/hora. No afecta a lo que ve el despachador
—el video punto a punto va por su propio canal—, solo a lo que se archiva.

| Uso | Al mes | Con retención de 90 días se estabiliza en |
|---|---|---|
| 1 h/día grabada | 12 GB | ~35 GB |
| 2 h/día | 23 GB | ~70 GB |
| 5 h/día | 58 GB | ~175 GB — **no cabe**, hay que bajar la retención |

Hoy la base entera son 48 MB, 36 de ellos video, y el disco va al 3%. No hay
urgencia; sí hay que fijar la retención antes de que la haya, porque a 5 h/día
el margen se consume en cuatro meses.

### Fuera del servidor

> ⚠️ Un respaldo en la misma máquina no protege de perder la máquina, que es
> justamente de lo que protege un respaldo.

El script sube cada copia si `FALCON_RESPALDO_URL` está definida, y **grita en
cada ejecución si no lo está**. Se usa una URL prefirmada (PAR) de Oracle
Object Storage, que no exige instalar ni configurar nada:

1. Consola de Oracle → *Storage* → *Buckets* → crear `falcon-respaldos`.
2. En el bucket: *Pre-Authenticated Requests* → crear una con
   *Permit object reads and writes*, alcance *Bucket*, y vencimiento a un año.
3. Copiar la URL (**se muestra una sola vez**) al `.env` del respaldo:

   ```bash
   echo 'export FALCON_RESPALDO_URL="https://objectstorage.<region>.oraclecloud.com/p/<token>/n/<tenancy>/b/falcon-respaldos/o/"' >> ~/.falcon-respaldo-env
   chmod 600 ~/.falcon-respaldo-env
   ```

   y cargarlo en las líneas del cron: `cd ~/falcon-deploy && . ~/.falcon-respaldo-env && ./respaldo-falcon.sh diario`.

Capa gratuita: 20 GB. Los diarios caben de sobra; el completo semanal depende
de cuánto video haya.

### Qué prueba esto antes de llegar al servidor

```bash
./deploy/pruebas/respaldo.prueba.sh   # levanta un PostgreSQL desechable
```

Ejercita los cuatro modos contra una base real con el mismo esquema que
producción —RLS incluido—, y comprueba entre otras cosas que el diario excluye
los bytes del video pero no la tabla, que `verificar` detecta un volcado
truncado y unas filas que faltan, que la rotación conserva lo que debe, que
`purgar` no toca los adjuntos, y que un `pg_dump` que muere a mitad no deja
basura que luego parezca un respaldo bueno.

---

## Cortafuegos — dos capas, las dos importan

### 1. Security List de Oracle (la que más se olvida)

Consola → VCN `vcn-20261001-1009` → Security → Default Security List → Ingress.

> 🔴 **El número del puerto va en `Destination Port Range`, NO en
> `Source Port Range`.** Un cliente se conecta *desde* un puerto aleatorio
> *hacia* el suyo. Si queda en el campo equivocado la regla no aplica nunca, y
> la columna «Allows» lo delata: debe decir *«TCP traffic for ports: 443»*, no
> *«ports: All»*.

| Origen | Protocolo | Destination Port | Para qué |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 80 | HTTP |
| `0.0.0.0/0` | TCP | 443 | HTTPS |
| `0.0.0.0/0` | TCP | 3478 | TURN |
| `0.0.0.0/0` | UDP | 3478 | TURN |
| `0.0.0.0/0` | UDP | 49152-65535 | Relay de medios |

### 2. ufw en el servidor

```bash
sudo ufw status verbose
```

> Las imágenes Ubuntu de Oracle traen reglas de `iptables` preinstaladas que
> rechazan todo menos el 22, persistidas por `netfilter-persistent`. **En este
> servidor se purgó ese paquete** y manda `ufw`. Si algún día reinstala Ubuntu,
> acuérdese: abrir el puerto en Oracle y en ufw no basta mientras esa regla
> siga ahí.

---

## Cloudflare

| | |
|---|---|
| Registro A `falconcad.com.co` | `157.137.211.196` · proxy 🟠 |
| Registro A `nuevo` | `157.137.211.196` · proxy 🟠 (temporal, se puede borrar) |
| Registro A `falcon-test` | IP del Servidor B · proxy 🟠 |
| Modo SSL/TLS | **Full (strict)** |
| Certificado | **Cloudflare Origin CA**, vence en 2041 |

El certificado de origen **no lo valida un navegador**: solo Cloudflare confía
en esa autoridad. Por eso entrar por IP directa siempre muestra «no es seguro».
Para probar un servidor sin tocar producción, use un subdominio con proxy
(como `nuevo.`), nunca la IP.

Renovarlo (en 2041, o si se compromete): Cloudflare → SSL/TLS → Origin Server →
Create Certificate, y reemplazar `certs/origin.pem` y `certs/origin.key`.

---

## Diagnóstico rápido

```bash
cd ~/falcon-deploy

# Estado general
docker compose ps
curl -s https://falconcad.com.co/api/health; echo
systemctl is-active coturn

# Logs (las tres réplicas: un error puede estar en cualquiera)
docker compose logs --tail 100 backend1 backend2 backend3
docker compose logs --tail 100 nginx

# Datos
docker compose exec -T postgres psql -U falcon -d falcon_cad \
  -c 'SELECT codigo, nombre FROM tenants ORDER BY codigo;' \
  -c 'SELECT count(*) FROM casos;'

# Espacio en disco (las grabaciones crecen)
df -h /
docker system df
```

### Síntomas y causa

| Síntoma | Dónde mirar |
|---|---|
| «No se pudo armar el enlace… FRONTEND_URL» | nginx no manda `X-Forwarded-Host`, o falta en `nginx.conf` |
| Videollamada en negro **solo en datos móviles** | coturn: `systemctl status coturn`, y el `relay` en Trickle ICE |
| «La grabación no se está guardando completa… por tamaño» | `client_max_body_size` en el bloque de nginx que atiende `/api/` |
| El despachador no ve al ciudadano aunque este entró | WebSocket: cabeceras `Upgrade`/`Connection` en `location /socket.io/` |
| SMS no llega y el sistema dice que sí | `docker compose logs backend1 \| grep -i infobip` — trae el estado real y el `messageId` |
| Un caso aparece en una réplica y no en otra | Redis: `docker compose logs redis`, y `REDIS_URL` en los tres backends |
| **403 Forbidden** en el dominio, con el despliegue en verde | nginx no ve `index.html`: su montaje quedó atado a un directorio viejo — ver «Editar archivos montados» |
| Una pantalla guarda **unas veces sí y otras no**, o una ruta nueva da 404 a ratos | Las réplicas corren versiones distintas. Compare las CAPAS, no el id de la imagen (cada réplica tiene su propio nombre de imagen y los ids siempre difieren): `docker inspect -f '{{.RootFS.Layers}}' $(docker inspect -f '{{.Image}}' $(docker compose ps -q backend1))` en las tres debe dar lo mismo |

### Reiniciar sin perder datos

```bash
docker compose restart backend1 backend2 backend3   # solo la aplicación
docker compose up -d --force-recreate nginx         # tras tocar nginx.conf o runtime.json
sudo systemctl restart coturn                       # tras tocar turnserver.conf
```

> 🔴 **Nunca `docker compose down -v`.** Esa `-v` borra el volumen `pgdata`:
> los 31 municipios, sus casos y las grabaciones. `down` a secas es seguro.

---

## Editar archivos montados en un contenedor

```bash
nano nginx.conf                                  # ✅ el contenedor lo ve al recargar
sed -i 's/algo/otra/' nginx.conf                 # ❌ rompe el montaje
```

`sed -i` **no edita** el archivo: crea uno nuevo y lo renombra encima. Un *bind
mount* de un archivo suelto queda atado al archivo original, así que el
contenedor se queda con el de antes y `nginx -s reload` no ayuda.

Si ya lo hizo, recréelo:

```bash
docker compose up -d --force-recreate nginx
docker compose exec nginx nginx -T | grep client_max_body_size   # verifique que cambió
```

### Lo mismo pasa con el DIRECTORIO del frontend

Un *bind mount* de un directorio queda atado al **inodo** que existía al crear
el contenedor. Si alguna vez se reemplazó `frontend-dist/` entero (un `mv`, un
`rm -rf` + `mkdir`), nginx sigue mirando la carpeta anterior: sirve el frontend
viejo o, si ese inodo quedó vacío, devuelve **403 Forbidden** — aunque en el
host los archivos estén perfectos, con los permisos correctos y recién
publicados. `chmod`, `cp` y volver a desplegar no lo arreglan, porque el
problema no está en el host.

Para distinguirlo en un paso —el host contra lo que ve el contenedor:

```bash
cd ~/falcon-deploy
md5sum frontend-dist/index.html
docker compose exec -T nginx md5sum /usr/share/nginx/html/index.html
```

Si no coinciden, o el segundo falla, reenganche el montaje:

```bash
docker compose up -d --force-recreate --no-deps nginx
```

`--no-deps` evita que se reinicien los tres backends de paso. El registro
delata el caso: `directory index of "/usr/share/nginx/html/" is forbidden`
significa literalmente que nginx mira la carpeta y no encuentra `index.html`.

Desde la versión actual, `deploy-falcon.sh` compara esos dos `md5sum` al
publicar y recrea nginx solo si hace falta, así que esto no debería volver a
aparecer en un despliegue normal.

---

## pgAdmin

Apagado por defecto. Se enciende solo cuando hace falta:

```bash
docker compose --profile admin up -d pgadmin
ssh -L 5050:localhost:5050 -i "C:\Users\acer\Downloads\ssh-key-2026-10-01.key" ubuntu@157.137.211.196
# → http://localhost:5050
docker compose stop pgadmin        # apagarlo al terminar
```

El puerto está atado a `127.0.0.1`: solo se alcanza por túnel SSH, nunca desde
internet.

---

## Pendientes conocidos

- **Respaldos fuera del servidor.** El script ya los sube, pero falta crear
  la URL prefirmada de Object Storage y definir `FALCON_RESPALDO_URL`. Hasta
  entonces las copias viven en el mismo disco que protegen.
- **Retención de grabaciones sin decidir.** `purgar` existe y no borra nada
  por su cuenta; falta fijar el plazo y ponerlo en el cron.
- **Nada avisa si el sitio se cae.** Falta un monitor externo contra
  `https://falconcad.com.co/api/health`.
- **La credencial del TURN del Servidor B está comprometida**: estuvo en un
  repositorio público y sigue en el historial de git. Hay que rotarla en el
  coturn de ese servidor y actualizar el frontend de SECAD.
- **Infobip sin aprobar.** Los SMS con enlace no se entregan hasta que
  aprueben la solicitud de acceso. Mientras tanto, el código corto se dicta.
- **Datos reales en `falcon-test`.** Ese servidor tiene una copia de los casos
  de 31 municipios, con nombres y teléfonos. Si se le da a alguien para probar,
  conviene anonimizarlo.
