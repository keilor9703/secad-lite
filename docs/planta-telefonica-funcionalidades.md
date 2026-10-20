# La planta telefónica de FALCON CAD: qué hace y cómo está integrada

> **Qué es este documento.** El inventario completo de lo que FALCON CAD puede
> hacer con teléfono, y de cómo cada pieza se conecta con las demás. Es el
> documento de *qué existe y por qué*.
>
> Su hermano es [`planta-telefonica-despliegue.md`](planta-telefonica-despliegue.md),
> que es el de *cómo se instala*. Si lo que busca es montar una planta en un
> servidor, vaya a ese. Si lo que busca es entender qué compró el municipio o
> qué toca tocar para cambiar algo, está en el correcto.
>
> Escrito el 20/10/2026, después de poner la primera planta propia en
> producción y de la noche que costó encontrar por qué no se oía nada.

---

## 1. En una frase

**FALCON CAD tiene su propia central telefónica**, una por municipio, de modo
que la llamada del ciudadano al 123 entra directo a nuestra infraestructura, se
reparte entre los operadores que están conectados a la consola, se contesta
desde el navegador sin instalar nada, y queda grabada y amarrada al caso.

Lo que antes dependía de la barra CTI de un tercero (YACO) ahora es nuestro de
punta a punta, y sigue conviviendo con el tercero donde haga falta.

---

## 2. El mapa: tres piezas y dos caminos

```
  CIUDADANO                OPERADOR TELEFÓNICO          NUESTRO SERVIDOR
   marca el                   (Infobip, …)                 (la planta)
   123 / DID                                            ┌──────────────────┐
      │                            │                    │  Asterisk        │
      └──── red telefónica ───────►│──── SIP/UDP ──────►│  en contenedor   │
                                   │     puerto 5060    │  (uno por        │
                                   │                    │   municipio)     │
                                   │◄─── RTP/UDP ──────►│                  │
                                       20500-20999      └────────┬─────────┘
                                                                 │
                                                    ┌────────────┴────────────┐
                                                    │                         │
                                            WSS 443 (nginx)            HTTPS (webhook)
                                                    │                         │
                                            ┌───────▼───────┐       ┌─────────▼────────┐
                                            │  NAVEGADOR    │       │   FALCON CAD     │
                                            │  del operador │       │   (backend)      │
                                            │  (softphone)  │◄─────►│   caso, cola,    │
                                            └───────────────┘  API  │   grabación      │
                                                                    └──────────────────┘
```

**Hay dos caminos de red que no se parecen en nada, y confundirlos es la causa
de la mitad de los problemas:**

| | La troncal | El navegador del operador |
|---|---|---|
| Protocolo | SIP sobre UDP, sin cifrar | SIP sobre WebSocket, dentro de TLS |
| Puerto | 5060 UDP, directo al host | 443 TCP, a través de nginx |
| Quién inicia | El SBC del operador telefónico | El navegador |
| Audio | RTP plano, 20500-20999 | WebRTC: ICE + DTLS + SRTP |
| Si falla | No entran llamadas | Entran, timbran y no se oyen |

El operador telefónico no sabe de nombres ni de certificados: manda SIP por UDP
a una IP y un puerto, y punto. El navegador no puede hacer nada de eso: necesita
un nombre, un certificado válido y el 443, que es el único puerto que una red
corporativa o un celular en datos dejan pasar sin preguntar.

---

## 3. Las funcionalidades, una por una

### 3.1. La llamada entrante se convierte en un caso

El ciudadano marca el número del municipio. La llamada entra por la troncal, el
plan de marcación la reconoce, y **antes de timbrar** le avisa a FALCON por un
webhook. En la consola de recepción aparece la llamada en curso con el número de
quien llama.

- Lo hace el contexto `[entrantes]` del plan de marcación.
- El aviso es `POST /api/pbx/webhook` con `{"evento":"entrante", callId, numero, extension}`.
- No espera respuesta: si FALCON está caído, la llamada igual timbra. La
  telefonía nunca depende de que el software esté arriba.

### 3.2. El softphone vive en el navegador

El operador no instala nada. Al iniciar sesión en FALCON, el navegador se
registra contra la planta por WebSocket seguro y queda disponible para recibir
llamadas.

- Cada funcionario con extensión tiene su **clave SIP**, que FALCON genera y
  guarda cifrada.
- La dirección a la que se conecta (`wss://<nombre>/ws`) **no se teclea en
  ninguna pantalla**: la escribe la planta cuando se provisiona.
- Estados visibles: libre, timbrando, contestando, en llamada.

### 3.3. La cola reparte entre los que están conectados

Las llamadas entran a una cola (`cola-<municipio>`) donde están todos los
operadores del municipio con extensión. Timbran todos a la vez (`ringall`) hasta
que alguien contesta o se agota el tiempo.

- Los operadores son miembros **estáticos**: están en la cola aunque no hayan
  abierto el navegador. Un operador sin navegador abierto aparece como
  `Unavailable` y la cola lo salta.
- Mientras timbra, el que llama escucha timbre, no música de espera.

### 3.4. Contestar abre el caso

Cuando el operador contesta, FALCON abre la ficha del caso asociada a esa
llamada. No hay que buscar nada ni copiar un número a mano.

### 3.5. Llamar desde el caso

En la ficha de un caso, junto al teléfono del ciudadano, hay un botón **Llamar**.
FALCON le pide a la planta que origine la llamada: primero timbra la extensión
del operador, y cuando contesta, marca hacia afuera.

- Lo hace por **ARI** (la interfaz REST de Asterisk), expuesta en
  `https://<nombre>/ari` detrás del mismo nginx y el mismo 443.
- El contexto `[salientes]` del plan de marcación decide por qué troncal sale y
  con qué número se presenta.

### 3.6. La grabación queda en custodia del caso

Toda llamada se graba. Al colgar, un script sube el archivo a FALCON y lo
enlaza al caso.

- `MixMonitor` graba en el contenedor y ejecuta `subir-grabacion.sh` al terminar.
- El script sube por `POST /api/pbx/grabacion` y **solo borra el archivo local
  cuando FALCON confirma que lo recibió**. Si FALCON está caído, el archivo se
  queda en el servidor y no se pierde.
- Si la llamada no tiene caso, FALCON **rechaza** la subida (409). No hay
  archivos sueltos sin dueño: una grabación de una llamada al 123 sin caso es
  una grabación sin cadena de custodia.
- En la ficha del caso la grabación tiene cuatro estados visibles: *por oír*,
  *sonando*, *en custodia*, *subida incompleta*.

### 3.7. Administrar la planta desde la pantalla

En **Plataforma → Nuestras centralitas** (solo superadmin) se da de alta y se
configura la planta de cada municipio:

- Servidor, IP pública, IP privada, IP interna, nombre DNS.
- Puertos (los reparte FALCON solo; se editan únicamente para registrar una
  planta que ya existía con otros).
- **Troncales**: por dónde entra la llamada. Operador, servidor SBC, puerto,
  autenticación (por IP, registro o digest), redes del SBC, canales.
- **Números**: lo que marca el ciudadano. DID o número corto, a qué troncal
  pertenece, y a dónde entra (la cola, o una extensión concreta).
- Un diagnóstico **«qué le falta»** que dice en orden qué impide que esa planta
  atienda una llamada.

De ahí salen dos botones:

- **Vista previa** — enseña los archivos que se van a generar, con los secretos
  tapados. No cambia nada ni rota nada.
- **Aplicar** — genera la configuración completa y un `aplicar.sh` que la
  instala en el servidor con un solo comando.

### 3.8. Una planta por municipio, sobre un servidor compartido

Varios municipios comparten servidor, pero **cada uno tiene su contenedor**, su
puerto SIP, su tajada de puertos de audio y su nombre DNS. El peor caso de un
error de configuración es un municipio sin teléfono, no todos.

FALCON reparte los puertos: 24 plantas por servidor con el plan por defecto.

---

## 4. Cómo está integrada con FALCON, en detalle

Esta sección es la que hay que leer antes de tocar código.

### 4.1. Dos tablas que parecen la misma y no lo son

| | `planta_asterisk` | `config_pbx` |
|---|---|---|
| Qué guarda | **La infraestructura**: qué contenedor corre en qué servidor, con qué puertos y con qué nombre | **Cómo le habla FALCON a una planta**, sea nuestra o de un tercero |
| Quién la llena | El superadmin, en «Nuestras centralitas» | **La propia planta**, al provisionarse |
| Para qué sirve | Generar la configuración de Asterisk | Que el módulo de recepción sepa a qué conectarse |
| Si el municipio usa YACO | No existe fila | Sí existe, con proveedor `YACO` |

**La regla que no se puede romper:** cuando una planta se provisiona, **ella
escribe** la fila de `config_pbx` de su instancia (proveedor `ASTERISK`,
dirección WSS, dominio, ARI). Nadie copia esos datos a mano de una pantalla a la
otra. Un dominio escrito dos veces se desincroniza el día que se migra de
servidor, y el síntoma es un softphone que nunca se registra.

Por eso en la pestaña «Configuración e integraciones» de una instancia que tiene
planta propia **no se edita nada a mano**: lo que se vea ahí debe ser lo que
escribió la planta.

Esa separación es lo que permite que un municipio con YACO y otro con planta
nuestra convivan sin ramas por todas partes: el módulo de recepción, la cola y
los casos solo conocen `config_pbx`.

### 4.2. Las rutas que usa la planta contra FALCON

Todas van autenticadas con la **API key del tenant**, que viaja en una cabecera
y que el dialplan lee de un archivo (`falcon-webhook.conf`) en vez de ponerla en
la línea de comandos — porque lo que se pasa en la línea de `System()` aparece
en `ps aux` para cualquier usuario del servidor y se escribe en el log de cada
llamada.

| Ruta | Quién la llama | Para qué |
|---|---|---|
| `POST /api/pbx/webhook` | El dialplan | Avisar `entrante` y `colgada` |
| `POST /api/pbx/grabacion` | `subir-grabacion.sh` | Subir el audio y enlazarlo al caso |

**La API key se rota sola en cada *Aplicar***, porque FALCON solo guarda su
huella y no puede volver a mostrarla. Eso es deliberado: una key que se puede
leer de la pantalla es una key publicada.

### 4.3. Las rutas que usa FALCON contra la planta

| Qué | Cómo |
|---|---|
| Originar una llamada (botón «Llamar») | ARI, `https://<nombre>/ari`, usuario `falcon` |
| Registro del softphone | El navegador, `wss://<nombre>/ws` |

FALCON **no** usa el WebSocket de eventos de ARI. Lo que pasa con las llamadas
lo cuenta el dialplan por el webhook: un camino menos y sin conexión permanente
que mantener.

### 4.4. Las rutas que usa el navegador contra FALCON

| Ruta | Para qué |
|---|---|
| `GET /api/pbx/softphone` | Las credenciales SIP y la dirección WSS del operador |
| `GET /api/pbx/capacidades` | Qué sabe hacer la planta de esta instancia |
| `GET /api/pbx/llamadas` | Las llamadas en curso |
| `POST /api/pbx/llamadas/:id/atender` · `reclamar` · `soltar` · `vincular` | Operación de la cola y amarre al caso |
| `POST /api/pbx/marcar` | El botón «Llamar» |

### 4.5. Los contextos del plan de marcación

| Contexto | Qué hace |
|---|---|
| `[entrantes]` | Reconoce el número marcado, avisa a FALCON, arranca la grabación y entrega a la cola o a una extensión |
| `[salientes]` | Las llamadas que origina FALCON, elige troncal y número de presentación |
| `[atender]` | El tramo que conecta al operador |

### 4.6. Los archivos que FALCON genera

Un *Aplicar* produce este paquete, y **ninguno de estos archivos se edita a mano
en el servidor**: el próximo *Aplicar* los sobrescribe.

```
/opt/falcon-pbx/<instancia>/
├── etc/                      ← se monta COMO /etc/asterisk en el contenedor
│   ├── asterisk.conf             rutas base
│   ├── logger.conf               a dónde va el log
│   ├── pjsip.conf                transportes y extensiones  (600, lleva claves)
│   ├── pjsip-troncal.conf        la troncal del operador    (600, lleva claves)
│   ├── extensions.conf           el plan de marcación
│   ├── queues.conf               la cola de operadores
│   ├── rtp.conf                  puertos de audio, ICE
│   ├── http.conf                 el WebSocket y ARI
│   ├── modules.conf              qué módulos cargar
│   ├── ari.conf                  credenciales de ARI        (600)
│   ├── falcon-webhook.conf       la API key                 (600)
│   ├── falcon-api.conf           la API key                 (600)
│   └── subir-grabacion.sh        la subida de la grabación
├── imagen/Dockerfile         ← la imagen, igual para todas las plantas
├── nginx/<nombre>.conf       ← el sitio que publica el 443
├── docker-compose.yml
├── grabaciones/              ← volumen
├── log/                      ← volumen
└── aplicar.sh                ← lleva dentro a todos los demás (600)
```

`aplicar.sh` se arma **de último y de último de verdad**: lleva dentro a todos
los otros archivos, así que se construye cuando la lista ya está completa. Si se
arma antes, instala una planta sin su troncal — y eso no falla al aplicar: falla
cuando entra la primera llamada y no hay por dónde.

### 4.7. Las claves SIP de los funcionarios

- Las genera FALCON en el *Aplicar*, para los funcionarios que tengan extensión
  y no tengan clave.
- **Nunca se sobrescriben.** Volver a aplicar no cambia la clave de nadie, así
  que no deja softphones caídos sin avisar.
- Para rotar una: vaciar el campo «clave SIP» del funcionario en
  Administración → Funcionarios, y volver a aplicar.

---

## 5. El modelo de datos

### `planta_asterisk` — la infraestructura

| Columna | Qué es | De dónde sale |
|---|---|---|
| `tenant` | El municipio. Único: una planta por instancia | Se elige al dar de alta |
| `servidor` | Nombre o IP por la que se entra por SSH | Se teclea |
| `ipPublica` | La IP que la planta anuncia | Si `servidor` ya es una IP, es esa |
| **`ipPrivada`** | La IP de la interfaz real del servidor | `ip -4 addr show` |
| **`ipInterna`** | Por dónde el nginx que termina el TLS alcanza a la planta | `127.0.0.1`, o la del puente de Docker |
| `dominioSip` | El nombre por el que entra el navegador. Único en la plataforma | Se teclea o se deriva |
| `puertoSip`, `rtpDesde`, `rtpHasta`, `puertoHttp` | La ranura de puertos | Los reparte FALCON |
| `estado` | `borrador` · `provisionada` · `activa` · `suspendida` | |
| `notas` | Lo que no quepa en un campo | |

Los tres campos de IP **no son lo mismo** y confundirlos es la avería más cara
que hemos tenido. Están explicados uno por uno en el manual de despliegue,
sección «Los cuatro datos del servidor».

### `pbx_troncal` — por dónde entra la llamada

Por municipio: operador, servidor SBC, puerto, autenticación (`ip` · `registro`
· `digest`), clave cifrada, redes del SBC en CIDR, canales, prioridad.

Las redes se validan: un CIDR inválido hace que Asterisk **rechace el módulo
pjsip entero**, no solo esa troncal.

### `pbx_numero` — lo que marca el ciudadano

Número, tipo (`did` o `corto`), a qué troncal pertenece, y destino (`cola` o una
extensión). Los números se normalizan: un `3…` o `6…` de diez dígitos se vuelve
`+57…`.

### `config_pbx` — cómo le habla FALCON a la planta

`tenant`, `proveedor` (`ASTERISK` · `YACO` · …), `activo`, `credenciales`
(cifradas), `numeroEntrante`. **La escribe la planta**, no se teclea.

---

## 6. Lo que la planta NO hace

Decirlo claro ahorra discusiones:

- **No es un conmutador de oficina.** No hay buzón de voz, ni IVR de varios
  niveles, ni transferencias asistidas, ni salas de conferencia.
- **No hace video.** La videollamada de FALCON es otra cosa y va por otro
  camino.
- **No sobrevive sola a la caída del servidor.** Una planta por municipio sobre
  un servidor compartido significa que si el servidor se cae, se caen todos los
  municipios de ese servidor. No hay alta disponibilidad todavía.
- **No marca hacia afuera sin troncal con salida.** Varias troncales entregan
  llamadas pero no permiten originarlas.
- **La llamada saliente todavía no queda como llamada de FALCON**, así que su
  grabación no se sube sola. Está en el backlog.

---

## 7. Qué falta (backlog, en orden de valor)

1. **La llamada saliente como llamada de FALCON**, para que su grabación se
   suba y se enlace igual que la entrante.
2. **Número de desborde de la cola**: a dónde va la llamada si nadie contesta.
3. **Diagnóstico desde la pantalla**: que «qué le falta» pueda además comprobar
   el estado real del contenedor, la troncal y el certificado.
4. **Aplicar por SSH** desde FALCON, en vez de descargar un script y correrlo a
   mano.
5. **Puertos reservados por servidor** en una tabla propia, para dejar de
   deducirlos de las plantas.
6. **Alta disponibilidad**: hoy un servidor caído es todos sus municipios sin
   teléfono.
7. **Los dos `location` de nginx en el repositorio.** Hoy, en el servidor de
   demostración, viven escritos a mano en el `nginx.conf` de `falcon-deploy`. Si
   esa máquina se rehace, se pierden.

---

## 8. Documentos hermanos

| Documento | Para qué |
|---|---|
| [`planta-telefonica-despliegue.md`](planta-telefonica-despliegue.md) | **Cómo se instala y cómo se migra.** El manual operativo |
| [`telefonia-planta-multitenant.md`](telefonia-planta-multitenant.md) | La arquitectura multi-municipio, el reparto de puertos y los costos |
| [`telefonia-cadena-de-la-llamada.md`](telefonia-cadena-de-la-llamada.md) | Qué pasa entre que el ciudadano marca y el caso aparece |
| [`telefonia-proveedores.md`](telefonia-proveedores.md) | Qué operador telefónico elegir y por qué |
| [`integracion-cti-yaco.md`](integracion-cti-yaco.md) | El camino con el tercero, que sigue vivo |
