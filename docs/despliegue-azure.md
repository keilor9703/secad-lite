# Publicar FALCON CAD en Azure (Front Door + Container Apps + Blob Storage)

Guía equivalente a [`despliegue-demo.md`](despliegue-demo.md), pero para la
arquitectura que propusieron los ingenieros:

```
Operador / PBX / WhatsApp / Sistema externo
        │
        ▼
  Front Door Standard  ──▶  WAF (regla de rate-limit)
        │
        ├── /api/*  ──▶  Container Apps (backend, 2 réplicas)
        │                       │              │
        │                       ▼              ▼
        │              Cache for Redis   PostgreSQL Flexible Server
        │
        └── /*      ──▶  Blob Storage (sitio estático, frontend)
```

**No es una arquitectura distinta a la de Oracle OCI: son las mismas cuatro
piezas (nginx/frontend, backend, Postgres, Redis) alquiladas por separado en
vez de vivir en una VM que usted administra.** Tabla de equivalencia, para no
perder el hilo de lo que ya conoce:

| En su VM de Oracle (Docker Compose) | En Azure |
|---|---|
| Cloudflare por delante | Front Door Standard + WAF |
| Contenedor `nginx` (sirve el Angular compilado) | Blob Storage (sitio estático) |
| Contenedor del backend (`node dist/main.js`) | Container Apps |
| Contenedor `postgres` | PostgreSQL Flexible Server |
| Contenedor `redis` | Azure Cache for Redis |
| `ssh` + `git pull` + `docker compose up -d --build` | GitHub Actions: build → push a un registro → actualizar la app |

El código de la aplicación **no cambia nada**. Lo único que cambia es dónde
vive cada pieza y cómo se sube el código nuevo. El `backend/Dockerfile` que ya
existe en el repositorio (el mismo que usa Docker Compose) es exactamente el
que se construye y sube a Azure — no hay que tocarlo.

> **Antes de empezar**, lea la sección [9. Lo que falta para ser "producción
> real"](#9-lo-que-falta-para-ser-producción-real): tanto Postgres como Redis
> están planteados "sin HA" (sin respaldo automático si el nodo se cae), algo
> que vale la pena conversar con los ingenieros antes de comprometerse con
> esto para un sistema de despacho de emergencias.

---

## 0. Requisitos previos

- Una cuenta de Azure con una suscripción activa.
- El [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
  instalado (`az`), o usar el **Cloud Shell** del portal (ya lo trae).
- Un dominio propio (o subdominio) que apunte, al final, a Front Door. Puede
  usar uno temporal (`*.azurefd.net`) mientras prueba.
- `az login` hecho, y elegida la suscripción correcta con
  `az account set --subscription "<nombre-o-id>"`.

Convención de nombres usada en esta guía (cámbielos por los suyos, pero manténgalos
consistentes): grupo de recursos `rg-falcon-cad`, región `eastus2` (elija la
más cercana a sus usuarios). Todo se crea en el mismo grupo de recursos, para
poder borrarlo entero si algo sale mal en las pruebas:

```bash
az group create --name rg-falcon-cad --location eastus2
```

---

## 1. Base de datos: PostgreSQL Flexible Server

Equivale al contenedor `postgres` de Docker Compose, pero gestionado
(parches, backups automáticos).

```bash
az postgres flexible-server create \
  --resource-group rg-falcon-cad \
  --name falcon-cad-db \
  --location eastus2 \
  --admin-user falconadmin \
  --admin-password "UNA-CLAVE-LARGA-Y-ALEATORIA" \
  --sku-name Standard_B2s \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access 0.0.0.0-255.255.255.255   # ver nota abajo
```

Cree la base de datos propia (por defecto el servidor trae `postgres`):

```bash
az postgres flexible-server db create \
  --resource-group rg-falcon-cad \
  --server-name falcon-cad-db \
  --database-name falcon_cad
```

**Sobre `--public-access`**: lo más correcto es *no* exponer el servidor a
todo internet, sino permitir solo la red de Container Apps (regla de
firewall con el rango de salida del entorno de Container Apps, o integración
VNet). Para arrancar y probar rápido, `0.0.0.0-255.255.255.255` funciona (el
servidor sigue exigiendo usuario/clave/TLS), pero antes de ir a producción
real, ciérrelo a la red de Container Apps — es la misma lógica del puerto
`5433` de Postgres, ligado a `127.0.0.1` en su Compose actual.

### Cadena de conexión

Con TLS obligatorio (Azure lo exige):

```
DATABASE_URL=postgres://falconadmin:UNA-CLAVE-LARGA-Y-ALEATORIA@falcon-cad-db.postgres.database.azure.com:5432/falcon_cad
DB_SSL=true
```

Para validar el certificado de verdad (recomendado; sin esto, `DB_SSL=true`
cifra pero no valida contra quién se está hablando — vea el comentario en
`backend/.env.example`), descargue la CA de Azure y péguela completa en
`DB_SSL_CA`:

```bash
curl -o /tmp/DigiCertGlobalRootCA.crt.pem \
  https://dl.cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem
```

El contenido de ese archivo (el PEM completo, con las líneas
`-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`) es el valor de
`DB_SSL_CA` en Container Apps (como *secret*, ver §3).

### Migraciones

Ya existe el mecanismo para esto en el propio backend: con
`DB_SYNC=false` y `DB_MIGRATE=true`, la aplicación aplica las migraciones
versionadas de `backend/src/migrations` **sola, al arrancar** — es lo mismo
que ya usa Render en `despliegue-demo.md`. No hace falta entrar a ningún
servidor a correr un comando (ver §6 para el matiz de las 2 réplicas).

---

## 2. Caché: Azure Cache for Redis

Equivale al contenedor `redis`. Con 2 réplicas del backend, esto **no es
opcional**: el aviso en vivo por Socket.IO (PBX, chat interno) y el tope de
intentos de login necesitan este canal compartido para que un operador
conectado a una réplica se entere de lo que pasa en la otra — sin `REDIS_URL`
cada réplica quedaría con su propia memoria aislada.

```bash
az redis create \
  --resource-group rg-falcon-cad \
  --name falcon-cad-redis \
  --location eastus2 \
  --sku Basic \
  --vm-size c0
```

Tarda varios minutos en aprovisionar. Obtenga la clave de acceso:

```bash
az redis list-keys --resource-group rg-falcon-cad --name falcon-cad-redis
```

Azure Cache for Redis exige TLS, puerto `6380` (no el `6379` de Docker
local). El backend ya usa `ioredis`, que entiende el esquema `rediss://`
(con doble "s") para TLS sin configuración adicional:

```
REDIS_URL=rediss://:LA-CLAVE-PRIMARIA@falcon-cad-redis.redis.cache.windows.net:6380
```

---

## 3. Backend: Container Apps

Equivale al contenedor del backend en Compose. Tres piezas: un **registro de
contenedores** (donde vive la imagen Docker, como un Docker Hub privado
propio), un **entorno de Container Apps**, y la **app** en sí.

### 3.1 Registro de contenedores (ACR)

```bash
az acr create \
  --resource-group rg-falcon-cad \
  --name falconcadacr \
  --sku Basic \
  --admin-enabled true
```

### 3.2 Construir y subir la imagen

Esto es el equivalente de `docker build` + `docker push`, pero usando el
`backend/Dockerfile` que ya existe en el repo (sin tocarlo):

```bash
az acr build \
  --registry falconcadacr \
  --image falcon-cad-api:latest \
  ./backend
```

`az acr build` construye la imagen **dentro de Azure** (no hace falta Docker
instalado localmente) y la deja lista en el registro. Este es exactamente el
comando que la CI/CD (§7) ejecuta en cada `git push`.

### 3.3 Entorno + Container App

```bash
az containerapp env create \
  --resource-group rg-falcon-cad \
  --name falcon-cad-env \
  --location eastus2

az containerapp create \
  --resource-group rg-falcon-cad \
  --name falcon-cad-api \
  --environment falcon-cad-env \
  --image falconcadacr.azurecr.io/falcon-cad-api:latest \
  --registry-server falconcadacr.azurecr.io \
  --target-port 3000 \
  --ingress external \
  --cpu 0.5 --memory 1Gi \
  --min-replicas 2 --max-replicas 2 \
  --env-vars PORT=3000 DB_SYNC=false DB_MIGRATE=true DB_SSL=true JWT_EXPIRES=8h
```

`--target-port 3000` importa: es el puerto donde ya escucha `main.ts`
(`process.env.PORT ?? 3000`), y Container Apps enruta el tráfico ahí.

### 3.4 Secretos (el equivalente del `.env`)

Lo que en su VM es el archivo `.env` (fuera del control de versiones), en
Container Apps son *secrets* — se guardan cifrados y se referencian desde las
variables de entorno, nunca quedan en texto plano en la definición de la app:

```bash
az containerapp secret set \
  --resource-group rg-falcon-cad \
  --name falcon-cad-api \
  --secrets \
    database-url="postgres://falconadmin:CLAVE@falcon-cad-db.postgres.database.azure.com:5432/falcon_cad" \
    jwt-secret="$(openssl rand -hex 32)" \
    redis-url="rediss://:CLAVE@falcon-cad-redis.redis.cache.windows.net:6380" \
    db-ssl-ca="$(cat /tmp/DigiCertGlobalRootCA.crt.pem)"

az containerapp update \
  --resource-group rg-falcon-cad \
  --name falcon-cad-api \
  --set-env-vars \
    DATABASE_URL=secretref:database-url \
    JWT_SECRET=secretref:jwt-secret \
    REDIS_URL=secretref:redis-url \
    DB_SSL_CA=secretref:db-ssl-ca
```

Tabla completa de variables (mismas que `backend/.env.example`, resumidas):

| Variable | Origen | Nota |
|---|---|---|
| `PORT` | valor fijo `3000` | debe coincidir con `--target-port` |
| `DATABASE_URL` | secret | Postgres Flexible Server, §1 |
| `JWT_SECRET` | secret | generado una vez, nunca cambia sin invalidar sesiones |
| `JWT_EXPIRES` | valor fijo | `8h` |
| `DB_SYNC` | valor fijo | `false` en producción |
| `DB_MIGRATE` | valor fijo | `true` — ver matiz en §6 |
| `DB_SSL` | valor fijo | `true` |
| `DB_SSL_CA` | secret | PEM de la CA de Azure, §1 |
| `REDIS_URL` | secret | Azure Cache for Redis, §2 |
| `CORS_ORIGINS` | — | **no hace falta** si el frontend cuelga del mismo dominio vía Front Door — ver §5 |
| `WHATSAPP_APP_SECRET` | secret | solo si usa el canal de WhatsApp |
| `GOOGLE_MAPS_API_KEY` | secret o valor fijo | la sirve el propio backend al frontend, ver §4.1 |

### 3.5 Comprobar

```bash
az containerapp show \
  --resource-group rg-falcon-cad --name falcon-cad-api \
  --query properties.configuration.ingress.fqdn -o tsv
```

Abra `https://<ese-fqdn>/api/health` — debe responder
`{"ok":true,"servicio":"falcon-cad-api", ...}`, igual que en Render.

---

## 4. Frontend: Blob Storage (sitio estático)

Equivale al contenedor `nginx`, que hoy sirve los archivos que deja
`ng build`. Blob Storage con "sitio estático" hace exactamente eso, sin
servidor: sube los archivos y los sirve como HTTP.

### 4.1 Antes de compilar: la URL de la API

**Este es el mismo paso crítico que ya conoce de Vercel**, con una diferencia
a favor: con Front Door unificando todo bajo un solo dominio (§5), lo más
simple es dejar `frontend/src/environments/environment.prod.ts` con
`ORIGEN_API` **vacío**:

```ts
const ORIGEN_API = '';
```

Con esto, el navegador llama a `/api` en su propio origen (el dominio de
Front Door), y Front Door reenvía esas rutas al backend (§5). A diferencia de
la reescritura de Vercel — que documenta `despliegue-vercel.md` como
incapaz de reenviar websockets —, **Front Door sí sostiene la conexión de
Socket.IO** a través de la regla `/api/*`, porque es un proxy real y no una
reescritura estática. Es decir: en Azure, a diferencia de Vercel, dejar
`ORIGEN_API` vacío no le cuesta el aviso de llamada entrante en vivo.

(Si en cambio prefiere un dominio distinto para el frontend y otro para la
API, use la URL completa del backend como en Vercel/Render, y entonces sí
hace falta llenar `CORS_ORIGINS` en el backend con el dominio del frontend.)

Confirme el cambio y súbalo al repositorio antes de compilar — el valor se
incrusta en el JavaScript al construir.

`GOOGLE_MAPS_API_KEY` (el buscador de direcciones de Recepción) **no se toca
acá**: no es una variable de Angular, la sirve el propio backend en
`GET /api/geografia/mapas-config` a partir de la variable de entorno del
mismo nombre en Container Apps (agréguela junto a las demás en la tabla de
§3.4). El frontend la pide en tiempo real al abrir el mapa. Recuerde
restringirla en Google Cloud Console al dominio final de Front Door.

### 4.2 Compilar

```bash
cd frontend
npm ci
npm run build -- --configuration production
```

Esto deja los archivos en `dist/frontend/browser` (el mismo directorio que
usa `frontend/vercel.json` como `outputDirectory`).

### 4.3 Crear la cuenta de almacenamiento y habilitar el sitio estático

```bash
az storage account create \
  --resource-group rg-falcon-cad \
  --name falconcadweb \
  --location eastus2 \
  --sku Standard_LRS \
  --kind StorageV2

az storage blob service-properties update \
  --account-name falconcadweb \
  --static-website \
  --index-document index.html \
  --404-document index.html
```

El `404-document = index.html` es el equivalente exacto de la regla de
`vercel.json` (`rewrites` hacia `/index.html`): Angular es una SPA de una
sola página, y cualquier ruta que no exista como archivo físico
(`/casos/123`, por ejemplo) debe devolver igual el `index.html` para que el
router de Angular la resuelva en el navegador.

### 4.4 Subir los archivos

Esto es el "`git pull` + reiniciar nginx" de este modelo:

```bash
az storage blob upload-batch \
  --account-name falconcadweb \
  --destination '$web' \
  --source dist/frontend/browser \
  --overwrite
```

La URL del sitio queda en:

```bash
az storage account show \
  --name falconcadweb --resource-group rg-falcon-cad \
  --query primaryEndpoints.web -o tsv
```

(del estilo `https://falconcadweb.z13.web.core.windows.net/`) — pero esta URL
**no la va a usar el público**: es un origen interno para Front Door (§5).

---

## 5. Front Door Standard + WAF

Esta es la pieza que unifica todo bajo un solo dominio público y reparte el
tráfico: `/api/*` al backend, todo lo demás al sitio estático. Recomendación
práctica: **hágalo desde el Portal** (Azure Portal → "Front Door and CDN
profiles" → *Explore other offerings* → *Azure Front Door* → **Quick create**),
porque el asistente arma los dos orígenes y las dos rutas en un solo
formulario y es más difícil equivocarse que a mano con CLI. Los datos a
llenar:

| Campo del asistente | Valor |
|---|---|
| Endpoint name | `falcon-cad` (o el que prefiera) |
| Origin type (origen 1) | **Container App** → seleccione `falcon-cad-api` |
| Origin path (origen 1) | dejar vacío |
| Route pattern (origen 1) | `/api/*` |
| Origin type (origen 2) | **Storage static website** → seleccione `falconcadweb` |
| Route pattern (origen 2) | `/*` |
| WAF policy | cree una nueva, modo **Prevention** |

Tras crearlo, Azure entrega un dominio temporal
`https://falcon-cad-xxxxx.z01.azurefd.net` — pruebe con ese antes de conectar
su dominio propio.

### 5.1 Dominio propio + TLS

En el perfil de Front Door → **Domains** → agregue su dominio
(`cad.suempresa.com`). Front Door pide validarlo (un registro `TXT` o
`CNAME` en su DNS) y luego **emite y renueva el certificado TLS solo** —
nada que administrar a mano, a diferencia de Cloudflare/Let's Encrypt en su
VM actual, donde usted ya lo tenía resuelto pero sí era una pieza que
mantener.

### 5.2 Regla de rate-limit en el WAF

En la política WAF creada arriba → **Custom rules** → **Add custom rule**:

| Campo | Valor sugerido |
|---|---|
| Rule type | Rate limit rule |
| Match condition | (según lo que quieran limitar: todo, o solo `/api/auth/login`) |
| Rate limit threshold | p. ej. 100 peticiones por IP por minuto — ajuste según su volumen real |
| Time window | 1 minuto |
| Action | Block |

Esto es una capa adicional al tope de intentos de login que ya tiene el
backend (el que usa `REDIS_URL` compartido entre réplicas) — el WAF frena a
nivel de red, antes de que la petición llegue siquiera a Container Apps.

### 5.3 Verificar

Con el dominio final funcionando:

- `https://cad.suempresa.com/` → debe cargar el Angular compilado.
- `https://cad.suempresa.com/api/health` → debe responder el JSON de salud.
- Inicie sesión y confirme que el aviso de llamada entrante (si usa PBX/WhatsApp)
  sigue llegando en vivo — es la prueba de que el WebSocket atraviesa Front
  Door correctamente.

---

## 6. Migraciones con 2 réplicas: el matiz

`DB_MIGRATE=true` (§1) hace que **cada réplica que arranca** intente aplicar
las migraciones pendientes. Con una sola instancia (como en Render) esto es
inofensivo. Con 2 réplicas arrancando casi al mismo tiempo — típicamente solo
pasa en el **primer despliegue**, o en uno que trae una migración nueva —
existe una ventana pequeña donde ambas podrían intentarlo a la vez.

Recomendación simple, sin tocar código: en cualquier despliegue que incluya
migraciones nuevas, escale momentáneamente a 1 réplica, despliegue, y vuelva
a 2 una vez que el health check esté en verde:

```bash
az containerapp update --name falcon-cad-api --resource-group rg-falcon-cad --min-replicas 1 --max-replicas 1
# ... esperar a que /api/health responda 200 con la imagen nueva ...
az containerapp update --name falcon-cad-api --resource-group rg-falcon-cad --min-replicas 2 --max-replicas 2
```

Para un despliegue normal sin migraciones nuevas, no hace falta este paso.

---

## 7. Despliegue continuo: el equivalente de `git pull`

En Oracle, publicar es: entrar por SSH, `git pull`, `docker compose up -d
--build`. Aquí no hay servidor al que entrar — el equivalente es un
**pipeline de CI/CD** que, en cada `git push` a `main`, hace exactamente eso
mismo pero contra los servicios gestionados. Con GitHub Actions:

### 7.1 Autenticar GitHub Actions contra Azure

```bash
az ad sp create-for-rbac \
  --name falcon-cad-github \
  --role contributor \
  --scopes /subscriptions/<ID-SUSCRIPCION>/resourceGroups/rg-falcon-cad \
  --sdk-auth
```

El JSON que imprime este comando se guarda como *secret* del repositorio en
GitHub (**Settings → Secrets and variables → Actions**) con el nombre
`AZURE_CREDENTIALS`.

### 7.2 El workflow

`.github/workflows/deploy-azure.yml`:

```yaml
name: Deploy a Azure

on:
  push:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Construir y publicar imagen
        run: |
          az acr build --registry falconcadacr --image falcon-cad-api:${{ github.sha }} ./backend
      - name: Actualizar Container App
        run: |
          az containerapp update \
            --resource-group rg-falcon-cad \
            --name falcon-cad-api \
            --image falconcadacr.azurecr.io/falcon-cad-api:${{ github.sha }}

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Compilar Angular
        run: |
          cd frontend
          npm ci
          npm run build -- --configuration production
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Publicar en Blob Storage
        run: |
          az storage blob upload-batch \
            --account-name falconcadweb \
            --destination '$web' \
            --source frontend/dist/frontend/browser \
            --overwrite
      - name: Purgar caché de Front Door
        run: |
          az afd endpoint purge \
            --resource-group rg-falcon-cad \
            --profile-name falcon-cad \
            --endpoint-name falcon-cad \
            --content-paths '/*'
```

Cada etiqueta de imagen usa `github.sha` (el commit) en vez de `latest`: así
cada despliegue queda identificado con el commit exacto que lo generó, y
`az containerapp update` crea una **revisión nueva** — Container Apps hace el
cambio sin caída (arranca la revisión nueva, espera a que pase el health
check, y solo entonces retira la anterior), algo que su `docker compose up -d
--build` actual no hace (hay una ventana de caída mientras el contenedor
se reinicia).

La "purga de caché de Front Door" del último paso es necesaria porque, a
diferencia de nginx (que sirve el archivo tal cual cada vez), Front Door
cachea el contenido estático en el borde — según el diagrama, con `TTL=0`
configurado para el frontend, en teoría no cachea nada, pero purgar tras cada
despliegue es una red de seguridad barata.

Con esto, "publicar" vuelve a ser `git push` — solo que ahora lo hace un
robot en vez de usted por SSH.

---

## 8. Checklist de primer despliegue, de punta a punta

1. [ ] Grupo de recursos creado (§0).
2. [ ] PostgreSQL Flexible Server creado, base `falcon_cad` creada (§1).
3. [ ] Azure Cache for Redis creado, clave copiada (§2).
4. [ ] ACR creado; imagen construida y subida con `az acr build` (§3.2).
5. [ ] Entorno + Container App creados, con `--min-replicas 1` **por ahora**
   (déjelo en 1 hasta after el primer arranque con migraciones, §6).
6. [ ] Secretos configurados en Container Apps (§3.4).
7. [ ] `/api/health` responde 200 en el FQDN de Container Apps.
8. [ ] `environment.prod.ts` con `ORIGEN_API = ''` (§4.1), commiteado.
9. [ ] Frontend compilado y subido a Blob Storage con sitio estático
   habilitado (§4).
10. [ ] Front Door creado con las dos rutas (`/api/*`, `/*`) y WAF en modo
    Prevention (§5).
11. [ ] Dominio propio conectado y certificado TLS emitido (§5.1).
12. [ ] Regla de rate-limit del WAF configurada (§5.2).
13. [ ] Login funciona (`superadmin`/`demo` en el tenant `demo`, si partió de
    los datos de siembra) y el aviso en vivo llega — confirma que el
    WebSocket atraviesa Front Door.
14. [ ] Escalar Container Apps de vuelta a `--min-replicas 2` (§6).
15. [ ] Workflow de GitHub Actions configurado y probado con un commit de
    prueba (§7).

---

## 9. Lo que falta para ser "producción real"

Igual que `despliegue-demo.md` lo hace explícito para el plan gratuito de
Render/Supabase, esta arquitectura — tal como está en el diagrama — tiene dos
puntos que vale la pena resolver con los ingenieros antes de depender de ella
para despacho de emergencias real:

- **Postgres Flexible Server Burstable B2s, sin HA**: si el nodo falla, hay
  caída hasta que Azure lo repare — sin conmutación automática a un
  standby. Para eso existe la opción de **zona redundante (HA)** en el mismo
  servicio, a un costo mayor. Pregunte por el RTO/RPO que están asumiendo.
- **Redis Basic C0, sin HA**: el plan **Standard** agrega una réplica con
  conmutación automática. Sin ella, si el nodo de Redis cae, el sistema
  **sigue funcionando** (el código ya está preparado para eso — cada réplica
  vuelve a memoria local), pero se pierde el aviso en vivo compartido entre
  réplicas hasta que Redis vuelva.
- **Backups de Blob Storage y del registro de contenedores**: `Standard_LRS`
  replica dentro de un solo datacenter. Si la región entera tiene un
  problema, no hay copia en otra región — evalúe `GRS` si eso les preocupa.
- **Alertas**: ninguno de los pasos de arriba configura monitoreo. Azure
  Monitor puede avisar si Container Apps reinicia en bucle, si Postgres se
  queda sin espacio, o si el WAF empieza a bloquear tráfico legítimo — vale
  la pena configurarlo antes de confiar en esto para producción.

Nada de esto es un defecto del plan de los ingenieros — es exactamente lo
mismo que pasaría con una sola VM en Oracle sin réplica ni respaldo
automático. La diferencia es que en Azure, subir a HA es una casilla que se
marca (con su costo asociado), mientras que en Oracle sería levantar y
mantener una segunda VM a mano.
