# Prueba de carga — FALCON CAD

Simula N tenants con operadores conectados en vivo (Socket.IO), creación de
casos y llamadas entrantes de PBX, para responder con datos reales la
pregunta "¿esta configuración aguanta 20 tenants operando 24/7?" — en vez de
suponerlo.

## Antes que nada: dónde correrlo

**Nunca contra el ambiente con datos reales de ciudadanos.** Esto crea
tenants, usuarios y casos de prueba, y genera tráfico sostenido. Levanta un
ambiente de staging con el mismo plan que piensas contratar (o al menos del
mismo tamaño de instancia) y apunta ahí:

```bash
export LOADTEST_BASE_URL=https://falcon-cad-staging.onrender.com
```

Si `LOADTEST_BASE_URL` contiene `onrender.com` o `vercel.app`, `setup.js` pide
una confirmación explícita (`LOADTEST_CONFIRMO_STAGING=1`) antes de tocar
nada, como último freno de mano.

Contra un backend local (`npm run start:dev` en `backend/`), no hace falta
nada de esto: `LOADTEST_BASE_URL` por defecto es `http://localhost:3000`.

## Instalación

```bash
cd loadtest
npm install
```

## 1. Aprovisionar los tenants de prueba

```bash
LOADTEST_TENANTS=20 LOADTEST_OPERATORS_PER_TENANT=3 npm run setup
```

Crea `carga-01` … `carga-20` (prefijo configurable con
`LOADTEST_TENANT_PREFIX`), cada uno con un usuario `admin` (solo para rotar
la API key de PBX) y los operadores indicados, y guarda todo — incluidos los
JWT ya emitidos — en `.state/tenants.json`.

Este paso es lento a propósito: el login tiene un límite real de 5 intentos
por minuto por IP (protección contra fuerza bruta), y `setup.js` lo respeta
dejando margen (4/min por defecto). Con 20 tenants × 4 sesiones (1 admin + 3
operadores) son 80 logins ⇒ **~20 minutos**. Es un costo único: los tokens
duran lo que diga `JWT_EXPIRES` (8h por defecto), así que no hace falta
repetir este paso antes de cada corrida dentro del mismo turno de prueba.

Variables disponibles (todas opcionales, ver `config.js`):

| Variable | Por defecto | Qué controla |
|---|---|---|
| `LOADTEST_BASE_URL` | `http://localhost:3000` | Backend a probar |
| `LOADTEST_SUPERADMIN_USER` / `_PASS` | `superadmin` / `demo` | Credenciales de superadmin |
| `LOADTEST_TENANTS` | `20` | Cuántos tenants de prueba crear |
| `LOADTEST_OPERATORS_PER_TENANT` | `3` | Operadores conectados por tenant |
| `LOADTEST_LOGIN_MAX_PER_MIN` | `4` | Ritmo de login durante el setup |

## 2. Generar la carga

```bash
LOADTEST_DURATION_SEC=600 LOADTEST_CASES_PER_TENANT_PER_MIN=6 LOADTEST_CALLS_PER_TENANT_PER_MIN=10 npm run run
```

Con los valores por defecto (20 tenants, 3 operadores, 6 casos/min y 10
llamadas/min por tenant, 10 minutos): ~60 operadores conectados en simultáneo,
~120 casos y ~200 llamadas por minuto en todo el sistema. Ajusta estos
números al patrón real que esperas (turnos, hora pico) antes de sacar
conclusiones — 20 tenants pequeños no cargan igual que 20 tenants grandes.

Al terminar imprime un reporte con, por cada tipo de operación: total,
errores, y latencia promedio/p50/p95/p99/máxima. La fila que más importa es:

```
Entrega en vivo — aviso dirigido   total=...  avg=...ms  p95=...ms  ...
```

Es el tiempo entre que la central "marca" (webhook) y el operador correcto
ve la llamada en su pantalla — el corazón del sistema. Si su p95 se degrada
al subir tenants/operadores, ahí está el límite real de la configuración
actual (tamaño de instancia de Render, compute de Supabase), no en si el
health check responde.

## 3. Limpiar

```bash
npm run teardown
```

Desactiva (no borra — la API no tiene borrado de tenants, por trazabilidad)
todos los tenants con el prefijo usado. Si quieres quitarlos del todo,
hazlo a mano contra la base de staging.

## Qué mide y qué NO mide

Mide: capacidad de la instancia del backend + la base de datos bajo
conexiones y escritura sostenidas, y si el reparto de eventos en vivo
(Socket.IO, con o sin `REDIS_URL` y más de una instancia) se mantiene rápido
bajo carga.

No mide: el frontend (Vercel escala aparte y trivialmente para un sitio
estático), ni el flujo completo de despacho (asignar recursos, cerrar casos)
— se limitó a las dos rutas de escritura de mayor volumen real (recepción de
casos y llamadas de PBX) para mantener el script enfocado. Si más adelante
hace falta, se puede extender con el mismo patrón.

## Interpretando el resultado para la conversación con el inversionista

1. Corre esto contra el plan que estás por pedir (o el tamaño de instancia
   equivalente), con el patrón de uso esperado.
2. Si p95/p99 de "aviso dirigido" se mantiene bajo (unos pocos cientos de ms)
   y la tasa de error es ~0%, tienes evidencia real de que ese plan aguanta
   la carga simulada — no solo una promesa.
3. Si se degrada, súbele el tamaño de instancia (Render) o el compute add-on
   (Supabase) y vuelve a correr — así el número que le lleves al inversionista
   sale de una medición, no de una tabla de precios.
