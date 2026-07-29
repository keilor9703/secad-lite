# SECAD Lite

Versión **SaaS liviana** de recepción y gestión de incidentes para **municipios
pequeños**: mismo core de negocio del SECAD (recepción **multicanal** y gestión de
casos **multi-agencia**, con login **institucional** y **civil**), pero sin la
complejidad operativa ni la infraestructura del SECAD completo.

> Esqueleto inicial. Ver el documento de arquitectura y alcance para el contexto
> y el roadmap.

## Estructura

```
secad-lite/
├─ frontend/   Angular 20 (standalone) — UI propia (tema teal), reutiliza @policia/mfa
└─ backend/    NestJS 10 — API delgada: auth (institucional/civil), casos (recepción)
```

## Requisitos

- Node.js 20+ y npm.
- PostgreSQL 14+ (o Docker, ver abajo).

## Cómo correrlo (desarrollo)

**0) Base de datos** — con Docker:
```bash
docker compose up -d      # PostgreSQL en localhost:5433 (postgres/postgres/secad_lite)
```
O usa tu propio PostgreSQL y ajusta `DATABASE_URL` en `backend/.env`.

**1) Backend** (puerto 3000):
```bash
cd backend
cp .env.example .env      # DATABASE_URL, JWT_SECRET, etc.
                          # Windows PowerShell: Copy-Item .env.example .env
npm install
npm run start             # http://localhost:3000/api  ·  health: /api/health
```
> Si al arrancar dice `Falta DATABASE_URL`, es que no creaste el `.env` (paso de
> arriba). Si dice `SASL: client password must be a string` con una versión vieja,
> es lo mismo: falta el `.env`.
El esquema se crea solo al arrancar (TypeORM `synchronize`, solo dev) y se
siembran datos de demo para el tenant `demo`.

**2) Frontend** (puerto 4200):
```bash
cd frontend
npm install               # instala también @policia/mfa desde libs/policia-mfa-1.0.0.tgz
npm start                 # http://localhost:4200
```

**Credenciales de demo** (pestaña *Usuario*, contraseña `demo`):
`superadmin` (global) · `admin1` · `supervisor1` · `operador1` (secad `demo`).
Pestaña *Ciudadano*: cualquier correo con contraseña `demo`.

## Qué incluye este esqueleto

- **Login normal** de usuarios (username único global; el secad se deduce del
  usuario) + acceso *Ciudadano* aparte para el chat.
- **Administración**: un **superadmin** global crea **secads** (tenants) y sus
  usuarios; cada **admin de secad** gestiona solo los usuarios de su secad. Cada
  usuario queda asociado a un secad.
- **Recepción**: bandeja de casos **multicanal** (llamada / chat / integración),
  crear caso, cambiar estado y **derivar a otra agencia** (multi-agencia).
- **Detalle de caso** con **bitácora de auditoría** (línea de tiempo inmutable):
  creación, cambios de estado, derivaciones y notas, cada evento con autor y fecha.
- **Persistencia real** en **PostgreSQL pooled** (TypeORM): una sola base aislada
  por columna `tenant`; toda consulta filtra por tenant. Verificado: un token de
  otro municipio ve 0 casos ajenos.
- **JWT firmados** (`@nestjs/jwt`): guard global obliga token en todas las rutas
  salvo login y health. El `tenant` viaja en el token, no se puede falsear por
  header.
- **Roles** (operador/supervisor/admin/ciudadano) con `@Roles` + guard: p. ej.
  solo supervisor/admin cierran o reabren casos; la bandeja es solo para
  funcionarios.
- **Chat en vivo** (Socket.IO): el ciudadano abre un chat que crea un caso y
  conversa con el operador en tiempo real.
- **Panel de gestión**: métricas de casos por estado, canal y agencia.
- **Tema e identidad propios** (teal), distintos al SECAD institucional.

## Migraciones (producción)

En dev, `DB_SYNC=true` crea/actualiza el esquema al arrancar. En producción se
usan **migraciones versionadas** (`backend/src/migrations`):

```bash
cd backend
# generar una migración a partir de cambios en las entidades
npm run migration:generate -- src/migrations/NombreDelCambio
# aplicar / revertir manualmente
npm run migration:run
npm run migration:revert
```

Para que la app aplique las migraciones sola al arrancar, en `.env`:
`DB_SYNC=false` y `DB_MIGRATE=true`.

## Qué es mock / pendiente todavía

- Contraseñas **demo** para los usuarios sembrados → en producción se crean con
  contraseñas reales desde el módulo de administración.
- 2FA opcional en el login (la librería `@policia/mfa` quedó disponible pero el
  flujo institucional 2FA no está activo en esta versión).

## Núcleo compartido

`@policia/mfa` (doble autenticación) se consume como paquete instalado
(`frontend/libs/policia-mfa-1.0.0.tgz`), igual que en el SECAD institucional: una
sola fuente de la lógica de 2FA, sin copiar/pegar.
