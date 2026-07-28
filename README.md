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
docker compose up -d      # PostgreSQL en 127.0.0.1:5432 (secad/secad/secad_lite)
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

**Credenciales de demo:** cualquier usuario con contraseña `demo`
(pestaña *Funcionario* o *Ciudadano*).

## Qué incluye este esqueleto

- **Login** con dos dominios de identidad separados (institucional / civil) y el
  flujo 2FA institucional cableado vía la librería reutilizable **`@policia/mfa`**.
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
- **Tema e identidad propios** (teal), distintos al SECAD institucional.

## Qué es mock / pendiente todavía

- Esquema por `synchronize` (dev) → en producción, **migraciones** versionadas y
  `synchronize: false`.
- Login **demo** (contraseña `demo`) → integrar directorio institucional real y,
  en la ruta institucional, los endpoints reales del **2FA central** (`@policia/mfa`
  ya está cableado, igual que en SECAD).
- Falta el canal de **chat** en vivo (WebSocket).

## Núcleo compartido

`@policia/mfa` (doble autenticación) se consume como paquete instalado
(`frontend/libs/policia-mfa-1.0.0.tgz`), igual que en el SECAD institucional: una
sola fuente de la lógica de 2FA, sin copiar/pegar.
