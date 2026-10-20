# CLAUDE.md — FALCON CAD

Guía para Claude Code al trabajar en este repositorio. Es lo primero que se lee
en cada sesión: dice qué es el sistema, dónde está cada cosa, qué no se puede
romper, y a qué documento ir antes de tocar cada área.

---

## 1. Qué es FALCON CAD

Plataforma nacional para la gestión de emergencias: recibe, clasifica, coordina
y da seguimiento a las llamadas al **123**.

Tres decisiones de arquitectura explican casi todo lo demás:

1. **Multi-inquilino sobre una sola base.** Todos los municipios comparten
   backend y PostgreSQL, aislados por una columna `tenant`. **No hay una
   instancia de infraestructura por municipio.**
2. **Monolito modular sin estado.** Un proceso organizado por dominio, sin
   llamadas de red entre sus partes. Todo el estado vive en PostgreSQL, así que
   corre con N réplicas idénticas detrás de un balanceador.
3. **Multicanal.** Un caso puede nacer de una llamada, un chat, WhatsApp, una
   entidad externa por API, o la planta telefónica propia.

**El aislamiento entre tenants es responsabilidad de la aplicación**, no del
motor: cada consulta filtra por `tenant`. Hoy **no hay Row-Level Security**. Una
consulta sin filtro de tenant es una fuga de datos entre municipios, y es el
error más grave que se puede cometer en este repositorio.

---

## 2. Estructura

```
secad-lite/
├─ backend/        NestJS 10 · TypeORM · PostgreSQL · Socket.IO
│  └─ src/
│     ├─ auth/ usuarios/ roles/ tenants/ plataforma/   identidad y RBAC
│     ├─ casos/ despacho/ catalogos/ geografia/        el núcleo CAD
│     ├─ pbx/                                          telefonía  ← ver §6
│     │  └─ planta/                                    nuestra central propia
│     ├─ whatsapp/ integracion/ cti/ sms/ correo/      canales de entrada
│     ├─ chat/ videollamada/ archivos/ els/            atención al ciudadano
│     ├─ metricas/ auditoria/ soporte/                 operación
│     ├─ credenciales/ common/                         cifrado, guardias, utilidades
│     └─ migrations/                                   59 migraciones, en orden
├─ frontend/       Angular 20 standalone · señales · tema teal
│  └─ src/app/
│     ├─ core/        servicios, guardias, interceptores, softphone
│     ├─ pages/       recepcion despacho detalle mapa monitor wallboard
│     │               admin plataforma casos catalogos dashboard
│     │               login activar recursos video-ciudadano
│     ├─ components/  piezas reutilizables (incluye el softphone)
│     ├─ layout/ shared/
├─ deploy/         lo que corre en el servidor: deploy-falcon.sh, respaldo,
│                  systemd, plantillas de Asterisk hechas a mano (históricas)
├─ docs/           la documentación. Ver §8 — está indexada por tema
├─ loadtest/       prueba de carga multi-tenant
└─ .github/workflows/ci.yml   build de backend y frontend en cada push a main
```

---

## 3. Comandos

### Desarrollo

```bash
docker compose up -d                 # PostgreSQL en localhost:5433

cd backend  && npm install && npm run start      # API en :3000/api
cd frontend && npm install && npm start          # UI en :4200
```

Credenciales de demostración (contraseña `demo`): `superadmin` (global),
`admin1`, `supervisor1`, `operador1` (tenant `demo`).

En desarrollo el esquema se crea solo (TypeORM `synchronize`) y se siembran
datos de demostración. **En producción no**: ahí mandan las migraciones.

### Pruebas y verificación

```bash
cd backend  && npx jest                          # 624 pruebas (Jest)
cd backend  && npx jest src/pbx/planta           # un módulo
cd frontend && CHROME_BIN=/opt/pw-browsers/chromium \
               npm test -- --watch=false --browsers=ChromeHeadlessNoSandbox
                                                 # 365 pruebas (Karma/Jasmine)
cd frontend && npm run build                     # build de producción
```

> **El backend usa Jest y el frontend usa Jasmine.** `jest.fn()` en una prueba
> del frontend y `jasmine.createSpy()` en una del backend no compilan, y es un
> error que ya se cometió varias veces. Mire el archivo vecino antes de escribir
> una prueba nueva.

### Migraciones

```bash
cd backend
npm run migration:generate -- src/migrations/NombreDescriptivo
npm run migration:run
npm run migration:revert
```

Numeración: el prefijo es un ordinal, no una fecha real. La última es
`1821000000000`. Una migración nueva toma el siguiente número.

---

## 4. Invariantes: lo que no se puede romper

1. **Toda consulta filtra por `tenant`.** Sin excepción.
2. **El `tenant` viaja en el JWT**, no en una cabecera. No se puede falsear.
3. **El guard de autenticación es global.** Una ruta pública se marca
   explícitamente; si no, exige token.
4. **Los permisos son dinámicos (RBAC).** Catálogo fijo verificado en código con
   `@Permisos` + guard; los roles los edita cada tenant. `superadmin` es el
   único reservado.
5. **La bitácora es inmutable.** `casos_eventos` y `admin_bitacora` son de solo
   escritura.
6. **Los secretos se guardan cifrados o por huella.** Una credencial que se
   puede volver a leer de la pantalla es una credencial publicada. Las API key
   se rotan, no se muestran.
7. **Nada de estado en memoria del proceso** si tiene que sobrevivir a una
   réplica: con más de una instancia hace falta `REDIS_URL`.

---

## 5. Convenciones de código

- **Español** en nombres de dominio, comentarios, mensajes de commit y
  documentación. El código de framework va en inglés.
- **Los comentarios explican el porqué, no el qué**, y muy especialmente el
  porqué de una decisión que parece rara. Buena parte de este repositorio tiene
  comentarios que dicen «esto ya falló así una vez»; conserve ese tono y esa
  costumbre.
- **Formato**: Prettier. Antes de tocar un archivo, compruebe si ya cumple
  (`npx prettier --check <archivo>`): varios archivos viejos no cumplen, y
  correr `--write` sobre ellos produce un diff de cientos de líneas que entierra
  el cambio real.
- **Las ediciones se anclan.** Al modificar código con un script, afirme siempre
  que el ancla existe y aparece las veces esperadas. Una sustitución que no
  encuentra su ancla y no falla es un cambio que se cree hecho y no lo está.

### Cómo se prueba aquí

El listón de este repositorio no es «hay una prueba», es **«la prueba falla
cuando la garantía se rompe»**. El método:

1. Escribir la prueba.
2. **Sabotear la implementación a propósito** y comprobar que la prueba falla.
3. Restaurar.

Una prueba que sigue pasando con la implementación saboteada no protege nada.
Dos trampas concretas que ya nos pasaron:

- **Afirmar sobre texto que también está en un comentario.** `toContain('x')`
  se da por satisfecho con la línea que explica por qué existe `x`. Ancle al
  principio de línea.
- **Negaciones vacías.** Si el ayudante devuelve `''` cuando el archivo no
  existe, cualquier `not.toContain` pasa aunque falte todo. Afirme primero que
  el contenido está, y después lo que no debe tener.

---

## 6. Telefonía — lea esto antes de tocar nada de audio

FALCON tiene **su propia central telefónica**, una por municipio. Es el área con
más trampas del repositorio y la que más tiempo ha costado depurar.

**Antes de cambiar una línea de `backend/src/pbx/`, lea:**

| Documento | Para qué |
|---|---|
| [`docs/planta-telefonica-funcionalidades.md`](docs/planta-telefonica-funcionalidades.md) | Qué hace y **cómo se integra**: `planta_asterisk` vs `config_pbx`, las rutas en los dos sentidos, el modelo de datos |
| [`docs/planta-telefonica-despliegue.md`](docs/planta-telefonica-despliegue.md) | **Cómo se instala y cómo se migra.** Su §10 es la tabla de averías y su §11 el orden de diagnóstico |
| [`docs/telefonia-planta-multitenant.md`](docs/telefonia-planta-multitenant.md) | La arquitectura multi-municipio y el reparto de puertos |

### Las cuatro reglas de esta área

1. **La configuración de Asterisk no se edita a mano en el servidor.** La genera
   FALCON (`backend/src/pbx/planta/generador.ts`) y el siguiente *Aplicar*
   sobrescribe cualquier arreglo manual. Si hay que arreglar algo en vivo, el
   mismo día va al generador, con prueba.
2. **La planta escribe `config_pbx`, nadie la teclea.** `planta_asterisk` es la
   infraestructura; `config_pbx` es cómo FALCON le habla a una planta, nuestra o
   ajena. Un dominio escrito en dos pantallas se desincroniza.
3. **Hay cuatro direcciones IP en juego y no son la misma**: pública, privada
   (la de la interfaz real), interna (por donde nginx alcanza a la planta) y la
   del nombre DNS. Confundirlas es la causa de casi todas las averías de audio.
   Están explicadas una por una en el manual de despliegue, §2.
4. **Cuando no hay audio, mida de abajo hacia arriba.** `ss -lunp | grep
   asterisk` — ¿hay socket, y no está en `127.0.0.1`? Nada de ICE, STUN,
   certificados ni versiones de Asterisk hasta que ese nivel esté confirmado. El
   procedimiento completo está en el manual, §11, con la lista de lo que **no**
   hay que hacer.

> **El 19 de octubre de 2026 se probaron cinco hipótesis equivocadas antes de
> medir lo que había que medir.** La causa —un socket de audio abierto en
> `127.0.0.1` porque Asterisk hereda la dirección del transporte del WebSocket—
> estaba visible desde el principio en un comando de una línea. El manual, §11,
> existe para que eso no se repita.

---

## 7. Servidores y despliegue

### Producción — «Servidor D»

| | |
|---|---|
| IP | `157.137.211.196` (reservada) · `falconcad.com.co` (Cloudflare) |
| Nube | Oracle Cloud, compartimento `falconcad01` |
| Carpeta | `~/falcon-deploy` |
| Qué corre | Backend ×3 réplicas · PostgreSQL 16 · Redis 7 · nginx — todo en Docker Compose; **coturn nativo con systemd**, no en Docker |

```bash
cd ~/falcon-deploy && ./deploy-falcon.sh            # backend y frontend
cd ~/falcon-deploy && ./deploy-falcon.sh --respaldo # si entran migraciones
```

El script reemplaza las réplicas de una en una, se detiene ante el primer error
y comprueba al final. `DB_MIGRATE=true` **solo en `backend1`**.

### Planta telefónica — «Servidor PBX Bogotá»

| | |
|---|---|
| IP | `157.137.196.69` pública · `10.0.0.31` privada · `pbx.falconcad.com.co` |
| Nube | Oracle Cloud, **región Bogotá** · Ubuntu 24.04 Minimal **aarch64** |
| Carpeta | `/opt/falcon-pbx/demo` |
| Qué corre | Asterisk 20 en Docker (`falcon-pbx:2`) · nginx **del sistema** sirviendo el 443 |

La planta de la instancia `demo`, migrada desde el Servidor B el 20 de octubre
de 2026. Está en Bogotá a propósito: la latencia al SBC del operador
(`clients-co2.sip.voice.infobip.com`, también en Colombia) es parte de la
calidad del audio.

**Su configuración no se edita aquí.** La genera FALCON y se aplica con el
`aplicar.sh` que descarga la pantalla de Plataforma → Planta. Ver §6, regla 1.

### Pruebas — «Servidor B»

`129.80.243.118` · `falcon-test.falconcad.com.co`. Alojó la primera planta
propia en producción (`centralita.appjeylor.com`) hasta la migración a Bogotá.
Queda como servidor de pruebas; su renovación de certificado está rota (T11).

### Trampas de despliegue que ya nos costaron

- **El frontend se publica con `rsync --delete` DENTRO del directorio**, nunca
  reemplazándolo. nginx lo tiene montado por *bind*, atado al inodo que existía
  al arrancar: sustituir el directorio deja a nginx sirviendo la carpeta vieja o
  devolviendo 403. Es la misma trampa del inodo que hace que `sed -i` rompa el
  montaje de `nginx.conf`.
- **`runtime.json` se copia, no se monta** (ver `deploy/README.md`). Montarlo
  falla callado: el despliegue sale en verde y la videollamada se degrada a
  solo-STUN, invisible en WiFi y rota en datos móviles.
- **El respaldo no es automático**, a propósito. Si los commits traen
  migraciones, el script lo avisa: ahí sí va `--respaldo`.

Detalle completo, con respaldos, 2FA, TURN y archivado:
[`docs/operacion-produccion.md`](docs/operacion-produccion.md).

---

## 8. Índice de la documentación

### Telefonía
| | |
|---|---|
| [`planta-telefonica-funcionalidades.md`](docs/planta-telefonica-funcionalidades.md) | **Qué hace la planta y cómo se integra con FALCON** |
| [`planta-telefonica-despliegue.md`](docs/planta-telefonica-despliegue.md) | **Instalar, migrar, diagnosticar.** Tabla de averías |
| [`telefonia-hoja-de-ruta.md`](docs/telefonia-hoja-de-ruta.md) | **Qué falta, priorizado y marcable.** Los puntos tienen identificador (`T1`…) para nombrarlos en una conversación |
| [`telefonia-planta-multitenant.md`](docs/telefonia-planta-multitenant.md) | Arquitectura multi-municipio, puertos, costos |
| [`telefonia-cadena-de-la-llamada.md`](docs/telefonia-cadena-de-la-llamada.md) | De que el ciudadano marca a que aparece el caso |
| [`telefonia-proveedores.md`](docs/telefonia-proveedores.md) | Cómo se agrega un proveedor de planta |
| [`telefonia-costos-y-proveedores.md`](docs/telefonia-costos-y-proveedores.md) | Qué operador elegir en Colombia y cuánto cuesta |
| [`telefonia-zadarma.md`](docs/telefonia-zadarma.md) · [`telefonia-asterisk-propio.md`](docs/telefonia-asterisk-propio.md) | Histórico: el camino anterior |
| [`integracion-cti-yaco.md`](docs/integracion-cti-yaco.md) | El camino con el tercero, que sigue vivo |

### Integraciones y API
| | |
|---|---|
| [`integraciones-externas.md`](docs/integraciones-externas.md) | **Referencia técnica**: URL, cabeceras, cuerpo y respuesta de cada endpoint |
| [`importacion.md`](docs/importacion.md) | Carga masiva de catálogos e histórico |

### Operación y despliegue
| | |
|---|---|
| [`operacion-produccion.md`](docs/operacion-produccion.md) | **El cuaderno del servidor de producción** |
| [`respaldo-y-video.md`](docs/respaldo-y-video.md) | La estrategia de respaldo y de video, en una página |
| [`despliegue-demo.md`](docs/despliegue-demo.md) · [`despliegue-vercel.md`](docs/despliegue-vercel.md) · [`despliegue-azure.md`](docs/despliegue-azure.md) | Otros destinos |
| [`mesa-de-ayuda.md`](docs/mesa-de-ayuda.md) | Soporte y matriz de severidad |

### Diseño
| | |
|---|---|
| [`sistema-de-diseno.md`](docs/sistema-de-diseno.md) | **Tokens, tipografía, componentes.** Léalo antes de tocar estilos |
| [`auditoria-diseno.md`](docs/auditoria-diseno.md) | La auditoría que originó el sistema de diseño |

---

## 9. Las tres integraciones de entrada

Cada una con su propia credencial; ninguna depende de la sesión institucional.

| Canal | Ruta | Autenticación |
|---|---|---|
| Planta telefónica | `POST /api/pbx/webhook` · `POST /api/pbx/grabacion` | `x-api-key` del tenant |
| WhatsApp (Meta Cloud API) | `GET`/`POST /api/whatsapp/webhook` | Firma `X-Hub-Signature-256` |
| Entidades externas | `POST /api/integracion/casos` | `x-api-key` de la entidad (`ek_…`) |

Referencia completa en
[`docs/integraciones-externas.md`](docs/integraciones-externas.md).

---

## 10. Deuda conocida

No la presente como novedad si sale en una conversación: está identificada.

- **Sin Row-Level Security.** El aislamiento es solo de aplicación.
- **La bitácora crece sin purga ni archivado.**
- **`DB_SSL=true` cifra pero no valida la cadena** sin `DB_SSL_CA`.
- **Sin alta disponibilidad en la telefonía**: un servidor caído deja sin
  teléfono a todos sus municipios.
- **La llamada saliente todavía no es una llamada de FALCON**, así que su
  grabación no se sube sola.
- **Los dos `location` de nginx del softphone** viven escritos a mano en el
  servidor de pruebas; deberían salir del repositorio.
- **Credenciales expuestas en pruebas pendientes de rotar.**
