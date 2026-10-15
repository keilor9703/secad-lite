# Zadarma en FALCON CAD

Cómo se conecta la centralita de Zadarma, qué está hecho, qué falta, y qué hay
que tocar en su panel.

> **Zadarma es UNA planta, no el modelo.** FALCON trata a todos los
> proveedores de telefonía por el mismo puerto: cada uno declara qué sabe
> hacer y qué credenciales pide, y el camino del aviso —instancia, encendido,
> firma, traducción, cola, bitácora— es uno solo. Cómo se da de alta un
> proveedor nuevo está en
> [`telefonia-proveedores.md`](telefonia-proveedores.md); esta página es el
> detalle de Zadarma.

> **Para qué sí, y para qué todavía no.** Esto convierte a Zadarma en la planta
> telefónica de una instancia de FALCON: las llamadas entran a la cola de
> Recepción, se dirigen al operador que tiene esa extensión y quedan en el
> registro. Es exactamente el banco de pruebas que recomienda
> [`telefonia-cadena-de-la-llamada.md`](telefonia-cadena-de-la-llamada.md) §9.
>
> Ese documento dejaba dos objeciones abiertas —residencia de datos en
> Colombia y enrutamiento del 1XY— y **las dos quedaron resueltas como
> decisión de negocio el 15/10/2026**, no como hallazgo técnico: por ahora no
> condicionan el trabajo. El enrutamiento del 123, además, nunca pasó por
> Zadarma: llega por troncal SIP a través del proveedor del municipio —ver
> §1.1—. Conviene volver a mirarlas antes de firmar un 123 de producción,
> porque una decisión comercial puede cambiar y un requisito regulatorio no.

---

## 1. Qué hace cada pieza

| Eslabón | Quién lo pone |
|---|---|
| Número que marca el ciudadano (DID) | Zadarma |
| Troncal y transporte del audio | Zadarma |
| Centralita, colas, IVR | Zadarma (su «centralita virtual») |
| Teléfono del operador | Hoy: softphone (MicroSIP) o teléfono IP. Mañana: dentro de FALCON, por WebRTC |
| Aviso de la llamada, cola, caso, informes | **FALCON** |
| Grabación | Zadarma graba; FALCON la descargará y la pegará al caso (pendiente) |

FALCON **no enruta**: quién recibe cada llamada lo decide la centralita. Lo que
FALCON hace es traducir «se la estoy ofreciendo a la extensión 101» a «avísale
a Juan Pérez, que es el dueño de la 101».

### 1.1 De dónde sale el número de cada municipio

Esta es la parte comercial, y explica por qué el 1XY no es un problema de
Zadarma. Hay **tres casos**, y cada municipio cae en uno:

| Caso | Qué tiene el municipio | Qué hay que hacer |
|---|---|---|
| **A** | Piloto **123** | Pedirle a su operador que la **troncal física pase a troncal SIP en la nube**. Con eso, todas las llamadas del 123 de ese municipio se pueden entregar a la plataforma de comunicaciones, y de ahí bajan a FALCON |
| **B** | Sin 123, pero con **línea fija o WhatsApp** | El número de WhatsApp se **absorbe** en la plataforma: en vez de vivir en el celular de alguien, queda asociado a la barra y la llamada entra directo a FALCON (ya probado). Una línea fija es igual que el caso A: hay que pasarla a troncal SIP |
| **C** | **Nada** (ni 123, ni fija, ni WhatsApp) | Nosotros le damos el número en la nube —fijo o WhatsApp— como **servicio facturable**, y ese pasa a ser el número del municipio |

Lo que FALCON ve es lo mismo en los tres: una llamada entrante con su número.
La diferencia es de quién es la troncal y quién factura.

**Dónde encaja Zadarma:** es la pieza del caso **C** —el número en la nube que
podemos dar nosotros— y, mientras tanto, el banco de pruebas de toda la
cadena. El caso A no depende de ella: ahí el 123 entra por la troncal SIP del
operador del municipio.

> **Y sobre YACO, para no confundirse.** La integración **CTI / YACO (barra
> embebida)** —la de [`integracion-cti-yaco.md`](integracion-cti-yaco.md)—
> está en FALCON **solo como esqueleto**: el proveedor todavía no ha
> desarrollado la barra. Las llamadas que hoy llegan de YACO entran por la
> integración **Planta telefónica (PBX)**, el mismo webhook genérico que usa
> esta página, no por la de CTI. YACO sigue siendo quien controla la llamada y
> quien la baja a FALCON; lo que se construye aquí es la alternativa.

---

## 2. Lo que ya está hecho

- `POST /api/pbx/zadarma/:clave` — recibe los eventos de la centralita.
- Responde la validación `zd_echo` del panel (por GET y por POST).
- Verifica la **firma** de cada evento (`Signature`), que es lo único que
  autentica: la llave de la URL solo elige de qué instancia se habla.
- Traduce la secuencia de Zadarma al modelo de llamada de FALCON, el mismo que
  usa la planta actual:

  | Evento de Zadarma | Qué hace FALCON |
  |---|---|
  | `NOTIFY_START` | La llamada entra a la cola y empieza a sonar en pantalla |
  | `NOTIFY_INTERNAL` | La misma llamada, ya dirigida a una extensión → se le avisa a ese operador |
  | `NOTIFY_ANSWER` | Anota quién descolgó (no abre el caso: eso lo hace el operador al «atender») |
  | `NOTIFY_END`, `NOTIFY_INTERNAL_END`, `NOTIFY_OUT_END` | Cierran la llamada que nombra su `pbx_call_id`, si queda alguna abierta. Si la central dice `answered`, **no** se cuenta como perdida. Ver *El fin de la llamada no tiene un solo nombre* |
  | `NOTIFY_OUT_START` | Saliente: queda en la bitácora, no entra a la cola |
  | `NOTIFY_RECORD` | Todavía no se usa (ver *Lo que falta*) |

- **Contestar DENTRO de FALCON** (softphone propio, SIP sobre WebSocket): el
  operador descuelga en la misma pantalla donde escribe el caso, y con ese
  mismo clic la llamada de la cola queda **tomada para él** —desaparece de la
  cola de los demás— y su número viaja a Recepción. Un gesto en vez de dos
  programas.
  - Se enciende a mano (botón *Encender* en el panel del teléfono): registrarse
    toma el micrófono y hace que la central empiece a entregarle llamadas a ese
    navegador, y eso no debe pasarle a quien entró a consultar un caso.
  - **Hace falta configurar tres cosas**: el *WebSocket SIP* y el *Dominio SIP*
    de la instancia (Plataforma → Planta telefónica) y la **clave SIP de cada
    extensión** (Administración → Usuarios, botón *SIP* al lado de la
    extensión). Sin eso el panel dice exactamente qué falta y la telefonía
    sigue funcionando igual: se contesta en el teléfono de siempre.
  - La clave SIP **sí baja al navegador**, y es inevitable: en un softphone web
    el que se registra es el navegador. Lo que se acota es el alcance —solo la
    del propio usuario, solo por la ruta del softphone, nunca en un listado de
    administración ni en un registro—.
- **Llamar desde el caso** (`POST /api/pbx/marcar`): la central llama primero a
  la extensión del operador y, al descolgar, al ciudadano. Por eso funciona sin
  softphone: el audio nunca pasa por el navegador. El botón está junto al
  teléfono en el detalle del caso y en Recepción, y **solo se dibuja** si la
  planta de esa instancia declara que sabe marcar.
  - La extensión sale del usuario que pide la llamada, **nunca del navegador**:
    es una llamada facturable que queda a nombre de alguien en el registro de
    la central.
  - Cada intento —salga o no— queda en la bitácora de administración con el
    número que de verdad se marcó, y el caso recibe una nota.
  - Diez por minuto por operador: alcanzan de sobra para una sala de despacho y
    evitan que un botón repetido gaste la cuenta del municipio.
- Configuración por instancia en `config_pbx`: las credenciales se guardan como
  JSON en una sola columna y **lo que el proveedor marca como secreto va
  cifrado**. Antes eran dos columnas con nombre de Zadarma; ahora los campos
  los declara su descriptor, y de ahí sale también el formulario de la
  pantalla —etiquetas, ayudas y cuáles son de solo escritura—.
- **Dos interruptores**, como las demás integraciones:
  - la integración `pbx` del tenant: si no la tiene, no hay telefonía;
  - `activo` en `config_pbx`: la hay, pero esta planta está apagada ahora mismo.
    Lo que llegue se anota en la bitácora y no toca la cola.

Sin fila en `config_pbx`, una instancia sigue funcionando como siempre con el
webhook genérico de YACO. Esto no puede romper lo que ya opera.

---

## 3. Qué hay que hacer en el panel de Zadarma

### 3.1 Antes de empezar: qué debe estar listo

> **El endpoint tiene que existir en producción ANTES de tocar el panel.**
> Zadarma valida la dirección en el momento de guardarla: si FALCON todavía no
> está desplegado con este cambio, el panel la rechaza y parece un problema de
> la URL. Primero `./deploy-falcon.sh`, después el panel.


| | Dónde se ve | Estado que necesita |
|---|---|---|
| Centralita virtual creada | *PBX* | Activa |
| Extensiones | *PBX → Internal numbers* | Una por operador (ya tiene tres) |
| Un número entrante (DID) | *My numbers* | Apuntando a la centralita |
| Escenario de entrada | *PBX → Incoming call scenarios* | Que el DID caiga en el grupo o la extensión |
| Llaves de la API | <https://my.zadarma.com/api/> | `key` y `secret` a la mano |

Lo que ya probó con MicroSIP cubre los cuatro primeros: si marcando el número
suena la extensión y se puede hablar, el audio ya funciona. Lo que falta es
que la centralita le **cuente** a FALCON lo que está pasando.

**Se puede probar el webhook sin número entrante.** Una llamada de extensión a
extensión (101 marca 102) dispara `NOTIFY_INTERNAL` y `NOTIFY_END`, que basta
para comprobar que la dirección, la firma y la bitácora funcionan. Para la
cadena completa —el ciudadano marca y entra a la cola— sí hace falta un DID
apuntando a la centralita, y saldo: un DID colombiano son unos 12 USD de
conexión y entre 12 y 18 al mes.

### 3.2 El webhook

El panel cambió de forma y la documentación de Zadarma todavía habla de una
pestaña «CRM» que ya no se llama así. Hoy (octubre de 2026) la ruta es:

> **Configuración → Integraciones y API → pestaña «Integraciones» →
> bloque «Servicios Zadarma» → mosaico «Notificaciones de eventos».**

Ese mosaico **es** el webhook: ahí se activa y ahí va la dirección. Mientras
diga *Activadas (0)* no hay ninguna notificación saliendo, y por eso no se ve
ningún campo de URL en el resto del panel.

La pestaña **«Claves y API»** dice en su propio encabezado que desde ahí se
«configura el enlace para las notificaciones»; si el campo no aparece a
primera vista, sale al pulsar **MODIFICAR CLAVES**. Las dos rutas llevan al
mismo sitio.

Al abrir **Notificaciones de eventos** salen dos pasos:

- **«Paso 1. Agrega el código al inicio de script»**, con un fragmento de PHP
  (`if (isset($_GET['zd_echo'])) exit($_GET['zd_echo']);`). **No hay que hacer
  nada**: eso es para quien recibe el webhook en un script propio, y es
  exactamente lo que FALCON ya hace. De paso confirma el mecanismo: la
  validación llega por **GET, con `zd_echo` en la cadena de consulta**.
- **«Paso 2. Inserta enlaces»**, con DOS campos. Solo sirve el primero:

  | Campo | Qué manda | ¿La URL de FALCON? |
  |---|---|---|
  | **Sobre llamadas a la centralita** | `NOTIFY_START`, `NOTIFY_INTERNAL`, `NOTIFY_ANSWER`, `NOTIFY_END`, `NOTIFY_RECORD` | **Sí, aquí** |
  | Sobre eventos | SMS, consultas de número, saldo, *call tracking* | No, vacío |

1. Abra **Notificaciones de eventos**.
2. En **«Sobre llamadas a la centralita»** pegue, **con la llave de la
   instancia al final**:

   ```
   https://falconcad.com.co/api/pbx/zadarma/<API_KEY_DE_LA_INSTANCIA>
   ```

   La API key es la que ya existe para el webhook de la planta — en FALCON,
   *Administración → la instancia*. Si no la tiene a mano, rótela y copie la
   nueva (se muestra una sola vez).
3. Pulse **Agregar**. Es en ESE momento cuando Zadarma llama a la dirección
   con un `zd_echo` para comprobar que es suya — de ahí que el endpoint tenga
   que estar ya desplegado.
4. Si después aparece una lista de eventos para marcar, marque **NOTIFY_START,
   NOTIFY_INTERNAL, NOTIFY_ANSWER y NOTIFY_END**. Los demás pueden quedar
   marcados: FALCON los acepta y los ignora sin quejarse.

**Si dice que la URL no es válida**, compruébelo usted mismo antes de pelear
con el panel:

```bash
curl "https://falconcad.com.co/api/pbx/zadarma/<API_KEY>?zd_echo=prueba123"
# tiene que imprimir exactamente:  prueba123
```

Si imprime otra cosa —comillas, un JSON, un espacio— el panel lo rechaza. Si no
imprime nada, el problema es de red o de nginx, no de FALCON.

### 3.3 Las llaves, en FALCON

Con el superadmin, en **Plataforma → Configuración e integraciones → Planta
telefónica**:

1. Elija la **instancia**.
2. Proveedor **Zadarma**. Queda elegida y **apagada**: sin el secreto no se
   puede verificar nada de lo que llegue, así que la pantalla lo dice y espera.
3. Pegue la **Key** y el **Secret** —los campos aparecen al elegir el
   proveedor, con su ayuda, porque los declara el propio proveedor— y el
   **número entrante** si ya lo tiene; después, *Guardar credenciales*. Al
   quedar completas **la planta se enciende sola**: la única razón por la que
   estaba apagada era que faltaban. Si la quiere apagada, se apaga, que es un
   clic.
4. El panel dice en cada momento qué falta, nombrando los campos:
   *falta Key de la API, Secret de la API* → *apagada* → *lista, falta pegar la
   dirección en Zadarma*. Y dice también **qué sabe hacer** el proveedor, para
   no ofrecer lo que no puede.
5. El panel arma la **dirección del webhook** y la deja lista para copiar; solo
   hay que agregarle al final la API key de esa instancia.

El secreto se guarda cifrado y **no vuelve a bajar al navegador**, ni para
mostrarlo: el campo dice si está puesto y nada más. Eso no es una regla
escrita para Zadarma —sale de que su descriptor marca ese campo como secreto,
así que vale igual para cualquier proveedor que venga—. Activar la planta
**sin** las credenciales requeridas se rechaza a propósito —sin ellas no se
puede verificar nada de lo que llegue— y la pantalla muestra ese motivo tal
cual.

Cambiar el proveedor o apagar la integración **no borra** el secreto: el campo
solo escribe, así que dejarlo vacío conserva el que había.

### 3.4 Las extensiones, con su dueño

En FALCON, *Administración → Usuarios*, columna **Extensión PBX**: cada
operador lleva el número de su extensión de Zadarma (101, 102, 103). Sin eso la
llamada entra a la cola pero no se le anuncia a nadie en particular — funciona,
pero pierde la mitad de la gracia.

### 3.5 Comprobar que llegó

**Sin DID todavía**, la prueba que sí se puede hacer es entre extensiones:
regístrese con MicroSIP (o el teléfono web de *Mi centralita*, o la app) en la
101, marque `102`, conteste en la otra y cuelgue. No es una llamada del
ciudadano —entra por `NOTIFY_INTERNAL`, no por `NOTIFY_START`— pero recorre
toda la cadena: URL, firma, cola, operador y cierre.

Con DID, llámelo desde un celular. En los dos casos mire, en este orden:

1. La llamada aparece en la cola de *Recepción* mientras suena.
2. Al sonar la extensión, el aviso se dirige a ese operador —siempre que esa
   extensión esté puesta en su usuario (§3.4); sin eso se anuncia a todos.
3. Al colgar, queda en el registro con su duración.

Si no aparece, el rastro está en la base, no en los logs del proceso:

```sql
SELECT "creadoEn", exitoso, "estadoHttp", left(motivo, 80) AS motivo, left(cuerpo, 200)
FROM pbx_webhook_log ORDER BY "creadoEn" DESC LIMIT 10;
```

La tabla se lee como una transcripción de la llamada. `motivo` dice **qué se
hizo**, no solo qué falló:

```
 exitoso |       evento        | motivo
---------+---------------------+--------------------------------------------------
 t       | NOTIFY_INTERNAL     | Dirigida a la extensión 102
 t       | NOTIFY_ANSWER       | Contestada por la extensión 102
 t       | NOTIFY_OUT_END      | Colgada (answered, 37 s)
 t       | NOTIFY_INTERNAL_END | Ya estaba cerrada (finalizada); no cambió nada
 t       | NOTIFY_OUT_START    | Saliente 101 → 573009999999, no entra a la cola
 t       | NOTIFY_START        | Entrante de 573001234567
 t       | NOTIFY_END          | Colgada (no answer, 0 s)
 f       | NOTIFY_END          | La firma no corresponde al cuerpo de la petición.
```

| Lo que dice `motivo` | Qué pasó |
|---|---|
| `Llave de instancia desconocida` | La API key de la URL no es la de ninguna instancia |
| `El módulo de pbx no está habilitado` | A la instancia le falta la integración `pbx` |
| `Esta instancia no tiene Zadarma…` | Falta `config_pbx`, o el proveedor quedó en `YACO` |
| `…está apagada para esta instancia` | `activo = false`; es a propósito |
| `La firma no corresponde…` | El secreto guardado no es el de esa cuenta de Zadarma |
| `Entrante de …` / `Dirigida a la extensión …` | Entró a la cola |
| `Colgada (…)` | Se cerró la llamada; entre paréntesis, lo que dijo la central |
| `Ya estaba cerrada (…)` | Aviso de fin repetido —llegan dos—; no cambió nada |
| `… no estaba en la cola, nada que cerrar` | Fin de una saliente de verdad: nunca creó fila |
| `Saliente … no entra a la cola` | La marcó un operador; la cola es de lo que entra |

Si no hay NINGUNA fila, la petición no llegó: es Zadarma, el DNS o nginx.

> Hasta el 15/10/2026 esta tabla no servía para nada con Zadarma: TODA
> petición quedaba como `exitoso = true`, sin motivo, sin tenant y sin el
> nombre del evento, porque esta ruta responde 200 incluso cuando rechaza y el
> interceptor genérico tomaba ese `{ ok: false }` por un éxito. Si está
> mirando una fila vieja así, no significa que estuviera bien.

---

## 4. Lo que falta, en orden

1. ~~**Contestar dentro de FALCON.**~~ Hecho, con **softphone propio** sobre su
   SIP y no con el widget de Zadarma: el widget es más rápido de montar pero
   mete su interfaz dentro de la nuestra y el audio pasa por su página.
   Falta lo que solo se puede hacer en su panel y comprobar con tráfico real:
   - **autorizar el dominio** `https://falconcad.com.co` en *Integraciones y
     API → WebRTC*. Hasta que esté en la lista, el navegador no se registra.
   - **confirmar la dirección del WebSocket y el dominio SIP** que publica
     Zadarma, y pegarlos en Plataforma. FALCON **no adivina ninguna de las
     dos** a propósito: una dirección inventada falla con un error de
     WebSocket que no se parece en nada a «esto nunca se configuró».
   - registrar la **clave SIP de cada extensión** en Administración → Usuarios.
2. **La grabación al caso.** `NOTIFY_RECORD` avisa que está lista; se pide con
   `/v1/pbx/record/request/` (hay que esperar unos segundos: justo después del
   aviso, el archivo todavía no está) y se guarda como adjunto del caso, con la
   misma política de retención que el video.
3. ~~**Llamada saliente desde el caso.**~~ Hecho (ver §2). Falta una sola cosa,
   y no es código: **comprobar que el servidor de producción puede SALIR** a
   `api.zadarma.com`. El webhook va en la dirección contraria —lo inicia
   Zadarma—, así que que las llamadas entren no dice nada sobre si se pueden
   originar. Si la salida está cerrada, el botón dice «No se pudo hablar con la
   centralita» y se arregla apuntando `ZADARMA_API_URL` a un proxy de salida.
4. **El número de verdad.** Hoy no hay DID: la cuenta solo tiene extensiones,
   así que se puede probar todo menos la llamada del ciudadano. Para el caso
   **C** de §1.1 —el número en la nube que vendemos nosotros— basta comprar
   uno en Zadarma y ponerlo en *Número entrante* en Plataforma. El 123 del
   caso **A** no sale de aquí: eso es troncal SIP del operador del municipio.

---

## 5. Dónde vive

| Pieza | Archivo |
|---|---|
| Firma de sus webhooks | `backend/src/pbx/zadarma/zadarma.firma.ts` |
| Firma de las llamadas a su API | `backend/src/pbx/zadarma/zadarma.api.ts` |
| Su descriptor y su traductor | `backend/src/pbx/proveedores/zadarma.proveedor.ts` |
| Endpoint del webhook (solo su saludo) | `backend/src/pbx/zadarma/zadarma.controller.ts` |
| El camino común de un aviso | `backend/src/pbx/avisos.service.ts` |
| Credenciales: leer, descifrar, guardar | `backend/src/pbx/pbx-credenciales.service.ts` |
| Configuración por instancia | `backend/src/pbx/config-pbx.entity.ts`, `pbx-config.service.ts` |
| Pantalla de configuración (armada del catálogo) | `frontend/src/app/pages/plataforma/` |
| Cola, casos y avisos (comunes a todas las plantas) | `backend/src/pbx/pbx.service.ts` |
| El puerto y el registro de proveedores | `backend/src/pbx/proveedores/` |

### El fin de la llamada no tiene un solo nombre

Lo encontró la primera llamada real, entre dos extensiones: entró a la cola,
se colgó en el softphone y en FALCON **siguió timbrando**; hubo que cerrarla a
mano por la API.

La causa es que Zadarma cuenta esa llamada desde los dos lados. Para la 102 es
una entrante (`NOTIFY_INTERNAL`) y FALCON la encola; para la 101, que fue la
que marcó, es una **saliente**, y su fin llega como `NOTIFY_OUT_END` —que se
ignoraba, por saliente—. Y a veces llegan los dos finales, el de la pata
interna y el de la saliente, por la misma llamada.

Las dos salidas obvias eran malas: ignorar `NOTIFY_OUT_END` deja la llamada
colgada en la cola para siempre, y tratarlo como un `colgada` cualquiera
responde 404 cuando sí era una saliente de verdad —y un 404 lo reintenta la
central sin fin—. Así que lo que decide **no es el nombre del evento sino el
`pbx_call_id`**:

| Llega | Hay una llamada con ese `pbx_call_id` | Qué se hace |
|---|---|---|
| `NOTIFY_END`, `NOTIFY_INTERNAL_END`, `NOTIFY_OUT_END` | Sí, abierta | Se cierra |
| lo mismo | Sí, ya cerrada | Nada; se anota «ya estaba cerrada» |
| lo mismo | No | Nada; era una saliente de verdad |
| `NOTIFY_OUT_START` | — | Nada: la cola es de lo que ENTRA |

Dos detalles que solo se ven con tráfico real:

- En `NOTIFY_OUT_END`, `internal` es la extensión que **marcó**, no la que
  contestó. Tomarla por el agente dejaba la llamada 101→102 atribuida a la
  101 en el historial del municipio.
- El segundo aviso de fin no vuelve a guardar ni a mover la cola en la
  pantalla del operador, pero sí se distingue en la bitácora.

### La firma, que es donde se pierde una tarde

`base64( HEX( HMAC-SHA1(cadena, secreto) ) )` — base64 **del texto
hexadecimal**, no del digest binario. Viene de que el ejemplo oficial está en
PHP y `hash_hmac` devuelve hex por defecto. Con el binario no coincide nunca, y
el síntoma («Zadarma manda y FALCON rechaza todo») no se parece a la causa.

Y cada evento firma una cadena distinta, con tres campos pegados sin separador:

| Evento | Cadena firmada |
|---|---|
| `NOTIFY_START`, `NOTIFY_INTERNAL`, `NOTIFY_END`, `NOTIFY_IVR` | `caller_id` + `called_did` + `call_start` |
| `NOTIFY_ANSWER` | `caller_id` + **`destination`** + `call_start` |
| `NOTIFY_OUT_START`, `NOTIFY_OUT_END` | `internal` + `destination` + `call_start` |
| `NOTIFY_RECORD` | `pbx_call_id` + `call_id_with_rec` |

`NOTIFY_ANSWER` es el que se escapa: si se le copia la fila del primero, ese
evento —y solo ese— se rechaza siempre, y la llamada se queda sin saber quién
contestó. Hay una prueba por evento (`zadarma.firma.spec.ts`).
