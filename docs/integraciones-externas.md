# Integraciones externas — referencia técnica

Documento de referencia para integrar sistemas externos con FALCON CAD: planta
telefónica (PBX), WhatsApp (Cloud API de Meta) y entidades externas (API REST
de radicación de casos). Para cada una: URL, autenticación, cuerpo de la
solicitud y respuesta.

Si busca una explicación conceptual (para qué sirve cada integración, cómo se
enruta un caso a una bandeja), vea las secciones correspondientes del
[`README.md`](../README.md#qué-incluye). Este documento es el detalle técnico
para implementar el lado del cliente (la central telefónica, el backend de la
entidad externa, la app de Meta).

## Convenciones comunes a las tres integraciones

- **Base URL**: `https://<host-de-la-api>/api` (en local: `http://localhost:3000/api`).
- **Multi-tenant sin declarar tenant**: quien llama nunca dice "a qué instancia
  pertenezco" — el servidor lo resuelve a partir de la credencial (API key o
  `phone_number_id`, según la integración). Esto evita que un cliente mal
  configurado (o malicioso) escriba en el tenant de otro.
- **Errores**: formato estándar de NestJS —
  ```json
  { "statusCode": 403, "message": "La suscripción está suspendida. Contacte al proveedor.", "error": "Forbidden" }
  ```
- **Gate de suscripción e integración contratada**: además de la credencial
  propia de cada integración, el servidor exige que la instancia (tenant) esté
  vigente (activa, no suspendida, no vencida) y que tenga esa integración
  específica contratada (`pbx`, `whatsapp` o `api`, según el módulo). Si algo
  de esto falla, la respuesta es `403 Forbidden` con un mensaje explicando el
  motivo — **aunque la credencial de la integración (API key del tenant o de
  la entidad) sea válida**. No hay forma de distinguir por HTTP status "tu API
  key está mal" de "la instancia no está al día": ambas son 401/403; el
  mensaje de texto es lo que las diferencia.

---

## 1) Planta telefónica (PBX)

La central telefónica notifica a FALCON CAD cuando timbra y cuando cuelga.
FALCON CAD no gestiona colas ni lógica ACD — eso vive enteramente en la
central; FALCON CAD solo recibe el evento y, si la central ya decidió a qué
extensión dirigir la llamada, enruta el aviso en vivo a esa sola sesión.

### 1.1 `POST /api/pbx/webhook`

**Quién lo llama**: la central telefónica (o el middleware/dialplan que la
conecta a internet), al timbrar y al colgar.

**Autenticación**: header `x-api-key` con la API key del **tenant**
(no de un usuario). Se obtiene/rota desde Administración → Integración PBX,
o por API: ver 1.2 y 1.3 más abajo.

```
POST /api/pbx/webhook
Content-Type: application/json
x-api-key: <API key del tenant>
```

**Cuerpo — evento `entrante`** (al timbrar):

```json
{
  "evento": "entrante",
  "numero": "3001234567",
  "callId": "abc-123",
  "numeroDestino": "123",
  "extension": "105"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `evento` | `"entrante"` | sí | Fijo. |
| `numero` | string | sí | Número del llamante. |
| `callId` | string | no | ID de la llamada en la central; permite correlacionar el evento `colgada` posterior. Si no se manda, se correlaciona por `numero` + estado `sonando`. |
| `numeroDestino` | string | no | Número marcado (línea 123, etc.), informativo. |
| `extension` | string | no | Extensión a la que el ACD **de la central** ya decidió dirigir la llamada. Si coincide con la extensión de un funcionario activo del tenant (asignada en Administración → Usuarios), el aviso llega solo a esa sesión y la llamada desaparece de la cola de los demás operadores. Si se omite, o no hay match, se anuncia a todo el que esté atendiendo el tenant — el comportamiento por defecto, sin ACD. |

**Respuesta** `200 OK` — la llamada creada:

```json
{
  "id": "3f1b2c...-uuid",
  "tenant": "demo",
  "callId": "abc-123",
  "numero": "3001234567",
  "numeroDestino": "123",
  "extension": "105",
  "destinatario": "operador1",
  "estado": "sonando",
  "casoId": null,
  "atendidaPor": null,
  "creadoEn": "2026-08-07T20:50:00.000Z",
  "actualizadoEn": "2026-08-07T20:50:00.000Z"
}
```

`destinatario` es el `username` resuelto a partir de `extension` (o `null` si
no se mandó extensión o no hubo match — cola compartida).

**Cuerpo — evento `colgada`** (al terminar la llamada, se haya atendido o no):

```json
{ "evento": "colgada", "callId": "abc-123" }
```

Sin `callId`, se ubica por `numero` + estado `sonando`. Si la llamada estaba
`sonando`, pasa a `perdida`; si estaba `atendida`, pasa a `finalizada`.

**Respuesta** `200 OK` — la llamada actualizada (mismo esquema de arriba, con
`estado` en `"perdida"` o `"finalizada"`).

**Errores**:
- `401 Unauthorized` — falta `x-api-key` o no coincide con ningún tenant.
- `403 Forbidden` — tenant bloqueado/suspendido/vencido, o la integración
  `pbx` no está contratada.
- `400 Bad Request` — falta `numero` en un evento `entrante`, o `evento` no es
  `"entrante"`/`"colgada"`.
- `404 Not Found` — un evento `colgada` que no encuentra la llamada
  correspondiente.

### 1.2 `GET /api/pbx/config`

Uso interno (requiere sesión de usuario con permiso `pbx.configurar`, no es
para la central). Devuelve la API key vigente del tenant y la ruta del
webhook:

```json
{ "apiKey": "pk_...", "webhookPath": "/api/pbx/webhook" }
```

### 1.3 `POST /api/pbx/config/rotar`

Uso interno (permiso `pbx.configurar`). Regenera la API key del tenant
(invalida la anterior de inmediato). Misma forma de respuesta que 1.2.

### Enrutamiento por extensión (ACD) — qué configurar y dónde

| Qué | Dónde |
|---|---|
| Extensión de cada funcionario (ej. `operador1` → `105`) | Administración → Usuarios, en FALCON CAD |
| Colas ACD, agentes, estrategia de reparto | La consola propia de la central telefónica — configuración ajena a FALCON CAD |
| Enviar `extension` en el webhook al timbrar | Dialplan / integración de la central |

FALCON CAD no valida que la extensión "exista" en ningún catálogo de colas —
solo busca si algún funcionario activo del tenant tiene esa extensión
asignada. Si no hay match, simplemente no dirige el aviso (cola compartida).

---

## 2) WhatsApp (Cloud API de Meta)

Integración estándar de un webhook de Meta: verificación por `GET` y mensajes
entrantes por `POST`. El número de WhatsApp Business (`phone_number_id`)
identifica al tenant.

### 2.1 `GET /api/whatsapp/webhook` — verificación de Meta

Meta la llama automáticamente al configurar el webhook en su panel de
desarrolladores. No hay nada que implementar del lado de la entidad: solo se
apunta la URL y se copia el *verify token* configurado en Administración.

```
GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<verifyToken>&hub.challenge=<challenge>
```

**Respuesta**: `200 OK` con el valor de `hub.challenge` como texto plano, si
`hub.verify_token` coincide con el configurado (ver 2.3). Si no coincide:
`403 Forbidden`.

### 2.2 `POST /api/whatsapp/webhook` — mensajes entrantes

**Quién lo llama**: la Cloud API de Meta, con el payload estándar de WhatsApp
Business (sin autenticación adicional de FALCON CAD — la seguridad depende de
que la URL del webhook no se filtre y de la validación implícita del
`phone_number_id`).

**Cuerpo**: el payload nativo de Meta (`entry[].changes[].value.messages[]`,
etc.) — no se documenta aquí, es el formato oficial de la Cloud API. El
`phone_number_id` dentro del payload resuelve el tenant.

**Respuesta**: `200 OK`, `{ "received": true }`.

Cada mensaje crea o continúa un caso (canal `whatsapp`) del mismo número, y se
enruta a la agencia/canales configurados en 2.4 — sin esa configuración, el
caso solo lo ve un supervisor (`casos.ver_todos`), nunca un operador normal.

### 2.3 `GET /api/whatsapp/config`

Uso interno (permiso `whatsapp.configurar`). Estado actual de la integración:

```json
{
  "phoneNumberId": "109999888",
  "tokenConfigurado": true,
  "agenciaResponsableId": "uuid-agencia",
  "canales": ["uuid-canal-1"],
  "verifyToken": "falcon-cad",
  "webhookPath": "/api/whatsapp/webhook"
}
```

### 2.4 `PUT /api/whatsapp/config`

Uso interno (permiso `whatsapp.configurar`). Configura el `phone_number_id`,
el token de acceso (Bearer, para responder por la Graph API) y a qué
agencia/canales del catálogo se envían los casos entrantes:

```json
{
  "phoneNumberId": "109999888",
  "accessToken": "EAAG...",
  "agenciaResponsableId": "uuid-agencia",
  "canales": ["uuid-canal-1", "uuid-canal-2"]
}
```

Respuesta: mismo esquema que 2.3.

---

## 3) Entidades externas — API REST de radicación de casos

Para terceros que **no son una central telefónica ni WhatsApp**: una alarma
monitoreada, una app móvil con botón de pánico, otra central de emergencias,
un sistema municipal. Cada entidad se registra en Administración → Entidades
externas (permiso `entidades.gestionar`), eligiendo su agencia responsable y
canales del catálogo operativo, y recibe una **API key propia** (`ek_…`).

Es el modelo pensado para el caso "empresa con app móvil, botón de pánico":
la API key vive en el backend de esa empresa (nunca embebida en la app móvil
misma), y cada llamada a estos endpoints ya declara implícitamente el tenant y
la entidad — el llamante no necesita saber ni declarar a qué instancia
pertenece.

### 3.1 `POST /api/integracion/casos` — radicar un caso

**Autenticación**: header `x-api-key` con la API key de la **entidad**
(no la del tenant — cada entidad tiene la suya, revocable/rotable sin afectar
a las demás).

```
POST /api/integracion/casos
Content-Type: application/json
x-api-key: <API key de la entidad>
```

**Cuerpo**:

```json
{
  "titulo": "Alarma activada sede norte",
  "descripcion": "Sensor de humo",
  "referencia": "ACME-77",
  "ciudadano": "Sede Norte",
  "telefono": "3001112233",
  "lat": 4.65,
  "lng": -74.05
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `titulo` | string | **sí** | Título del caso. |
| `descripcion` | string | no | Detalle libre. |
| `referencia` | string | no | ID del caso en el sistema de la entidad (para su propia trazabilidad); se anexa a la descripción como "Referencia externa: …". |
| `ciudadano` | string | no | Nombre del solicitante/sede; si se omite, se usa el nombre de la entidad. |
| `telefono` | string | no | Teléfono de contacto. |
| `lat` / `lng` | number | no | Coordenadas del incidente. |

Nota: el campo `agencia` (texto libre) que aceptaba versiones anteriores ya
no es necesario — la agencia y los canales de atención se definen **una vez**,
al registrar la entidad en Administración (ver 3.4), y se aplican
automáticamente a todos los casos que esa entidad radique.

**Respuesta** `201 Created`:

```json
{
  "casoId": "3f1b2c...-uuid",
  "estado": "nuevo",
  "titulo": "Alarma activada sede norte",
  "creadoEn": "2026-08-07T20:50:00.000Z"
}
```

**Errores**:
- `401 Unauthorized` — falta `x-api-key`, no corresponde a ninguna entidad, o
  la entidad está desactivada.
- `403 Forbidden` — el tenant dueño de la entidad está bloqueado/suspendido/
  vencido, o no tiene contratada la integración `api`.
- `400 Bad Request` — falta `titulo`.

### 3.2 `GET /api/integracion/casos/:id` — consultar estado

**Autenticación**: mismo header `x-api-key` de la entidad. Solo devuelve
casos radicados **por esa misma entidad** — pedir el ID de un caso ajeno (o de
otro tenant) responde `404`, nunca revela que existe.

```
GET /api/integracion/casos/{casoId}
x-api-key: <API key de la entidad>
```

**Respuesta** `200 OK`:

```json
{
  "casoId": "3f1b2c...-uuid",
  "estado": "en_gestion",
  "titulo": "Alarma activada sede norte",
  "agencia": "Policía Nacional",
  "creadoEn": "2026-08-07T20:50:00.000Z",
  "actualizadoEn": "2026-08-07T20:55:00.000Z"
}
```

`estado` es uno de: `nuevo`, `en_gestion`, `despachado`, `derivado`, `cerrado`.

**Errores**: `401` (API key inválida/entidad inactiva), `403` (tenant no
vigente o integración `api` no contratada), `404` (caso inexistente o de otra
entidad).

### 3.3 Gestión de entidades (uso interno, Administración)

Todos requieren sesión de usuario con permiso `entidades.gestionar` (no son
para el tercero, son para quien administra el tenant):

| Endpoint | Uso |
|---|---|
| `GET /api/entidades` | Lista las entidades del tenant, con su API key. |
| `POST /api/entidades` | Registra una entidad nueva: `{ "nombre": "...", "agenciaResponsableId": "uuid \| null", "canales": ["uuid", ...] }`. Genera la API key (`ek_…`). |
| `PATCH /api/entidades/:id` | Renombra, cambia agencia/canales, o activa/desactiva: `{ "nombre"?, "agenciaResponsableId"?, "canales"?, "activa"? }`. |
| `POST /api/entidades/:id/rotar` | Regenera la API key de esa entidad (la anterior queda inválida de inmediato). |

`agenciaResponsableId` y `canales` deben existir en el catálogo operativo del
tenant (agencias/canales de atención de Administración → Catálogos); un
canal que no pertenezca a la agencia elegida se rechaza con `400`.

---

## Resumen — qué credencial usa cada quién

| Integración | Quién presenta la credencial | Header | Qué identifica |
|---|---|---|---|
| PBX | La central telefónica | `x-api-key` | El **tenant** |
| WhatsApp | Meta (vía `phone_number_id` en el payload) | — (webhook público) | El **tenant** |
| Entidades externas | El backend de la empresa/entidad externa | `x-api-key` | La **entidad** (y, a través de ella, el tenant) |

Ninguna de las tres usa usuario/contraseña: son integraciones
servidor-a-servidor, sin una persona autenticándose — el modelo estándar para
este tipo de conexión es una credencial estática por sistema/entidad,
revocable independientemente de las demás.
