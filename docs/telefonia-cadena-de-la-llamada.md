# La cadena de una llamada al 123, eslabón por eslabón

Qué pasa entre que un ciudadano marca y que el caso aparece en FALCON, quién
es dueño de cada tramo, y qué haría falta para dejar de depender de un tercero.

> Estado: **documento de análisis, ninguna decisión tomada**. Escrito para
> entender el ecosistema antes de negociar con nadie. Las cifras de Infobip
> son de su calculadora pública y hay que confirmarlas con una cotización;
> lo regulatorio está citado pero **no sustituye un concepto jurídico**.
>
> Fecha: 14 de octubre de 2026.

---

## 1. La cadena

Diez eslabones. FALCON solo toca los dos últimos.

```
 1. Ciudadano marca 123
        │
 2. Su operador (Claro, Movistar, Tigo, WOM…) TRADUCE el 123
        │          ← aquí está la llave de todo (§2)
 3. …a un número E.164 que la entidad del CAE declaró
        │
 4. Ese número TERMINA en una troncal SIP           ← hoy: YACO
        │
 5. SBC / PBX: recibe, autentica, aplica IVR        ← hoy: YACO
        │
 6. ACD: encola y reparte entre operadores libres   ← hoy: YACO
        │
 7. El agente contesta                              ← AHORA: FALCON (16/10/2026)
        │
 8. Grabación: audio, almacenamiento, URL firmada   ← hoy: YACO
        │
 9. CTI: empuja el evento a FALCON  ─────────────────→ POST /api/pbx/webhook
        │                                              POST /api/cti/eventos/interaccion
10. FALCON: screen-pop, caso, despacho             ← FALCON
            + consulta aparte al proveedor de ELS  ─→ GET /api/els/ubicacion
```

**FALCON hace hoy los eslabones 7, 9 y 10.** El 7 es nuevo: la barra propia
se registra como una extensión SIP por WebSocket y contesta la llamada dentro
del navegador, con audio en los dos sentidos. Está probado contra un proveedor
real (Zadarma) — ver [`telefonia-zadarma.md`](telefonia-zadarma.md). Eso es lo
que **elimina la necesidad de la barra CTI de un tercero**, que era el eslabón
que no se podía comprar suelto.

**Y lo que FALCON NO es, para no confundirse:**

- **FALCON no es una centralita.** No recibe la troncal, no autentica al
  operador telefónico, no decide qué extensión timbra, no hace IVR, no graba.
- **La «cola» de Recepción no es un ACD.** Es la lista en pantalla de lo que
  la centralita ya decidió; el reparto lo hace la centralita, no FALCON.
- **FALCON no transporta el audio de la troncal.** El audio va del proveedor
  al navegador del operador; FALCON pone la pantalla y la aplicación.

Dicho al revés, que es como se vende: **FALCON es el CAD y el teléfono del
operador. Falta quien traiga la llamada y quien la reparta.**

---

## 2. El 123 no se arrienda. Esto cambia la conversación

Es lo que más cuesta ver desde afuera, y es lo que decide si se puede o no
dejar a YACO.

La Resolución CRC 5050 de 2016 dice dos cosas que hay que leer juntas:

1. Los números 1XY **«no se pueden entender como asignados a una empresa o
   entidad prestadora de un servicio o a un PRST en particular»**. El 123 es
   *el número único nacional de emergencias*. Nadie lo posee.
2. Lo que sí existe es un **número de enrutamiento**: cada PRST debe reportar
   «el número geográfico o no geográfico E.164 al que el PRST ha programado el
   enrutamiento para cada número 1XY, en el área delimitada». El Administrador
   de los Recursos de Identificación registra esos números en una base
   centralizada y se los comunica a los PRST. Cuando la entidad de un Centro
   de Atención de Emergencias lo solicita, la CRC informa a los operadores de
   la zona para que inicien el enrutamiento **dentro de los 30 días calendario
   siguientes**.

Puesto en claro:

> El 123 del municipio no es de YACO. Es del **municipio** (la entidad del
> CAE). Lo que YACO controla es **el número E.164 de destino al que hoy
> apunta ese enrutamiento**.

Eso es muy distinto de lo que parece desde la factura, y tiene dos
consecuencias prácticas:

- **Sí se puede cambiar de proveedor sin perder el 123.** El camino es que el
  municipio solicite el cambio del número de enrutamiento. No es un trámite
  de FALCON ni de Infobip: es del municipio, y tarda unos 30 días en quedar
  programado en los operadores.
- **El riesgo de quedar amarrado no es técnico, es de titularidad.** Si el
  número E.164 que hoy recibe el 123 está a nombre de YACO, mudarse implica
  un número nuevo y un cambio de enrutamiento. Si estuviera a nombre del
  municipio, bastaría repuntarlo. **Hay que averiguar a nombre de quién está
  hoy.** Es la primera pregunta que yo haría, antes que cualquier cotización.

---

## 3. Qué vende YACO realmente

Separado, porque se suele comprar como un paquete y se paga como un paquete:

| | Qué es | ¿Lo reemplaza Infobip? |
|---|---|---|
| **a. El número E.164** de destino del 123 | un DID geográfico | **Sí**, si tiene cobertura en el indicativo del municipio (confirmar) |
| **b. Los canales** (llamadas simultáneas) | troncal SIP | **Sí** |
| **c. El SBC/PBX** | recibe, autentica, IVR | **No.** Infobip conecta *a* su PBX; el PBX lo pone usted |
| **d. El ACD** | cola y reparto entre operadores | **No directamente.** Con Calls API y Call Routing se construye; no se configura |
| **e. La grabación** con almacenamiento, URL y **firma digital** | | **No evidente.** Hay que preguntarlo explícitamente |
| **f. La barra CTI** embebida en FALCON | el softphone del agente | **No.** Habría que construirla |
| **g. Transcripción y resumen** | | parcial |

Esa tabla es la respuesta a su pregunta de si está pasando algo por alto.
**Sí: Infobip es el transportista, no la central.** Vende los eslabones 3 y 4
de la cadena. Los eslabones 5, 6, 8 y la barra del 9 —que es donde está el
trabajo de verdad— hoy los hace YACO, y si se los quita a YACO alguien tiene
que hacerlos. Ese alguien sería FALCON.

Su propia documentación de troncales lo dice sin rodeos: para usar SIP
trunking «necesita un PBX basado en IP, que gestiona las llamadas internas y
externas, **o un SBC** que actúe como cortafuegos entre su red interna e
internet». Infobip entrega la llamada en la puerta; lo que pasa adentro es
suyo.

---

## 4. Los US$ 9,39 no son el precio. Son una parte del precio

Esto hay que decirlo claro porque la calculadora induce a error.

**Lo que cuesta un canal no es lo que cuesta la llamada.** La documentación de
Infobip es explícita: «The voice traffic (between Infobip and the telco
operators) **is billed by usage**, regardless of the destination or
origination». El plan medido cobra el canal *más* el tráfico. El plan
ilimitado sin cobro por uso es **solo para tráfico doméstico de Estados
Unidos**; cualquier tráfico desde o hacia otros países se factura por consumo.

Y un canal es **una llamada simultánea**, no un operador: «a 10-channel trunk
means 10 concurrent calls can take place at any moment… Calls submitted to the
trunk when the trunk has reached its channel capacity **will be rejected**».

Para dimensionar un municipio con 20–30 operadores:

- Los canales tienen que cubrir las llamadas **en conversación más las que
  están en cola**. Con 30 puestos ocupados y cola, no son 30 canales: son
  40–50, y quedarse corto no degrada el servicio, **rechaza la llamada**. En
  una línea de emergencias eso no es una métrica de calidad, es un incidente.
- A US$ 9,39 el canal, 45 canales son **~US$ 420/mes solo en capacidad**,
  antes del primer minuto, del arriendo del DID y del tráfico.
- Además, la captura que me compartió dice **«Rest of the world»** como país
  de destino. La tarifa de Colombia hay que sacarla seleccionando Colombia.

Nada de esto hace inviable el negocio —200 millones de COP anuales dan
holgura—, pero el número de partida no es 9,39: es *canales × tarifa +
minutos + DID + lo que cueste construir y operar los eslabones 5, 6 y 8*.

---

## 5. El requisito técnico que hoy no se cumple

De la documentación de troncales estáticas de Infobip, y es tajante:

> Las IP deben ser **públicamente enrutables** (no detrás de NAT ni en
> subredes privadas) y **asignadas en exclusiva** a su infraestructura, no
> compartidas con otros clientes. Infobip no admite SBC o PBX alojados en
> entornos compartidos donde las IP puedan asignarse dinámicamente o ser
> usadas por varios inquilinos.

La VM de OCI donde corre FALCON puede tener IP pública dedicada, pero **no hay
SBC ni PBX**. Montar telefonía propia significa, como mínimo:

- Un SBC (Kamailio, OpenSIPS) o un PBX con SBC (FreeSWITCH, Asterisk).
- Un ACD de verdad: colas, habilidades, prioridad, desbordes, supervisión.
- Grabación con retención, cifrado en reposo y la firma digital que pide la
  ficha técnica.
- ~~Un softphone WebRTC para el agente, integrado en FALCON.~~ **HECHO**
  (16/10/2026): la barra se registra por SIP sobre WebSocket y contesta en el
  navegador, probada contra un proveedor real.
- Y la parte que nadie presupuesta: **operarlo 24/7**. Un CAD que se cae
  molesta; una central de 123 que se cae es otra cosa.

### 5.1 Entonces, ¿qué falta COMPRAR?

Dos cosas, y se pueden comprar juntas a un solo proveedor colombiano:

| Falta | Eslabones | Qué se pide en el mercado |
|---|---|---|
| **Quien trae la llamada** | 3 y 4 | *Troncal SIP* + el número E.164 de enrutamiento del 123 |
| **Quien la recibe y la reparte** | 5, 6 y 8 | *Centralita en la nube* (PBX + ACD + grabación), o *contact center como servicio* |

**El requisito que decide todo, y que hay que preguntar primero:** que esa
centralita permita que **el navegador del operador se registre como extensión
SIP por WebSocket (WSS)**. Si lo permite, la barra de FALCON contesta y **no
hace falta la barra CTI de nadie**. Si no lo permite, hay dos salidas: que el
proveedor entregue la troncal a una **centralita propia** (Asterisk,
FreeSWITCH) puesta en Colombia, que sí habla WSS, o volver a depender de la
barra del tercero — que es justamente lo que se quiere evitar.

Zadarma sirvió para demostrar que el camino existe: acepta WSS con la clave
SIP de la extensión, y con eso se construyó y se probó toda la barra. Lo que
no sirve es para el 123, por región y por contratación (§9).

### 5.2 Lo que hay que pedirle a cada proveedor, literal

Para mandar por correo tal cual, a un operador colombiano o a un ITSP:

> Operamos un software propio de despacho de emergencias. **No necesitamos su
> barra de agente ni su CRM**: el operador contesta dentro de nuestra
> aplicación web. Necesitamos de ustedes:
>
> 1. **Troncal SIP** con *N* canales simultáneos, y el número E.164 al que el
>    municipio enruta su 1XY.
> 2. **Centralita en la nube** con cola/ACD que reparta entre extensiones.
> 3. Que cada operador pueda registrarse como **extensión SIP sobre WebSocket
>    (WSS)** desde el navegador. ¿Cuál es la dirección `wss://` y sirve la
>    clave SIP de la extensión?
> 4. **Eventos de llamada por webhook** (timbra, contesta, cuelga) con el
>    número de quien llama y un identificador único de llamada. ¿Cómo se firma
>    el webhook?
> 5. **API para originar una llamada** desde la extensión de un operador.
> 6. **Grabación** con almacenamiento, descarga por API y firma digital.
> 7. Infraestructura **en Colombia**, contrato en español, factura
>    electrónica DIAN y SLA.
>
> Los puntos 3 y 4 son los que deciden: sin ellos tendríamos que poner una
> centralita propia delante de su troncal.

Con esas respuestas, dar de alta al proveedor en FALCON es escribir un archivo
en `pbx/proveedores/` y registrarlo — ver
[`telefonia-proveedores.md`](telefonia-proveedores.md).

---

## 6. Lo regulatorio, con lo que verifiqué y lo que no

**Verificado** (Resolución CRC 5050 de 2016, vía normogramas oficiales):

- Los 1XY se asignan a servicios semiautomáticos y especiales, y no a una
  empresa ni a un PRST.
- El mecanismo de los números de enrutamiento E.164 y la base centralizada.
- Los 30 días calendario para que los operadores programen el enrutamiento
  tras la comunicación de la CRC.

**Verificado** (Ley 1341 de 2009, modificada por la Ley 1978 de 2019):

- Existe el **Registro Único de TIC (RUTIC)** y los proveedores de redes y
  servicios **deben inscribirse antes de iniciar operaciones**; no hacerlo
  acarrea sanciones. El MinTIC verifica dentro de los diez días hábiles
  siguientes.

**NO verificado, y es exactamente lo que hay que preguntarle a un abogado de
telecomunicaciones antes de firmar nada:**

1. **¿Operar la troncal del 123 de un municipio convierte a FALCON en PRST?**
   Si FALCON solo *consume* el servicio de un PRST habilitado, probablemente
   no. Si lo *revende* a municipios, la respuesta puede cambiar, y entonces
   hace falta RUTIC. No es una pregunta técnica y no la voy a contestar yo.
2. **¿Infobip está habilitado en Colombia** para el tipo de numeración que
   recibe tráfico de un 1XY? Su documentación menciona un SBC en Bogotá, pero
   «tiene un centro de datos en Bogotá» y «puede recibir el enrutamiento de un
   123» no son lo mismo.
3. **Obligaciones de disponibilidad y continuidad** para servicios de
   emergencia. Hay regulación sobre esto y no la revisé.
4. **Retención y tratamiento de las grabaciones**: Ley 1581 de 2012, más lo
   que exija el municipio. Hoy eso lo asume YACO; si se lo lleva FALCON, se
   lleva también la responsabilidad.
5. **El ELS.** FALCON consulta la ubicación del llamante a un proveedor
   configurado (`els/els.service.ts`, con `clienteId` y `clienteSecreto`). Esa
   ubicación sale de los operadores móviles y su acceso está regulado. Hay que
   confirmar si ese contrato va con YACO o es independiente — si va con YACO,
   mudarse de telefonía puede dejar a los operadores sin la ubicación
   automática, que es de lo más útil que tiene el sistema.

---

## 7. Lo que yo haría, en este orden

No es «cambiar a Infobip» o «quedarse con YACO». Es desenredar el paquete.

**Paso 0 — la pregunta que vale más que cualquier cotización.**
¿A nombre de quién está el número E.164 al que hoy se enruta el 123 del
municipio? Si está a nombre del municipio, usted tiene toda la palanca. Si
está a nombre de YACO, el costo de salida es un cambio de enrutamiento y 30
días. Esto se pregunta al municipio y se verifica con el Administrador de los
Recursos de Identificación.

**Paso 1 — lo que no tiene riesgo y ahorra ya.**
Mover SMS, WhatsApp y correo transaccional a Infobip. SMS ya está: el
remitente de Infobip existe en `backend/src/sms/infobip.remitente.ts` y el
proveedor se resuelve en cada envío leyendo `config_sms`, así que se cambia
desde Plataforma sin redespliegue. **Esto no toca la llamada y no toca el
123.** Y si el correo le sale en US$ 9 por diez mil, también saca a Brevo de
la ecuación y queda un proveedor menos que administrar.

**Paso 2 — construir en paralelo, sin tráfico real.**
Una troncal Infobip de pocos canales, un DID de prueba, un SBC+ACD propio en
una máquina aparte, y el softphone WebRTC dentro de FALCON. Medir: latencia de
establecimiento, calidad con G.711, comportamiento al desbordar canales,
grabación. Nada de esto toca producción.

**Paso 3 — tráfico real controlado.**
Una línea secundaria del municipio (no el 123) enrutada a la troncal nueva.
Un mes. Si aguanta un mes de tráfico real con una línea que importa poco, es
candidato para una que importa mucho.

**Paso 4 — el 123.**
Solo entonces, y con el municipio pidiendo el cambio de número de
enrutamiento. Con plan de vuelta atrás: el enrutamiento anterior se puede
restablecer, pero tarda, así que la ventana de riesgo es de días, no de
minutos.

---

## 8. Una opinión, por si sirve

Infobip como **transportista** es una idea sólida: tarifas de mayorista,
cobertura, y usted deja de pagar el margen de un intermediario sobre algo que
es commodity.

Infobip como **central** es otra cosa. Lo que YACO cobra caro no es el minuto:
es el SBC, el ACD, la grabación firmada y la barra CTI, operados 24/7 por
alguien que responde cuando se cae. Si FALCON se lo lleva, se lleva el margen
**y la guardia**. Eso puede ser exactamente lo que usted quiere —convierte a
FALCON en una plataforma completa y es muy defendible en una venta— pero es
una decisión de producto y de equipo, no una de proveedor.

Mi sospecha, y es solo eso: YACO probablemente también compra el transporte a
un mayorista. Si es así, el margen que usted recupera cambiando de
transportista es real, pero el trabajo que YACO hace encima también es real, y
hay que presupuestarlo antes de decidir que sale más barato.

---

## 9. Zadarma, y por qué la comparación por precio del DID engaña

Apareció en una tabla comparativa como «planta gratis hasta 30 extensiones, DID
Colombia ~2–3 USD/mes». Lo primero, el dato está mal: **Zadarma publica 12 USD
de conexión y entre 12 y 18 USD al mes** para los fijos de Bogotá o Medellín
(Pereira y el nacional 030, 14 USD/mes). Son cuatro a seis veces lo que decía la
tabla. Sigue siendo barato; lo que importa es que la cifra no estaba verificada.

Lo segundo, y más importante: **comparar proveedores por el precio del DID es
comparar por el eslabón equivocado**. Los que deciden son otros tres.

### Qué cubre de verdad, contra la cadena del punto 1

Aquí Zadarma gana a Infobip, y hay que decirlo:

| Eslabón | Infobip | Zadarma |
|---|---|---|
| 3–4 · número y canales | sí | sí |
| 5 · SBC/PBX | **no**, lo pone usted | **sí, es su producto** |
| 6 · ACD y colas | se construye con Calls API | **sí, incluido** |
| 8 · grabación | no evidente | sí, con API de descarga |
| 9 · CTI hacia FALCON | — | API propia |

Esa es su virtud real: es «la planta lista», y evita el proyecto de montar y
operar un SBC más un ACD, que es lo que hoy justifica la factura de YACO. Para
una empresa de veinte personas es una opción excelente.

### Las tres razones por las que no la pondría en un 123

**Sin residencia de datos en Colombia.** Zadarma tiene oficinas en Bulgaria,
Reino Unido, Polonia y España, y seis centros de datos en tres continentes; el
más reciente, en Madrid. Ninguno en Colombia. Eso significa que el audio de cada
llamada al 123 —y su grabación— saldría del país. Es exactamente la objeción que
usted mismo planteó para la mesa de ayuda, y una grabación del 123 es bastante
más sensible que un ticket de soporte. Súmele la latencia: un audio que va y
vuelve a Europa no es gratis en una emergencia.

**El plan gratuito no es gratuito para este caso.** Las 30 extensiones sí son
gratis, pero la grabación lo es solo para tres o cinco extensiones —las fuentes
oficiales se contradicen— y después cuesta unos 2 USD por extensión al mes. En un
123 **toda** llamada se graba, así que con 20 o 30 operadores eso es un costo por
puesto, no una función incluida. Y el espacio gratuito que se menciona (unos 200
MB) no sostiene ni un día de grabaciones con la retención que pide un municipio.
Que las propias páginas de ayuda se contradigan sobre qué trae el plan gratuito
ya es, por sí solo, un motivo para no construir un contrato municipal encima.

**Sin compromiso de disponibilidad.** Un plan gratuito no trae SLA. Que se caiga
el CAD molesta; que se caiga el 123 es otra cosa, y es la pregunta que un
municipio hace por escrito.

### Lo que no verifiqué, y decide

Si una numeración de Zadarma en Bogotá **puede ser el número E.164 al que los
operadores enrutan el 123**. No es una pregunta técnica sino regulatoria, y la
contesta el Administrador de los Recursos de Identificación, no una página de
tarifas. Mientras no esté contestada, todo lo demás es teórico.

### Para qué sí la usaría

Como **banco de pruebas**, y es un uso muy bueno: por 12 USD al mes y una planta
gratuita se puede montar el paso 2 del plan —probar el softphone WebRTC dentro de
FALCON, el webhook de CTI, la grabación y su descarga por API— sin construir nada
ni comprometer nada. También para la línea propia de FALCON como empresa, o para
una línea administrativa secundaria del municipio.

Lo que no haría es pasar de ahí al 123 saltándose los pasos 3 y 4.
