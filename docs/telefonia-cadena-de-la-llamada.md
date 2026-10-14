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
 7. El agente contesta (softphone / WebRTC / teléfono)
        │
 8. Grabación: audio, almacenamiento, URL firmada   ← hoy: YACO
        │
 9. CTI: empuja el evento a FALCON  ─────────────────→ POST /api/pbx/webhook
        │                                              POST /api/cti/eventos/interaccion
10. FALCON: screen-pop, caso, despacho
            + consulta aparte al proveedor de ELS  ─→ GET /api/els/ubicacion
```

**Lo que FALCON hace hoy es el eslabón 10, y nada más.** No habla SIP, no
transporta audio, no graba. Recibe un webhook con el ANI, el identificador de
interacción, el operador del ACD y la fecha; con eso abre el formulario. Eso
no es una limitación: es lo que hace que cambiar de proveedor de telefonía
sea un cambio de quien empuja el webhook, no una reescritura.

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
- Un softphone WebRTC para el agente, integrado en FALCON.
- Y la parte que nadie presupuesta: **operarlo 24/7**. Un CAD que se cae
  molesta; una central de 123 que se cae es otra cosa.

Lo bueno: FALCON ya tiene WebRTC propio y funcional con coturn, así que el
softphone no arranca de cero.

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
