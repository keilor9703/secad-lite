# Omnicanalidad en FALCON CAD

> **Qué es este documento.** Qué hace falta para que una emergencia llegue por
> donde el ciudadano quiera —teléfono, llamada de WhatsApp, chat de WhatsApp,
> web, entidad externa— y termine siempre en el mismo sitio: un caso, en la
> misma cola, con el mismo operador y el mismo expediente.
>
> Escrito el 20 de octubre de 2026 sobre el código, no de memoria. Lo que
> depende de un tercero está marcado como **[confirmar]**.

---

## 1. Dónde estamos hoy, de verdad

No partimos de cero. Esto es lo que ya funciona en producción:

| Canal | Entra por | Crea caso | Estado |
|---|---|---|---|
| **Llamada telefónica** | Troncal SIP → planta propia → `POST /api/pbx/webhook` | Al contestar | ✔ Probado de punta a punta |
| **Chat de WhatsApp (Meta directo)** | `POST /api/whatsapp/webhook` | **Con el primer mensaje** | ⚠ Funciona, pero sin filtro — ver §4 |
| **Chat de WhatsApp (por Infobip)** | `POST /api/whatsapp/infobip` | **Con el primer mensaje** | ⚠ Traductor hecho el 21/10/2026, pendiente de la primera entrega real |
| **Entidad externa** | `POST /api/integracion/casos` con `x-api-key` | Inmediato | ✔ |
| **Videollamada** | Enlace al ciudadano desde el caso | Sobre un caso ya abierto | ✔ |
| **Llamada de WhatsApp** | — | — | ✘ **No existe** |

Y una pieza que importa más de lo que parece: **el modelo de datos ya está
listo** para la llamada de WhatsApp. `OrigenLlamada` incluye
`whatsapp_llamada`, el webhook de la planta ya acepta un campo `origen`, y
`CANAL_DE_ORIGEN` ya traduce ese origen al canal del caso. Lo que falta no es
el modelo: es que alguien mande esa llamada.

---

## 2. La llamada de WhatsApp: no hay que integrarse con Meta

Esta es la decisión más importante del documento, y es la que cambia el
tamaño del trabajo de meses a días.

### Los dos caminos

**A. Directo contra Meta.** Meta ofrece la *WhatsApp Business Calling API*, y
admite configurar un servidor SIP propio: las llamadas llegarían directamente
a nuestro Asterisk. Suena ideal y **no lo es**, por tres razones concretas:

1. **Es Opus y solo Opus.** Las tres configuraciones de medios de Meta usan
   Opus. Nuestra planta hoy prohíbe Opus a propósito —`allow = ulaw,alaw`—
   porque el paquete de Asterisk de Ubuntu **no trae el codificador**, y
   ponerlo primero ya nos costó una noche de llamadas que se colgaban solas
   con `Unable to find a codec translation path`.
2. **Nuestro servidor es aarch64.** El módulo `codec_opus` que distribuye
   Sangoma se publica principalmente para x86_64. Conseguirlo o compilarlo
   para ARM es trabajo real, no una línea de configuración. **[confirmar]**
3. **Sin transcodificador, la grabación se rompe.** Opus puede pasar «de
   largo» entre WhatsApp y el navegador del operador —los dos lo hablan— pero
   `MixMonitor` tiene que **decodificar** para escribir el WAV. Una línea de
   emergencias sin grabación no es una opción.

A eso se suma que hay que mantener una lista de rangos IP de Meta en el
cortafuegos, que terceros reportan en más de mil rangos. **[confirmar]**

**B. Por Infobip, que ya es nuestro operador.** Infobip tiene WhatsApp
Business Calling desde julio de 2025 y, en su documentación, las llamadas de
un usuario de WhatsApp **se enrutan por troncal SIP a su SBC o PBX**.

Es decir: la llamada de WhatsApp entra por **la misma troncal que ya tenemos
funcionando** en Bogotá. Infobip transcodifica, así que nos sigue entregando
`ulaw` y no tocamos nada del audio. Y del lado de FALCON, la cola, la barra
CTI, la grabación, el desborde y el caso **ya funcionan**: una llamada es una
llamada.

### La recomendación

**Camino B.** El A solo tiene sentido el día que queramos independizarnos de
Infobip, y ese día hay que resolver antes el Opus y la grabación.

### Paso a paso

> **El trámite completo, desde cero y sin dar nada por sabido, está en
> [`whatsapp-alta-paso-a-paso.md`](whatsapp-alta-paso-a-paso.md).** Lo de aquí
> abajo es el resumen.

**Lo que se hace en Infobip** (el municipio, o nosotros con su cuenta):

1. **Tener el número de WhatsApp dado de alta como *sender*.** O el que la
   entidad ya usa, o uno nuevo. Si la línea de WhatsApp ya existe y está en
   otro proveedor, hay que migrar el *sender* a Infobip: es un trámite con
   Meta, no un cambio técnico nuestro.
2. **Verificación de la empresa en Meta** (Business Verification). Sin esto
   no hay llamadas en producción. Es el paso que más tarda: cuéntelo en
   semanas, no en días.
3. **Habilitar WhatsApp Business Calling** sobre ese *sender*.
4. **Crear la regla de enrutamiento** que manda las llamadas entrantes de
   WhatsApp a **nuestra troncal SIP** (`asterisk-falconcad`, la que ya
   apunta a `157.137.196.69`).
5. **Pedirles a qué número marcado va a llegar.** Esto es lo único que
   necesitamos saber: si la llamada de WhatsApp entra con un `To` distinto
   del DID de voz, el resto lo resolvemos nosotros. **[confirmar con
   Infobip]**

**Lo que hay que hacer en FALCON** (esto lo hago yo, con prueba):

6. **Un `origen` por número.** La tabla `pbx_numero` gana una columna que
   dice si lo que entra por ese número es una llamada telefónica o una
   llamada de WhatsApp. Es la pieza que falta, y es pequeña: el modelo ya
   sabe qué hacer con `whatsapp_llamada`.
7. **El dialplan manda el origen.** Hoy el aviso a FALCON dice
   `{"evento":"entrante","numero":"…"}`; pasará a decir también
   `"origen":"whatsapp_llamada"` cuando el número marcado sea el de WhatsApp.
8. **La pantalla ya lo enseña.** La barra CTI y la cola ya distinguen el
   origen con su propio icono, y el caso nace con canal «Llamada de
   WhatsApp» sin que el operador tenga que acordarse de cambiarlo.

**Lo que hay que probar, en este orden** (es el método de la §11 del manual
de despliegue):

9. `tcpdump` en el 5060 filtrando por las redes del SBC: ¿llega el `INVITE`?
10. `pjsip show endpoints`: ¿lo reconoce el `identify`, o responde 403?
11. Que timbre en la cola y que el operador conteste desde la barra.
12. **Audio en los dos sentidos**, que es donde se cae todo lo que parece
    funcionar. El orden de diagnóstico está en el manual, §11.
13. Que el caso nazca con canal «Llamada de WhatsApp» y que la grabación se
    suba al caso.

> **Lo que NO hay que hacer:** dar por buena la llamada porque «entró». Entrar
> y oírse son dos cosas distintas, y confundirlas nos costó el 19 de octubre.

---

## 3. El costo, para que no sorprenda

Una llamada de WhatsApp **es gratis para el ciudadano** —va por datos— y eso
es exactamente lo que la hace valiosa para una línea de emergencias: alguien
sin minutos puede pedir ayuda. Para la entidad tiene tarifa de Infobip, que
depende del país y del volumen. **[confirmar: pedir la tarifa por minuto de
WhatsApp Calling para Colombia antes de prometerle nada a la alcaldía.]**

---

## 4. El filtro de mensajes: el problema de verdad

Hoy **cada mensaje de WhatsApp que llega crea o continúa un caso**. Para una
línea de atención eso es insostenible, y conviene decir por qué con nombres
propios: una línea de emergencias publicada recibe «hola», «buenos días»,
stickers, números equivocados, cadenas reenviadas y gente probando si
contesta un robot. Cada uno de esos es hoy un caso en la bandeja de
Recepción, compitiendo por atención con una emergencia real.

**Esto no es un detalle de usabilidad: es el riesgo operativo más grande de
abrir el canal.**

### Lo que hay que construir

**4.1. Un paso previo al caso.** Un mensaje entrante no nace como caso: nace
como **conversación**. El caso se crea cuando se cumple una condición, y la
condición la decide el municipio, no el código.

**4.2. Un menú de entrada.** Lo primero que recibe el ciudadano es una
respuesta automática con opciones (botones de WhatsApp, que ya soportamos
leer: el servicio entiende `interactive` y `button`):

> *Línea de emergencias del municipio. ¿Qué necesita?*
> `1` Reportar una emergencia · `2` Hablar con un operador · `3` Información

Solo `1` y `2` abren caso. El `3` contesta y cierra. Lo que no corresponde a
ninguna opción se vuelve a preguntar una vez y, si sigue sin encajar, se
responde con el número de la línea telefónica y se cierra.

**Por qué un menú y no un clasificador automático:** porque en una línea de
emergencias un falso negativo —descartar una emergencia real por mal
redactada— es inaceptable, y ningún clasificador da garantías sobre eso. El
menú traslada la decisión al ciudadano, que es quien sabe.

**4.3. Reglas por instancia, configurables.** Igual que los catálogos:
palabras que siempre abren caso (`incendio`, `me van a matar`, `ayuda`),
remitentes bloqueados, horarios. En pantalla, no en el código.

**4.4. Lo que llega y no es texto.** Hoy solo se leen `text`, `button` e
`interactive`. Una emergencia por WhatsApp llega muchas veces como **audio,
foto o ubicación**, y hoy eso se pierde:

- **Ubicación** — es el dato más valioso que existe para un CAD, y WhatsApp
  lo manda con un toque. Debe caer directo en las coordenadas del caso.
- **Audio** — hay que guardarlo y adjuntarlo al caso; alguien que se esconde
  de un agresor manda una nota de voz, no escribe.
- **Foto y video** — al expediente.
- **Documento** — al expediente.

**4.5. La ventana de 24 horas.** WhatsApp solo deja responder libremente
dentro de las 24 horas desde el último mensaje del ciudadano; fuera de eso
hay que usar una plantilla aprobada. Hoy FALCON no lo sabe, así que un
operador que responde a las 30 horas **cree que respondió y no respondió**.
Hay que mostrar el reloj en la pantalla del caso y tener plantillas
aprobadas. **[confirmar la política vigente de Meta antes de implementarlo.]**

---

## 5. Lo que se le escapa: el resto de la omnicanalidad

Lo pidió explícitamente, así que esto es la lista honesta, no la cómoda.

### 5.1. Un caso, no cinco

Si el ciudadano llama, le cuelgan, escribe por WhatsApp y después vuelve a
llamar, hoy eso son **tres casos distintos**. Para despacho eso es grave: tres
registros de la misma emergencia pueden mandar tres patrullas o, peor, hacer
que cada operador crea que otro ya lo atendió.

Hace falta **unir por abonado y ventana de tiempo**: un contacto que vuelve en
los siguientes N minutos entra al caso abierto, no a uno nuevo. Con la
decisión visible y reversible, porque dos emergencias distintas desde el mismo
teléfono existen.

### 5.2. Una sola cola

Hoy las llamadas están en la cola del teléfono y los chats están en la
bandeja de casos. Son **dos sitios distintos**, y el operador tiene que mirar
los dos. La omnicanalidad de verdad es una sola bandeja de trabajo pendiente,
ordenada por urgencia y antigüedad, sin que importe por dónde entró.

### 5.3. Reparto entre canales

Un operador puede estar en una llamada **y** con tres chats a la vez, pero no
en dos llamadas. Hoy no hay nada que lo sepa: nadie reparte los chats, se los
lleva quien los vea. Hace falta un reparto con capacidad por canal.

### 5.4. La identidad del ciudadano

El mismo teléfono es la misma persona por voz y por WhatsApp, pero hoy no hay
una ficha de contacto que lo sepa. Sin eso no hay historial —«este número
llamó tres veces este mes»— que es justo lo que distingue una emergencia de
un reincidente.

### 5.5. Los canales que faltan

| Canal | Qué haría falta | Prioridad |
|---|---|---|
| **Chat web** en la página del municipio | Ya existe el módulo de chat; falta el widget público | Media |
| **SMS** | Ya hay módulo; falta entrada bidireccional | Baja |
| **Correo** | Buzón → caso | Baja |
| **Redes sociales** | Mensajería de Facebook/Instagram por la misma Cloud API | Baja |
| **Botón de pánico** (app ciudadana) | Lo más valioso que no tenemos: ubicación exacta y sin hablar | **Alta** |

### 5.6. Lo que hay que medir

Si se abre un canal y no se mide, no se sabe si sirve. Por canal: cuántos
entraron, cuántos se atendieron, en cuánto tiempo, cuántos se abandonaron. Lo
que hoy existe mide llamadas; hay que extenderlo.

### 5.7. Accesibilidad, que en una línea de emergencias no es opcional

El canal de texto es **el único** por el que una persona sorda puede pedir
ayuda. Eso cambia la prioridad del chat de WhatsApp: no es un canal cómodo,
es un canal de acceso. Y obliga a un compromiso de tiempo de respuesta por
escrito, no «cuando alguien lo vea».

---

## 6. El orden en que yo lo haría

1. **El filtro de mensajes (§4.1–4.3).** Es lo que hoy está roto y lo que
   hace inviable abrir el canal. No depende de nadie.
2. **Ubicación, audio y adjuntos de WhatsApp (§4.4).** Barato y es lo que
   convierte un chat en un reporte útil.
3. **La llamada de WhatsApp (§2).** El trámite con Infobip y Meta corre en
   paralelo porque tarda; el código nuestro es pequeño.
4. **Un caso, no cinco (§5.1).** En cuanto haya dos canales vivos, esto
   empieza a doler.
5. **Una sola cola (§5.2) y el reparto (§5.3).**
6. La ventana de 24 horas, las métricas, y el resto.

Lo que **no** haría todavía: integrarse directo con Meta para la voz, y abrir
más canales antes de que el filtro y la unificación de casos estén hechos.
Abrir un canal nuevo sin eso no es omnicanalidad, es multiplicar la bandeja.

---

## Fuentes consultadas

- [WhatsApp Business Calling — escenarios soportados (Infobip)](https://www.infobip.com/docs/whatsapp/whatsapp-business-calling/supported-calling-scenarios)
- [Infobip lleva las llamadas de voz a WhatsApp Business](https://www.infobip.com/news/infobip-brings-voice-calling-whatsapp)
- [Calling — WhatsApp Cloud API (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/calling/)
- [SIP Configuration Guide — WhatsApp Business Calling (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/sip/)
- [WhatsApp SIP Calling Integration (3CX)](https://www.3cx.com/docs/whatsapp-sip-calling-integration/)

Las dos páginas de Meta no se pudieron abrir desde el entorno de trabajo; lo
que se afirma de ellas viene de los resúmenes del buscador y de guías de
terceros, y por eso los puntos técnicos de la §2.A están marcados
**[confirmar]**.
