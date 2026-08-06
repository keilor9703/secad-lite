# Publicar el frontend en Vercel

## 1. Ajustes del proyecto en Vercel

Al importar el repositorio, en **Settings → General**:

| Campo | Valor |
|---|---|
| **Root Directory** | `frontend` |
| Framework Preset | Angular (o *Other*; `vercel.json` manda igual) |
| Build Command | *(lo toma de `vercel.json`)* |
| Output Directory | *(lo toma de `vercel.json`)* |

El **Root Directory es obligatorio**: el repositorio tiene `frontend/` y
`backend/` uno al lado del otro, y Vercel construiría la raíz, donde no hay
aplicación.

## 2. Por qué fallaba con NOT_FOUND

Angular 17 en adelante (constructor `@angular/build:application`) deja el sitio
en `dist/<proyecto>/**browser**/`, no en `dist/<proyecto>/`. Vercel servía la
carpeta de arriba, que solo contiene `browser/`, `prerendered-routes.json` y las
licencias — **sin `index.html`**, de ahí el 404 en la raíz.

`frontend/vercel.json` lo resuelve apuntando a `dist/frontend/browser`.

## 3. Rutas internas (el 404 que vendría después)

Es una aplicación de una sola página: `/recepcion` o `/admin` no son archivos.
Sin reescritura, entrar directo a esas direcciones o recargar la página daría
404. La regla de `vercel.json` manda todo a `index.html`… **salvo `/api/`**,
que se deja pasar a propósito (ver el punto siguiente): si también se
reescribiera, las llamadas a la API recibirían el HTML de la aplicación y los
errores serían incomprensibles.

## 4. Conectar con el backend

En producción, `apiBaseUrl` es `/api` (relativo). Falta decirle a Vercel a dónde
enviar eso. Agregue la redirección **antes** de la regla comodín:

```json
"rewrites": [
  { "source": "/api/:ruta*", "destination": "https://SU-BACKEND/api/:ruta*" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

Así el navegador ve un solo origen: no hay CORS ni contenido mixto, y las
cookies y cabeceras viajan sin sorpresas.

**Alternativa**: poner la URL completa del backend en
`src/environments/environment.prod.ts` y habilitar CORS allá. Funciona, pero
exige que el backend esté en **https** — un navegador en https bloquea las
llamadas a http, y el error que muestra no dice eso con claridad.

Mientras no exista backend público, el sitio carga pero el inicio de sesión
falla: es lo esperado.

## 5. Lo que Vercel no puede alojar

Solo se publica el frontend. El backend (NestJS + PostgreSQL) y el canal en
vivo de la planta telefónica (Socket.IO) necesitan un proceso permanente:
Railway, Render, Fly.io o una máquina propia. Las funciones de Vercel no
sostienen conexiones abiertas, así que el aviso de llamada entrante no
funcionaría desde allí.

## 6. Comprobar antes de publicar

```bash
cd frontend
npm ci
npm run build
ls dist/frontend/browser/index.html    # debe existir
npx http-server dist/frontend/browser  # o cualquier servidor estático
```
