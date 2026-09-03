# Integración FALCON CAD ↔ Barra CTI ↔ YACO

Documento de contexto y planeación técnica para la integración de FALCON CAD
con la barra CTI (software intermediario) y YACO (plataforma de
comunicaciones unificadas / omnicanalidad). No es una referencia de API ya
construida como [`integraciones-externas.md`](./integraciones-externas.md) —
es el estado de la decisión: qué pidió el proveedor, qué ya construimos en
FALCON como base, qué falta, y qué debemos exigir/preguntar en la reunión
técnica con los desarrolladores de la barra CTI y de YACO.

Fuente: ficha técnica del proveedor "INTEGRACIONES FALCON CAD" (documento
`DOC20260902WA0017.pdf`, compartido por el equipo del municipio/proveedor).

---

## 1. Actores y topología

Tres sistemas, cuatro conexiones. Es clave no confundirlas: FALCON CAD **solo
controla y solo debe preocuparse por una** de las cuatro.

| Sistema | Qué es | Quién lo opera |
|---|---|---|
| **YACO** | Plataforma de comunicaciones unificadas / omnicanalidad: recibe la llamada de voz, el WhatsApp (llamada, video, chat) y la app ciudadana; hace la cola/ACD; entrega audio y datos al agente. | El proveedor de telefonía. Ajeno a FALCON. |
| **Barra CTI** (el "software de integración" que menciona la ficha) | Middleware embebido como iframe dentro de FALCON CAD. Es lo que el agente usa para contestar/colgar/transferir. Su backend habla con YACO por un lado, y con el backend de FALCON por el otro. | El proveedor de la barra CTI. Ajeno a FALCON, salvo el contrato del webhook. |
| **Plataforma de Geolocalización** | Otro proveedor, **con contrato aparte** (confirmado explícitamente con el cliente) — no asumir que viene incluida en este alcance. Cubre ubicación, chat de geolocalización, video en vivo y su consulta posterior (ítems 9–14 de la ficha). | Proveedor distinto de YACO/barra CTI. |
| **FALCON CAD** | El CAD: dueño de los casos, agencias, despacho y tipificación. | Nosotros. |

Las cuatro conexiones:

1. **Navegador del agente ↔ backend de la barra CTI**: el iframe embebido en
   FALCON habla con su propio backend. No es problema nuestro cómo funciona
   por dentro.
2. **Backend de la barra CTI ↔ YACO**: tampoco es problema nuestro.
3. **Backend de la barra CTI ↔ backend de FALCON CAD**: **esta es la única
   superficie que FALCON implementa y controla** — el webhook de eventos
   (`POST /api/cti/eventos/interaccion`, ya construido como esqueleto — ver
   §5) y, en el otro sentido, lo que FALCON expone para SSO.
4. **Iframe de la barra CTI ↔ frontend de FALCON**: solo para el arranque
   (SSO) y, si se necesita, mensajería liviana tipo `postMessage` (p. ej.
   avisar tema claro/oscuro). No comparte sesión ni datos de casos.

Todo lo que la ficha técnica llama "el software de integración entre FALCON
CAD y YACO" es, en esta topología, **el backend de la barra CTI** — no un
cuarto sistema.

---

## 2. Qué pide la ficha técnica del proveedor

Resumen fiel de los 14 ítems del documento, agrupados por plataforma. Cuando
un campo es literal del documento, va entre comillas.

### 2.1 Barra CTI embebida + SSO (ítem 1)

- FALCON CAD debe reservar el espacio lateral izquierdo para la barra CTI,
  visible sin estorbar el formulario de recepción mientras la comunicación
  esté activa.
- **El login de FALCON genera el SSO**: "el usuario genera el acceso a
  Falcon CAD y este genera un proceso de *single sign on* con la barra CTI y
  las aplicaciones dispuestas, para evitar duplicidad de usuarios y
  contraseñas en cada plataforma."
- El login debe declarar el **rol** (recepción / despacho / supervisión) para
  habilitar la barra CTI correspondiente: "requiriendo que el CAD para el
  proceso de login genere el token para la autenticación; si es válido, se
  subroga la autenticación y se ejecuta el logueo automático en las
  plataformas asociadas al CTI."
- La barra CTI, con eso, hace su propio SSO interno hacia sus subsistemas
  (comunicaciones unificadas, ACD, grabación, transcripción) sin pedirle
  credenciales de nuevo al agente.
- Qué ve cada rol (lo decide la barra, pero según el rol que FALCON le
  entregue):
  - **Recepción**: llamada, ACD, estadísticas de llamadas en cola/contestadas,
    todos los campos de Voz/WhatsApp/Chat, botón Video/Geolocalización.
  - **Despacho**: llamada, todos los campos de Voz/WhatsApp/Chat, botón
    Video/Geolocalización (sin ACD ni estadísticas).
  - **Supervisión**: igual que Recepción.
- Modo claro/oscuro: FALCON ya lo tiene: debe sincronizarse con el de la
  barra (vía configuración del administrador, dice el documento).

### 2.2 Telefonía — voz (ítem 3)

1. El ciudadano marca el número fijo de emergencias del municipio.
2. YACO recibe la llamada y reproduce un pre-audio parametrizable por tenant.
3. **Al contestar**, la barra CTI entrega a FALCON: `identificador de la
   interacción`, `número del ANI`, `ACD (operador, receptor)`, `fecha de la
   llamada (hora de inicio)`.
4. FALCON **retorna el número de identificación del registro** con el que
   recibió el ANI, la fecha y el operador — es decir, responde con un id
   propio, no solo un `200 OK`.
5. FALCON remite ese id a las plataformas de telefonía, grabación y
   transcripción, para que puedan relacionar sus propios registros con el
   caso.
6. El receptor tipifica y documenta el caso en FALCON (esto ya existe: el
   formulario de Recepción).
7. Al colgar (por cualquiera de los dos lados), se notifica a grabación y
   transcripción con el resumen de la llamada.
8. El receptor asigna canales/agencias — multiagencia (ya existe en FALCON).

### 2.3 Grabación y transcripción (ítem 4)

- La barra CTI envía a la plataforma de grabación: identificador de
  interacción, ANI (o número de WhatsApp), ACD, fecha/hora, **el id que
  FALCON devolvió**.
- Al terminar la comunicación, la plataforma de grabación genera **una URL**
  que se envía a FALCON — FALCON la guarda en un campo del caso, visible en
  Consulta/Despacho **solo para roles autorizados**.
- Las grabaciones deben incluirse **con firma digital**, garantizando que no
  se modifiquen (obligación del proveedor, no de FALCON).
- Se conservan en la plataforma de YACO durante el término del contrato;
  descargables a un NAS cuando se requiera o anualmente.

### 2.4 WhatsApp — llamada (ítem 5)

- Mismo flujo que voz, pero en vez de ANI: `número de WhatsApp del llamante`
  **y** `@` (el alias/handle) — "vincular campo en Falcon CAD".
- **"Falcon CAD debe tener un campo para vincular el nickname @ asociado por
  WhatsApp a cada usuario"** — esto ya está construido (`whatsappHandle`,
  ver §5).
- Requiere transferencia de llamada de WhatsApp entre agencias, con
  directorio de contactos por agencia, visible en recepción/despacho/supervisión.

### 2.5 WhatsApp — video (ítem 6)

- Mismo patrón de datos que WhatsApp llamada.
- Necesita un **pop-up de video** más grande, con controles de
  activar/desactivar cámara, mute, colgar y altavoz — responsabilidad de la
  barra CTI, no del backend de FALCON.
- Marcación de video vinculando número o `@`.

### 2.6 WhatsApp — chat (ítem 7)

- El ciudadano escribe al WhatsApp Business 123: aviso de tratamiento de
  datos personales, luego un menú **parametrizable por municipio** (la
  opción "1. Emergencia SOS" siempre existe; las demás las define cada
  municipio).
- Al elegir la opción de emergencia, YACO enruta a los agentes.
- Se pide aprobación al ciudadano para consultar su ubicación; si acepta, se
  consulta la API de WhatsApp por lat/lng decimales.
- Datos que llegan a FALCON: identificador de interacción, número + `@` de
  WhatsApp, ACD, fecha/hora de inicio, **coordenadas**.
- Cierre: lo cierra el receptor, o automáticamente **tras 1 minuto sin
  respuesta**, o lo cierra el ciudadano — en cualquier caso se notifica hora
  de culminación a transcripción.

### 2.7 App ciudadana (ítem 8)

- Botón "click to call" (consumido por datos móviles) en Android/iOS.
- La app envía: número asociado, lat/lng, **ID de evento** propio de la app,
  fecha/hora, y las coordenadas GPS.
- Al contestar, FALCON recibe: identificador de interacción — el documento
  pregunta explícitamente **"evaluar si se puede mantener el ID Evento"**
  (o sea, si el id que ya trae la app puede ser el mismo que usamos como
  identificador de interacción) —, número de llamante, ACD, fecha/hora.

### 2.8 Geolocalización — **contrato aparte, fuera del alcance actual** (ítems 9–14)

Se documentan aquí porque están en la ficha técnica, pero **no forman parte
de lo que se está construyendo ahora** (ver §4). Resumen:

- **9 — Ubicación de la llamada de voz**: la barra CTI invoca un webservice
  de la Plataforma de Geolocalización con identificador de interacción, ANI,
  ACD, fecha/hora e id de la grabación. FALCON responde con el id de su
  registro; la plataforma de geolocalización expone un API REST para
  entregarle a FALCON lat/lng + fecha/hora + el id que se le dio al ANI
  inicial. Campos obligatorios: lat/lng decimal, id de interacción,
  municipio. Opcionales: barrio, unidad, *horizontal accuracy*. Exclusión
  explícita: si la llamada viene de fuera del municipio/departamento, la
  cobertura depende del alcance del contrato de geolocalización.
- **10 — Visualización en el mapa de despacho**: ya existe en FALCON (mapa
  interno), solo falta alimentarlo con estas coordenadas.
- **11 — Trayectoria en vivo**: mientras la llamada esté activa, la
  plataforma de geolocalización envía una actualización de ubicación **cada
  10 segundos** al servicio publicado por FALCON; FALCON debe guardar el
  histórico (dice explícitamente "en definición base de datos PostgreSQL") y
  pintar la trayectoria en el mapa.
- **12 — Chat de geolocalización** (distinto del chat de WhatsApp): la
  plataforma de geolocalización envía, de forma síncrona, el chat de la
  sesión con el llamante — el documento dice que esto se entrega "a través
  del servicio indicado por la plataforma CTI", es decir, probablemente no
  le pega directo a FALCON sino al backend de la barra CTI, que luego lo
  asocia al caso vía transcripción. Punto ambiguo — ver §7.
- **13 — Video en vivo**: botón en recepción/despacho para pedir video en
  vivo a la plataforma de geolocalización, en un pop-up — responsabilidad de
  la barra CTI/geolocalización, no del backend de FALCON.
- **14 — Consulta posterior**: el operador debe poder ver, desde la consulta
  del caso en FALCON, la URL de imágenes/video/grabaciones/transcripciones
  de la sesión — mismo patrón que `urlGrabacion` (§5), generalizado a más
  tipos de adjunto.

---

## 3. Decisiones de negocio ya tomadas

Para no repetir la discusión en la reunión técnica — esto ya está resuelto:

- **Geolocalización es un proveedor y un contrato aparte.** No se asume
  incluido en el alcance de "barra CTI + YACO". Los ítems 9–14 quedan
  documentados pero **no autorizados para construir** hasta que se defina
  ese contrato por separado.
- **Cada tenant nuevo de FALCON comprará el paquete completo** (FALCON CAD +
  barra CTI + YACO) como configuración prácticamente nativa — pero:
- **La lógica actual de PBX y WhatsApp (Cloud API de Meta) se conserva
  intacta como respaldo.** Si la integración con la barra CTI/YACO no
  funciona para un municipio (o en general), ese municipio sigue operando
  con la planta telefónica clásica y WhatsApp directo — son integraciones
  independientes y coexisten (`pbx`, `whatsapp`, `cti` son banderas
  separadas por tenant, no una sustituye a la otra).
- **FALCON dicta el contrato de los campos que necesita para crear un
  caso**, no al revés — ver §6. El proveedor puede mandar lo que su
  plataforma produzca, pero lo mínimo exigible para que FALCON cree un caso
  útil lo definimos nosotros.
- **FALCON no comparte su JWT de sesión con la barra CTI.** El SSO se hace
  con un token propio, de un solo propósito — ver §7.

---

## 4. Qué ya está construido en FALCON CAD

Todo esto ya está en `main`, compilado, con pruebas, y verificado en vivo.
Es la base **independiente del proveedor**: no asume ningún campo del
contrato final, para no tener que deshacer nada cuando se confirme.

| Pieza | Dónde | Estado |
|---|---|---|
| Integración `cti` contratable por tenant | `tenant.entity.ts` (`INTEGRACIONES`), Plataforma (checkbox) | ✅ Completo |
| Llave de API propia del tenant para CTI (`ctiApiKey`, prefijo `ck_`, solo digest guardado) | `tenants.service.ts`, migración `1787200000000-CtiIntegracion.ts` | ✅ Completo |
| Webhook público de eventos | `POST /api/cti/eventos/interaccion` — `cti.controller.ts` / `cti.service.ts` | ⚠️ Esqueleto: autentica, valida integración vigente, exige `identificadorInteraccion`, **guarda el payload crudo tal cual** en `cti_eventos`. No crea ni enlaza casos todavía, no responde con un id de registro de FALCON (ver §2.2 punto 4 — falta). |
| Tabla de staging del evento | `cti_evento.entity.ts` → `cti_eventos` (id, tenant, `identificadorInteraccion`, `payload` jsonb, `creadoEn`) | ✅ Completo como *staging*; sin RLS (ver §8) |
| Configuración desde Administración (URL del webhook + generar/rotar llave) | `admin.ts` / `admin.html`, panel "Integración — CTI / YACO" | ✅ Completo, oculto si el tenant no la contrató |
| Permiso `cti.configurar` | `permiso.catalogo.ts`, módulo Administración | ✅ Completo |
| Campo `whatsappHandle` por usuario (el `@` de WhatsApp) | `usuario.entity.ts`, `usuarios.service.ts` (`resolverWhatsappHandle`, `buscarPorWhatsappHandle`, único por tenant) | ✅ Completo — **es exactamente lo que pide el ítem 5** de la ficha, ya construido antes de leerla en detalle |
| Campos `urlGrabacion` / `urlTranscripcion` en el caso, con visibilidad restringida | `caso.entity.ts`, gateado por el permiso `casos.ver_grabaciones` en **los ocho** endpoints que devuelven `CasoEntity` (`casos.controller.ts`) | ✅ Completo — es lo que pide el ítem 4.5/4.6 |
| Resolución de ACD → operador por extensión (patrón ya probado con PBX) | `usuarios.service.ts: buscarPorExtension` | ✅ Completo — reutilizable para CTI |
| Aislamiento por tenant confiable en las 6 tablas críticas (RLS de verdad, no solo declarada) | `TenantRlsService`, ver commit de RLS | ✅ Completo (no cubre `cti_eventos`, ver §8) |

Lo que **no** existe todavía es la lógica de negocio real del webhook (crear
o enlazar un caso, enrutar por ACD, notificar en vivo), el endpoint de SSO,
el de ubicación en vivo, y el embebido del iframe — todo eso depende de
información que solo la reunión técnica puede confirmar.

---

## 5. El contrato de payload que FALCON exige

FALCON es el dueño del caso — es quien decide qué necesita para crear uno
útil, no el que se adapta a lo que cada plataforma le mande. Esta sección
es la propuesta a llevar a la reunión: lo mínimo **exigible**, derivado
directamente de lo que ya usa `CasosService.crear()` en producción (ver
`backend/src/casos/dto/crear-caso.dto.ts`), más lo que pide explícitamente la
ficha técnica.

### 5.1 Campo común a todo evento de interacción

| Campo | Tipo | Obligatorio | Nota |
|---|---|---|---|
| `identificadorInteraccion` | string | **Sí** | Ya validado hoy. Es la clave de correlación entre FALCON, la barra CTI, YACO, grabación y transcripción — todo evento posterior sobre la misma interacción debe repetirlo. |
| `tipoOrigen` | `'llamada' \| 'whatsapp_llamada' \| 'whatsapp_video' \| 'whatsapp_chat' \| 'app_ciudadana'` | **Sí** | Hoy no existe — hace falta para decidir cómo mapear el resto de campos y a qué `canal` de FALCON corresponde (`llamada`, `whatsapp`, `chat`). |
| `acdOperador` | string | Recomendado | El "operador/receptor" del ACD. Con esto FALCON resuelve el destinatario igual que ya hace con PBX (`buscarPorExtension`) o con WhatsApp (`buscarPorWhatsappHandle`, si el ACD viaja como `@`). Sin él, el evento queda sin destinatario específico — se anuncia a todo el tenant, igual que hoy hace PBX cuando no hay extensión. |
| `fechaHoraInicio` | ISO 8601 | **Sí** | Hora de inicio de la interacción, la trae el proveedor — no se genera en FALCON, para no perder precisión si hay latencia de red. |

### 5.2 Campos adicionales por origen

| Origen | Campos que agrega | Mapea a (en `CrearCasoDto`) |
|---|---|---|
| `llamada` | `ani` (número del llamante) | `telefono` |
| `whatsapp_llamada` / `whatsapp_video` | `numeroWhatsapp`, `arroba` (el `@`) | `telefono`; el `@` resuelve el `acdOperador` vía `whatsappHandle` si no viene aparte |
| `whatsapp_chat` | `numeroWhatsapp`, `arroba`, `lat`/`lng` (si el ciudadano aceptó compartir ubicación) | `telefono`, `lat`, `lng` |
| `app_ciudadana` | `idEventoApp` (puede coincidir con `identificadorInteraccion` — pendiente de confirmar con el proveedor), `numeroAsociado`, `lat`/`lng` | `telefono`, `lat`, `lng` |

**Lo que FALCON exige y hoy no está garantizado en la ficha**: un campo de
texto libre para lo que el ciudadano relató (`descripcion`), aunque sea
vacío al crear el caso — sin él, el caso nace sin ningún relato y el
operador tiene que completarlo a mano de cero, perdiendo el propósito de la
integración. Si la plataforma no lo tiene disponible al momento del
`entrante`, que viaje vacío y se complete en el evento de cierre.

### 5.3 Evento de cierre (separado del de apertura)

Corresponde a "el receptor termina la llamada... se envía la notificación
al sistema de grabación y transcripción y resumen de la llamada" (ítem 3.7):

| Campo | Tipo | Obligatorio |
|---|---|---|
| `identificadorInteraccion` | string | **Sí** (correlaciona con el evento de apertura) |
| `fechaHoraFin` | ISO 8601 | **Sí** |
| `urlGrabacion` | string (URL) | No — puede llegar después, en un evento propio, ya que grabación/transcripción se procesan de forma asíncrona según el ítem 4 |
| `urlTranscripcion` | string (URL) | No — igual que arriba |
| `resumen` | string | No, pero deseable — es literalmente lo que pide el ítem 3.7 |

### 5.4 Respuesta que FALCON debe dar (y hoy no da)

La ficha es explícita en varios puntos (3.4, 5.5, 7.8, 8.6, 9.5): **FALCON
retorna el número de identificación del registro** al recibir el evento de
apertura — no solo un `200 OK`. Hoy `POST /api/cti/eventos/interaccion`
responde `{ recibido: true, id: <id de la fila en cti_eventos> }`; ese `id`
**no** es un caso ni un registro utilizable por las otras plataformas. Falta
decidir: ¿la respuesta debe traer un id de `caso` (si se crea de una vez) o
un id de "interacción registrada" que se resuelva a un caso más adelante,
cuando el operador la tipifique? Esto se resuelve solo cuando se defina la
lógica de negocio real (§8), pero el CONTRATO de la respuesta (qué campo,
qué forma) sí se puede fijar ya y llevarlo a la reunión.

---

## 6. Login / SSO — plan impuesto por FALCON (sin compartir el JWT de sesión)

El JWT de sesión de FALCON lleva `permisos` completos y sirve para llamar
**toda** la API — token de sesión de la barra CTI no debería, bajo ningún
motivo, ser ese mismo JWT: sería entregarle a un sistema externo la llave
completa de la cuenta del agente. La ficha (ítem 1) pide "single sign on" y
"generar el token para la autenticación" desde el login de FALCON — esto
encaja exactamente con un patrón de **token de propósito único, de vida
corta**, no con reusar el JWT existente.

### 6.1 Diseño propuesto

1. **Nuevo endpoint**, autenticado con el JWT normal de sesión (no público):
   `POST /api/cti/sso`.
2. El endpoint:
   - Verifica que el tenant tenga la integración `cti` contratada y vigente
     (mismo patrón que ya usa `SuscripcionGuard`/`asegurarVigente`).
   - Resuelve el **rol de barra** que pide la ficha —
     `recepcion` | `despacho` | `supervision` — a partir del rol/permisos
     reales del agente en FALCON (p. ej. `casos.ver_todos` → supervisión,
     `despacho.ver` → despacho, si no → recepción). Esto es una función
     nueva y pequeña, no un campo nuevo: ya tenemos toda la información.
   - Firma un **token distinto** del JWT de sesión — otro secreto/clave,
     otra audiencia, vida corta (60–120 segundos, de un solo uso si el
     proveedor lo soporta) — con exactamente: `sub` (username), `tenant`,
     `rolBarra`, y nada de `permisos` ni capacidad de llamar el resto de la
     API de FALCON.
   - Devuelve ese token al frontend.
3. **El frontend entrega el token a la barra CTI vía `postMessage`** al
   iframe ya cargado — no como *query param* en la URL del `<iframe src>`,
   que quedaría expuesto en el DOM, en logs del navegador y en el `Referer`
   si la barra hace alguna petición saliente.
4. **La barra CTI redime el token contra FALCON**, no lo interpreta por su
   cuenta: `POST /api/cti/sso/verificar` (público, autenticado con la
   `ctiApiKey` del tenant + el token recibido), que responde con
   `{ usuario, tenant, rolBarra, valido: true }` si es válido y no ha
   expirado. Con esto, la barra abre su propia sesión interna para el
   agente — sin haber visto jamás el JWT real de FALCON, y sin que FALCON
   tenga que confiar en que la barra decodificó bien un JWT ajeno.
5. El token de SSO **no sirve para nada más**: no es válido contra ninguna
   otra ruta de la API de FALCON (rechazado por no ser el JWT que emite
   `AuthService`).

### 6.2 Por qué no otras alternativas

- **Reusar el JWT de sesión**: descartado — expone permisos completos a un
  sistema externo, y si la barra lo reenvía o lo cachea, es indistinguible
  de un robo de sesión.
- **API key del tenant (`ctiApiKey`) como credencial del agente**: descartado
  — esa llave identifica al *tenant*, no a la persona; no sirve para saber
  qué agente específico está en la comunicación (necesario para las
  estadísticas "contestadas hoy" que pide la ficha, por agente).
- **Que la barra CTI pida usuario/contraseña de FALCON directamente**: es
  justo lo que el "single sign on" del proveedor busca evitar — descartado
  por diseño del propio documento.

### 6.3 Lo que falta confirmar con el proveedor

- ¿La barra CTI puede consumir el token vía `postMessage`, o su arquitectura
  exige que viaje en la URL del iframe? Si es lo segundo, hay que negociar
  cómo minimizar la exposición (token de un solo uso ayuda, pero no lo
  resuelve del todo).
- ¿Qué necesita la barra en el token además de rol/tenant/usuario? (p. ej.
  ¿nombre para mostrar en su UI, extensión, `whatsappHandle`?)
- ¿La barra mantiene su propia sesión mientras el agente esté en FALCON, o
  hay que refrescar el token periódicamente? Si el agente cambia de pestaña
  o FALCON expira su sesión, ¿qué debe pasarle a la barra?

---

## 7. Qué falta construir en FALCON (una vez la reunión confirme el contrato)

En orden de dependencia:

1. **Confirmar el contrato de payload** (§5) con el proveedor — sin esto,
   cualquier código de negocio que se escriba hoy se reescribe después.
2. **`POST /api/cti/sso`** y **`POST /api/cti/sso/verificar`** (§6).
3. **Lógica de negocio real del webhook**: hoy solo persiste el payload
   crudo. Falta, siguiendo el mismo patrón que ya usa `PbxService.webhook`:
   - Resolver `acdOperador` a un `username` (por extensión o por
     `whatsappHandle`, según el origen).
   - Crear el caso (`CasosService.crear`) o enlazarlo a uno abierto del
     mismo remitente, igual que ya hace PBX con `atender()`.
   - Notificar en vivo por Socket.IO al operador correspondiente (mismo
     mecanismo que la cola de PBX).
   - Devolver el id correcto en la respuesta (§5.4).
   - Procesar el evento de cierre: actualizar `urlGrabacion`/`urlTranscripcion`
     del caso ya creado.
4. **RLS en `cti_eventos`**: quedó fuera a propósito porque es una tabla de
   *staging* sin lógica de negocio todavía — revisar en cuanto el punto 3
   esté escrito, siguiendo el mismo patrón (`TenantRlsService.conTenant`)
   que ya se aplicó a las seis tablas críticas.
5. **Embebido del iframe**: el espacio lateral que pide el ítem 1, con el
   tema claro/oscuro sincronizado. Depende de tener resuelto el SSO (punto
   2) para poder cargar la barra ya autenticada.
6. **Transferencia de llamada de WhatsApp con directorio por agencia**
   (ítem 5.11): evaluar si es un directorio que vive en FALCON (nuevo
   catálogo) o si lo resuelve enteramente la barra CTI con datos que ya
   tiene (agencias/canales, que FALCON ya expone por `/catalogos`).

**Fuera de este alcance por ahora** (contrato aparte, §3): todo lo de
Geolocalización — ubicación en vivo, trayectoria, chat de geolocalización,
video en vivo, consulta posterior (ítems 9–14).

---

## 8. Preguntas y puntos a plantear en la reunión técnica

Organizadas para llevarlas literalmente a la reunión con los desarrolladores
de la barra CTI y de YACO.

### Sobre el contrato de datos

1. Confirmar campo por campo la propuesta de §5 — en particular
   `tipoOrigen` y `acdOperador`, que hoy **no** aparecen explícitos en la
   ficha técnica tal como está redactada (se infieren de "el ACD, operador,
   receptor").
2. ¿El "identificador de la interacción" lo genera YACO, la barra CTI, o se
   espera que lo genere FALCON en el evento de apertura y se propague hacia
   atrás? La ficha, en el ítem 8, sugiere que a veces ya existe un "ID
   Evento" desde antes (la app ciudadana) — ¿quién es la fuente de verdad?
3. Para el evento de cierre (§5.3): ¿la grabación y la transcripción llegan
   en el MISMO evento que el cierre, o en eventos posteriores separados
   (potencialmente minutos después, mientras se procesa la transcripción)?
   Esto cambia si FALCON necesita un único webhook de cierre o varios
   webhooks de actualización sobre la misma interacción.
4. ¿Hay reintentos si el webhook de FALCON no responde a tiempo (timeout,
   caída)? ¿Bajo qué política (backoff, cuántos intentos)? Necesitamos
   saberlo para diseñar la idempotencia del lado de FALCON (ya existe el
   patrón — PBX ya es idempotente por `callId` — pero hay que replicarlo
   aquí con `identificadorInteraccion`).

### Sobre el SSO (§6)

5. ¿La barra CTI puede recibir el token de sesión vía `postMessage`, o
   necesita que viaje en la URL del iframe?
6. ¿Qué exige la barra tener en el token, más allá de usuario/tenant/rol?
7. ¿Hay que refrescar el token periódicamente, o dura toda la sesión del
   agente? ¿Qué pasa del lado de la barra si el agente cierra sesión en
   FALCON?
8. Confirmar el endpoint de verificación (`POST /api/cti/sso/verificar`) —
   ¿la barra puede consumir un endpoint nuestro para validar el token, o
   espera que sea un JWT que ella misma decodifica con una llave pública
   compartida (JWKS)? Cualquiera de las dos es viable, pero cambia el
   diseño.

### Sobre el ACD y multiagencia

9. Si dos agencias distintas comparten el mismo ACD en la configuración de
   YACO/la barra, ¿cómo distingue FALCON a cuál pertenece la llamada? (Este
   punto se planteó antes y se descartó como preocupación real porque el
   flujo normal es: el ACD dirige a un operador, y **el operador** —no el
   ACD— decide a qué agencia(s) enviar el caso una vez lo tipifica. Vale la
   pena confirmarlo explícitamente con el proveedor de todas formas.)
10. ¿El directorio de contactos para transferencia de WhatsApp entre
    agencias (ítem 5.11) lo administra la barra CTI, o espera que FALCON se
    lo entregue por API?

### Sobre WhatsApp

11. El `@` (handle) que identifica al operador: ¿lo captura la barra desde
    la configuración de YACO, o necesita que FALCON se lo entregue (vía el
    campo `whatsappHandle` que ya existe)? Si es lo segundo, definir cómo se
    sincroniza (¿lo lee la barra en el SSO? ¿en un endpoint aparte?).
12. Menú del WhatsApp Business ("parametrizable por municipio", ítem 7.3):
    ¿esa parametrización vive en YACO/la barra, o FALCON necesita exponer
    algún catálogo para eso?

### Sobre grabación/transcripción y el video

13. La "firma digital" de las grabaciones (ítem 4.6): ¿en qué formato llega
    la URL? ¿FALCON necesita validar la firma en algún momento, o solo
    almacenar y mostrar el enlace (como hace hoy)?
14. Confirmar que el pop-up de video (WhatsApp video e ítem 13) es
    responsabilidad exclusiva de la barra CTI/geolocalización — que FALCON
    solo necesita reservar el espacio de UI, sin lógica propia de video.

### Sobre alcance y plan de trabajo

15. Explicitar con el cliente/proveedor que **Geolocalización queda fuera
    de este contrato** (ítems 9–14) hasta que se firme por separado — y que
    la ficha técnica, tal como está, mezcla ambos alcances en un solo
    documento.
16. Pedir un ambiente de pruebas / sandbox de la barra CTI y de YACO antes
    de comprometer fecha de entrega del lado de FALCON — hoy no hay forma
    de probar el flujo real sin uno.
17. Acordar quién es punto de contacto técnico único de cada lado para no
    perder tiempo en la implementación.

---

## 9. Riesgos y notas abiertas

- **`cti_eventos` sin RLS todavía** — aceptable mientras sea solo *staging*
  sin lógica de negocio; hay que revisarlo en cuanto el punto 3 de §7 se
  construya (crear/enlazar casos desde ahí sí toca tablas con RLS, y ya
  pasa por `TenantRlsService` automáticamente al usar `CasosService.crear`).
- **El "ID Evento" de la app ciudadana** (ítem 8) puede o no coincidir con
  `identificadorInteraccion` — si el proveedor confirma que sí, simplifica
  el contrato; si no, hay que decidir cuál manda.
- **La ficha técnica mezcla dos contratos comerciales distintos** (barra
  CTI/YACO y Geolocalización) en un solo documento — el riesgo real es que
  en la reunión se asuma que todo entra en el mismo alcance/tiempo de
  entrega. Vale la pena separarlo explícitamente al inicio de la reunión.
- **Sin ambiente de pruebas del proveedor**, todo lo de esta sección 7 se
  puede diseñar pero no verificar de punta a punta — el esqueleto actual
  del webhook (§4) ya está probado con API keys reales generadas por
  FALCON, pero nunca contra un evento real de YACO/la barra CTI.
