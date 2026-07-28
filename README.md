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

## Cómo correrlo (desarrollo)

**1) Backend** (puerto 3000):
```bash
cd backend
npm install
npm run start        # http://localhost:3000/api  ·  health: /api/health
```

**2) Frontend** (puerto 4200):
```bash
cd frontend
npm install          # instala también @policia/mfa desde libs/policia-mfa-1.0.0.tgz
npm start            # http://localhost:4200
```

**Credenciales de demo:** cualquier usuario con contraseña `demo`
(pestaña *Funcionario* o *Ciudadano*).

## Qué incluye este esqueleto

- **Login** con dos dominios de identidad separados (institucional / civil) y el
  flujo 2FA institucional cableado vía la librería reutilizable **`@policia/mfa`**.
- **Recepción**: bandeja de casos **multicanal** (llamada / chat / integración),
  crear caso, cambiar estado y **derivar a otra agencia** (multi-agencia).
- **Multitenancy (stub)**: cada petición lleva `X-Tenant-Id`; el backend aísla los
  datos por tenant (municipio). En producción → PostgreSQL pooled.
- **Tema e identidad propios** (teal), distintos al SECAD institucional.

## Qué es mock todavía

- Persistencia **en memoria** (se reinicia con el backend) → reemplazar por
  PostgreSQL pooled.
- Tokens de autenticación **opacos de demo** → reemplazar por JWT firmados.
- El 2FA está **cableado** pero requiere los endpoints reales de la API 2FA central
  (igual que en SECAD).

## Núcleo compartido

`@policia/mfa` (doble autenticación) se consume como paquete instalado
(`frontend/libs/policia-mfa-1.0.0.tgz`), igual que en el SECAD institucional: una
sola fuente de la lógica de 2FA, sin copiar/pegar.
