# Zadarma en FALCON CAD

Cómo se conecta la centralita de Zadarma, qué está hecho, qué falta, y qué hay
que tocar en su panel.

> **Para qué sí, y para qué todavía no.** Esto convierte a Zadarma en la planta
> telefónica de una instancia de FALCON: las llamadas entran a la cola de
> Recepción, se dirigen al operador que tiene esa extensión y quedan en el
> registro. Es exactamente el banco de pruebas que recomienda
> [`telefonia-cadena-de-la-llamada.md`](telefonia-cadena-de-la-llamada.md) §9 —
> y las dos objeciones de ese documento siguen en pie para un 123 de verdad:
> **no hay residencia de datos en Colombia** (el audio y las grabaciones salen
> del país) y **nadie ha confirmado que una numeración de Zadarma pueda ser el
> número E.164 al que los operadores enrutan el 123**. Para una línea
> administrativa, para la línea propia de FALCON y para probar toda la cadena,
> sirve hoy.

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
  | `NOTIFY_END` | Cierra la llamada. Si la central dice `answered`, **no** se cuenta como perdida |
  | `NOTIFY_OUT_*` | Saliente: queda en la bitácora, no entra a la cola |
  | `NOTIFY_RECORD` | Todavía no se usa (ver *Lo que falta*) |

- Configuración por instancia en `config_pbx`, con el secreto **cifrado**.
- **Dos interruptores**, como las demás integraciones:
  - la integración `pbx` del tenant: si no la tiene, no hay telefonía;
  - `activo` en `config_pbx`: la hay, pero esta planta está apagada ahora mismo.
    Lo que llegue se anota en la bitácora y no toca la cola.

Sin fila en `config_pbx`, una instancia sigue funcionando como siempre con el
webhook genérico de YACO. Esto no puede romper lo que ya opera.

---

## 3. Qué hay que hacer en el panel de Zadarma

### 3.1 Antes de empezar: qué debe estar listo

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

### 3.2 El webhook

1. Entre a <https://my.zadarma.com/api/> y abra la pestaña de **integraciones
   / CRM** (la que en la documentación aparece como `#apitab-zcrm`).
2. En la dirección del webhook pegue, **con la llave de la instancia al final**:

   ```
   https://falconcad.com.co/api/pbx/zadarma/<API_KEY_DE_LA_INSTANCIA>
   ```

   La API key es la que ya existe para el webhook de la planta — en FALCON,
   *Administración → la instancia*. Si no la tiene a mano, rótela y copie la
   nueva (se muestra una sola vez).
3. Marque los eventos: **NOTIFY_START, NOTIFY_INTERNAL, NOTIFY_ANSWER,
   NOTIFY_END**. Los demás pueden quedar marcados: FALCON los acepta y los
   ignora sin quejarse.
4. Guarde. Zadarma va a llamar a esa dirección con un `zd_echo` para
   comprobar que es suya; FALCON lo devuelve tal cual.

**Si dice que la URL no es válida**, compruébelo usted mismo antes de pelear
con el panel:

```bash
curl "https://falconcad.com.co/api/pbx/zadarma/<API_KEY>?zd_echo=prueba123"
# tiene que imprimir exactamente:  prueba123
```

Si imprime otra cosa —comillas, un JSON, un espacio— el panel lo rechaza. Si no
imprime nada, el problema es de red o de nginx, no de FALCON.

### 3.3 Las llaves, en FALCON

Con el superadmin:

```bash
curl -X POST https://falconcad.com.co/api/plataforma/pbx \
  -H "authorization: Bearer <TOKEN>" -H 'content-type: application/json' \
  -d '{"tenant":"63001","proveedor":"ZADARMA","activo":true,
       "zadarmaKey":"<KEY>","zadarmaSecreto":"<SECRET>","numeroEntrante":"+576012345678"}'
```

El secreto se guarda cifrado y no vuelve a salir: la respuesta solo dice si
está puesto. Activar Zadarma **sin** secreto se rechaza a propósito — sin él no
se puede verificar nada de lo que llegue, y aceptar sin verificar es peor que
no tener la integración.

> La pantalla para hacer esto desde *Plataforma*, en lugar de con `curl`, es lo
> siguiente que falta.

### 3.4 Las extensiones, con su dueño

En FALCON, *Administración → Usuarios*, columna **Extensión PBX**: cada
operador lleva el número de su extensión de Zadarma (101, 102, 103). Sin eso la
llamada entra a la cola pero no se le anuncia a nadie en particular — funciona,
pero pierde la mitad de la gracia.

### 3.5 Comprobar que llegó

Llame al número desde un celular y mire, en este orden:

1. La llamada aparece en la cola de *Recepción* mientras suena.
2. Al sonar la extensión, el aviso se dirige a ese operador.
3. Al colgar, queda en el registro con su duración.

Si no aparece, el rastro está en la base, no en los logs del proceso:

```sql
SELECT "creadoEn", exitoso, "estadoHttp", left(motivo, 80) AS motivo, left(cuerpo, 200)
FROM pbx_webhook_log ORDER BY "creadoEn" DESC LIMIT 10;
```

| Lo que dice `motivo` | Qué pasó |
|---|---|
| `Llave de instancia desconocida` | La API key de la URL no es la de ninguna instancia |
| `El módulo de pbx no está habilitado` | A la instancia le falta la integración `pbx` |
| `Esta instancia no tiene Zadarma…` | Falta `config_pbx`, o el proveedor quedó en `YACO` |
| `…está apagada para esta instancia` | `activo = false`; es a propósito |
| `La firma no corresponde…` | El secreto guardado no es el de esa cuenta de Zadarma |
| *(ninguno, `exitoso = true`)* | Llegó y se procesó |

Si no hay NINGUNA fila, la petición no llegó: es Zadarma, el DNS o nginx.

---

## 4. Lo que falta, en orden

1. **La pantalla de configuración en Plataforma.** Hoy se hace con `curl`.
2. **Contestar dentro de FALCON (WebRTC).** Es lo que convierte esto en un CAD
   de verdad: el operador descuelga en la misma pantalla donde escribe el caso,
   sin alternar con MicroSIP. Zadarma tiene widget propio; hay que decidir si se
   usa el suyo o su SIP sobre WebSocket con un softphone propio, porque de eso
   depende cuánto del audio pasa por su interfaz.
3. **La grabación al caso.** `NOTIFY_RECORD` avisa que está lista; se pide con
   `/v1/pbx/record/request/` (hay que esperar unos segundos: justo después del
   aviso, el archivo todavía no está) y se guarda como adjunto del caso, con la
   misma política de retención que el video.
4. **Llamada saliente desde el caso.** `/v1/request/callback/`: FALCON pide a la
   centralita que llame primero al operador y después al ciudadano.
5. **El número de verdad.** Las dos preguntas abiertas del documento de
   telefonía: residencia de datos y enrutamiento del 1XY.

---

## 5. Dónde vive

| Pieza | Archivo |
|---|---|
| Verificación de la firma | `backend/src/pbx/zadarma/zadarma.firma.ts` |
| Traducción de eventos | `backend/src/pbx/zadarma/zadarma.service.ts` |
| Endpoint del webhook | `backend/src/pbx/zadarma/zadarma.controller.ts` |
| Configuración por instancia | `backend/src/pbx/config-pbx.entity.ts`, `pbx-config.service.ts` |
| Cola, casos y avisos (comunes a las dos plantas) | `backend/src/pbx/pbx.service.ts` |

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
