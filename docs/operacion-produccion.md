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

El script respalda la base, trae el código, reemplaza las réplicas **de una en
una** (siempre queda alguien atendiendo), compila y publica el frontend de
golpe, y comprueba al final. Se detiene ante el primer error en vez de dejar
medio desplegado.

| Opción | Para qué |
|---|---|
| *(sin opciones)* | Despliegue completo |
| `--solo-frontend` | Solo cambió la interfaz: no toca backend ni base |
| `--solo-backend` | Solo cambió la API |
| `--sin-respaldo` | Se salta el respaldo previo — **no recomendado** |

Instalarlo o actualizarlo (viene en el repositorio):

```bash
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

Montado en el `docker-compose.yml`:

```yaml
  nginx:
    volumes:
      - ./runtime.json:/usr/share/nginx/html/config/runtime.json:ro
```

Cambiar de servidor TURN o rotar la credencial **no exige recompilar nada**:
se edita el archivo, `docker compose up -d --force-recreate nginx`, y los
navegadores lo toman al recargar.

```bash
# La credencial actual
sudo grep '^user=' /etc/turnserver.conf

# ¿Lo está sirviendo bien?
curl -s https://falconcad.com.co/config/runtime.json
```

Si eso devuelve el `index.html` en vez del JSON, el montaje no quedó.

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

## Respaldos

```bash
~/falcon-deploy/respaldo.sh            # manual
ls -lh /opt/falcon-backups/            # qué hay
crontab -l                             # la rutina nocturna (3:00 a.m.)
```

Restaurar en otro servidor:

```bash
docker compose stop backend1 backend2 backend3
docker compose exec -T postgres pg_restore -U falcon -d falcon_cad \
  --no-owner --clean --if-exists < respaldo.dump
docker compose start backend1 backend2 backend3
```

> Se paran los backends a propósito: `--clean` borra y recrea las tablas, y una
> petición a mitad del proceso encuentra la base en un estado imposible.

> ⚠️ **Las grabaciones de videollamada viven DENTRO de la base** (tabla
> `archivos_chunks`, binario). Son unos pocos MB por minuto de llamada: el
> volumen y los respaldos crecen con el uso del video. Vigile el disco.

> ⚠️ Un respaldo en la misma máquina no es un respaldo. **Pendiente**: copiarlos
> fuera del servidor (Object Storage de Oracle tiene capa gratuita).

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

- **Respaldos fuera del servidor.** Hoy viven en el mismo disco que protegen.
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
