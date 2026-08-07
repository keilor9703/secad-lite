# Publicar FALCON CAD para demostración — Supabase + Render + Vercel

Guía para dejar el sistema funcionando en internet **con fines de muestra y
prueba**. No es un despliegue de producción: al final hay una lista explícita de
lo que faltaría para serlo.

El reparto es:

| Pieza | Dónde | Qué queda ahí |
|---|---|---|
| Base de datos | **Supabase** | PostgreSQL gestionado |
| API + canal en vivo | **Render** | El proceso NestJS (`backend/`) |
| Interfaz | **Vercel** | El sitio Angular (`frontend/`) |

> **El orden importa.** Render necesita la cadena de conexión de Supabase;
> Vercel necesita la URL de Render; y Render necesita, al final, el dominio de
> Vercel para autorizarlo por CORS. Por eso el último paso vuelve a Render.

---

## 1. Base de datos en Supabase

1. Cree un proyecto en <https://supabase.com> (plan gratuito). Anote la
   contraseña de la base: **solo se muestra una vez**.
2. Espere a que el proyecto termine de aprovisionarse.
3. Botón **Connect** (arriba) → pestaña **ORMs** o **Connection string**.
4. Copie la cadena de la **Session pooler**, con esta forma:

   ```
   postgresql://postgres.abcdefghijklm:CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

**Use la del pooler, no la conexión directa.** La directa
(`db.<ref>.supabase.co`) solo resuelve por IPv6, y las instancias del plan
gratuito de Render salen por IPv4: la conexión fallaría con un
`ENETUNREACH` difícil de diagnosticar. El host del pooler
(`...pooler.supabase.com`) atiende por IPv4.

Si la contraseña tiene caracteres como `@`, `#`, `/` o `:`, hay que
codificarlos en porcentaje dentro de la cadena (`@` → `%40`). Lo más simple es
generar la contraseña sin símbolos.

No hay que crear tablas a mano: **las migraciones se aplican solas** al arrancar
la API (paso 2), y al primer arranque se siembran el tenant `demo`, sus
usuarios, agencias, canales, códigos de caso y códigos de cierre.

---

## 2. API en Render

### 2.1 Crear el servicio

Con el archivo `render.yaml` que está en la raíz del repositorio:
**New → Blueprint** → elija el repositorio → Render lee la configuración sola.

O a mano, con **New → Web Service**:

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `node dist/main.js` |
| Health Check Path | `/api/health` |
| Instance Type | Free |

El **Root Directory es obligatorio**: el repositorio tiene `frontend/` y
`backend/` uno al lado del otro, y Render construiría la raíz, donde no hay
aplicación.

### 2.2 Variables de entorno

En **Environment**:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena del pooler de Supabase del paso 1 |
| `JWT_SECRET` | Cadena larga y aleatoria (p. ej. `openssl rand -hex 32`) |
| `DB_SSL` | `true` |
| `DB_SYNC` | `false` |
| `DB_MIGRATE` | `true` |
| `JWT_EXPIRES` | `8h` |
| `NODE_VERSION` | `22` |
| `CORS_ORIGINS` | *(se completa en el paso 4)* |

`DB_SYNC=false` + `DB_MIGRATE=true` es la combinación correcta: el esquema lo
aplican las migraciones versionadas de `backend/src/migrations`, revisadas y
en el repositorio. Dejar `DB_SYNC=true` contra una base publicada permitiría
que un cambio de entidad alterara tablas con datos sin que nadie lo revise.

**No hay que definir `PORT`**: Render lo inyecta y la aplicación lo respeta.

### 2.3 Comprobar

Cuando el despliegue quede en *Live*, abra en el navegador:

```
https://SU-SERVICIO.onrender.com/api/health
```

Debe responder `{"ok":true,"servicio":"falcon-cad-api", ...}`. En los registros
de Render se ven las migraciones aplicándose una a una la primera vez.

Si falla, mire **Logs**:

| Mensaje | Causa |
|---|---|
| `ENETUNREACH` / `connect ETIMEDOUT` | Está usando la conexión directa de Supabase (IPv6). Cambie al pooler. |
| `no pg_hba.conf entry ... no encryption` | Falta `DB_SSL=true`. |
| `password authentication failed` | Contraseña mal copiada o con símbolos sin codificar. |
| `Falta DATABASE_URL` | La variable no quedó guardada. |

Anote la URL del servicio: hace falta en el paso 3.

---

## 3. Interfaz en Vercel

1. **Antes de desplegar**, edite `frontend/src/environments/environment.prod.ts`
   y ponga la URL de Render, **sin barra final**:

   ```ts
   const ORIGEN_API = 'https://SU-SERVICIO.onrender.com';
   ```

   Es el único valor que hay que tocar: de ahí salen tanto la URL de la API
   como la del canal en vivo. Confirme el cambio y súbalo al repositorio (el
   valor se incrusta al construir, así que sin este paso el sitio no encuentra
   la API).

2. En Vercel, **Add New → Project** → importe el repositorio y en
   **Settings → General** ponga **Root Directory = `frontend`**. El resto lo
   toma de `frontend/vercel.json`.

3. Despliegue y anote el dominio, del estilo
   `https://falcon-cad.vercel.app`.

Detalles de por qué `vercel.json` está como está (carpeta de salida y rutas de
una sola página) en [`despliegue-vercel.md`](despliegue-vercel.md).

---

## 4. Cerrar el círculo: autorizar el dominio en Render

Vuelva a Render → **Environment** → `CORS_ORIGINS`:

```
https://falcon-cad.vercel.app,https://*.vercel.app
```

La segunda entrada, con comodín de subdominio, autoriza los despliegues de
vista previa que Vercel crea en cada commit y que cambian de URL cada vez. Si
no le interesan las vistas previa, deje solo la primera: **cuanto más corta la
lista, mejor**, porque esto es justamente lo que impide que otra página use la
API con la sesión abierta del funcionario.

Guarde: Render reinicia el servicio solo.

Sin `CORS_ORIGINS` no se restringe nada y el sistema *funciona igual* — por eso
es fácil olvidarlo. Conviene ponerla.

---

## 5. Probar de punta a punta

Entre al dominio de Vercel e inicie sesión. Los usuarios sembrados son:

| Usuario | Contraseña | Rol |
|---|---|---|
| `superadmin` | `demo` | Superadministrador de la plataforma |
| `admin1` | `demo` | Administrador del secad `demo` |
| `supervisor1` | `demo` | Supervisor |
| `operador1` | `demo` | Operador |

Recorrido mínimo que ejercita las tres piezas:

1. **Recepción** → cree un caso. *(Vercel → Render → Supabase, escritura)*
2. **Despacho** → ábralo: debe pasar solo a *En gestión* y moverse de columna.
3. Asigne un recurso: pasa a *Con recursos*.
4. Ciérrelo con código de cierre y comentario.
5. **Catálogos** → agregue un código de cierre y confirme que aparece al cerrar
   el siguiente caso.

**La primera visita del día puede tardar hasta un minuto.** Es normal: ver el
punto 6.

---

## 6. Límites de los planes gratuitos

Conviene saberlos antes de una demostración en vivo, no durante.

- **Render duerme el servicio** tras 15 minutos sin tráfico. La siguiente
  petición lo despierta y tarda entre 30 y 60 segundos; la interfaz parecerá
  colgada. **Antes de mostrar el sistema, abra `/api/health` y espere a que
  responda.**
- **Supabase pausa el proyecto** tras 7 días sin actividad. Se reactiva desde
  el panel, pero no es instantáneo.
- El disco de Render es efímero y la instancia se reinicia sola cada tanto. No
  importa: todo el estado vive en Supabase.
- Sin copias de respaldo automáticas en el plan gratuito de Supabase.

Un truco razonable para una demostración agendada: un monitor gratuito
(UptimeRobot y similares) golpeando `/api/health` cada 10 minutos mantiene el
servicio despierto.

---

## 7. Qué faltaría para producción

Esto es una vitrina, no una central operando. Antes de que un secad real
despache con esto haría falta, como mínimo:

- **Contraseñas.** Los usuarios sembrados usan `demo`. Hay que borrarlos y
  crear cuentas reales.
- **TLS a la base con verificación.** Hoy `DB_SSL=true` cifra pero no valida el
  certificado del servidor (`rejectUnauthorized: false`), así que protege del
  espionaje pasivo pero no de un intermediario. En producción hay que entregar
  la CA del proveedor.
- **Copias de respaldo** con restauración probada, no solo configurada.
- **Infraestructura que no se duerma**, con varias instancias y despliegue sin
  corte.
- **Límite de tasa** en el inicio de sesión y en las rutas de integración.
- **Registro y alertas** centralizados.
- **Rotación del `JWT_SECRET`** y expiración de sesión acorde a la política de
  la entidad.
- Revisar la retención de la bitácora y de la auditoría según lo que exija la
  normativa aplicable.

Para infraestructura propia, el `docker-compose.yml` de la raíz ya levanta
PostgreSQL, y el backend solo necesita las mismas variables de este documento.
