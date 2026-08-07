# Publicar el frontend en Vercel

> Para el despliegue completo de la demostración (base en Supabase + API en
> Render + este frontend), siga [`despliegue-demo.md`](despliegue-demo.md).
> Este documento explica solo la parte de Vercel y por qué está configurada así.

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

La forma recomendada es apuntar directo al backend. En
`src/environments/environment.prod.ts` hay un único valor que cambiar:

```ts
const ORIGEN_API = 'https://SU-SERVICIO.onrender.com';
```

De ahí salen tanto `apiBaseUrl` como `wsBaseUrl`. Como el navegador hablará con
otro origen, hay que listar el dominio de Vercel en la variable `CORS_ORIGINS`
del backend. El backend debe estar en **https**: una página servida por https
no puede llamar a http, y el error del navegador no lo dice con claridad.

**Alternativa sin tocar código**: dejar `ORIGEN_API` vacío (la aplicación
llamará a `/api` en su propio origen) y agregar la redirección en `vercel.json`
**antes** de la regla comodín:

```json
"rewrites": [
  { "source": "/api/:ruta*", "destination": "https://SU-BACKEND/api/:ruta*" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

Así el navegador ve un solo origen y no hay CORS. El costo: **el aviso de
llamada entrante queda inactivo**, porque una reescritura de Vercel no reenvía
websockets y el canal en vivo no tiene por dónde pasar.

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
