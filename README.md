# FALCON CAD

**FALCON CAD** es la plataforma tecnológica nacional para la gestión integral de
emergencias, diseñada para recibir, clasificar, coordinar y hacer seguimiento a
las llamadas al **123**. Centraliza la información operativa en tiempo real,
facilita la interoperabilidad entre las entidades de respuesta y optimiza la toma
de decisiones para brindar una atención más rápida, eficiente y segura a la
ciudadanía.

Recepción de incidentes **multicanal** (llamada / chat / integración), gestión de
casos **multi-agencia** y arquitectura **multi-inquilino** (una instancia por
municipio/organización).

## Estructura

```
secad-lite/
├─ frontend/   Angular 20 (standalone) — UI (tema teal)
└─ backend/    NestJS 10 — API: auth, casos (recepción), chat, métricas, administración
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
> arriba).

El esquema se crea solo al arrancar (TypeORM `synchronize`, solo dev) y se
siembran datos de demo para el tenant `demo`.

**2) Frontend** (puerto 4200):
```bash
cd frontend
npm install
npm start                 # http://localhost:4200
```

**Credenciales de demo** (pestaña *Usuario*, contraseña `demo`):
`superadmin` (global) · `admin1` · `supervisor1` · `operador1` (tenant `demo`).
Pestaña *Ciudadano*: cualquier correo con contraseña `demo`.

## Qué incluye

- **Login** de usuarios (username único global; el tenant se deduce del usuario)
  + acceso *Ciudadano* aparte para el chat.
- **Administración**: un **superadmin** global crea **tenants** (instancias) y sus
  usuarios; cada **admin de tenant** gestiona solo los usuarios de su tenant. Cada
  usuario queda asociado a un tenant.
- **Recepción**: bandeja de casos **multicanal** (llamada / chat / integración),
  crear caso, cambiar estado y **derivar a otra agencia** (multi-agencia).
- **Detalle de caso** con **bitácora de auditoría** (línea de tiempo inmutable):
  creación, cambios de estado, derivaciones y notas, cada evento con autor y fecha.
- **Persistencia** en **PostgreSQL pooled** (TypeORM): una sola base aislada por
  columna `tenant`; toda consulta filtra por tenant. Verificado: un token de otro
  tenant ve 0 casos ajenos.
- **JWT firmados** (`@nestjs/jwt`): guard global obliga token en todas las rutas
  salvo login y health. El `tenant` viaja en el token, no se puede falsear por
  header.
- **Roles** (superadmin/admin/supervisor/operador/ciudadano) con `@Roles` + guard:
  p. ej. solo supervisor/admin cierran o reabren casos; la bandeja es solo para
  funcionarios.
- **Chat en vivo** (Socket.IO): el ciudadano abre un chat que crea un caso y
  conversa con el operador en tiempo real.
- **Panel de gestión**: métricas de casos por estado, canal y agencia.
- **Tema e identidad propios** (teal).

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

## Pendiente / a endurecer

- Contraseñas **demo** para los usuarios sembrados → en producción se crean con
  contraseñas reales desde el módulo de administración.
- Integración real con el flujo de llamadas al **123** y con las entidades de
  respuesta (interoperabilidad).
