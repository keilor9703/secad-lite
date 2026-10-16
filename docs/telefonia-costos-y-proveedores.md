# Qué reemplaza Zadarma, cuánto cuesta y qué mirar en Colombia

> Para comparar contra la cotización de **YACO (Calltech S.A.)** y para decidir
> con qué operador se sale a vender. Fecha de los precios: **16/10/2026**.
>
> **Precaución sobre los números de esta página.** Salen de las páginas
> públicas de los proveedores leídas a través de buscador —el contenedor de
> desarrollo no puede abrir `zadarma.com` directamente— y de la pantalla real
> de la cuenta. Sirven para dimensionar, **no para cotizar**: antes de poner
> un precio en una propuesta hay que pedirlo por escrito al proveedor. Los
> planes y las tarifas por minuto cambian sin aviso.

---

## 1. Qué reemplaza Zadarma, exactamente

La pregunta no es «¿Zadarma hace lo que hace YACO?» sino **qué capa reemplaza
cada cosa**. Zadarma cubre la capa de telefonía; la capa de aplicación la
cubre FALCON. La comparación justa contra una cotización de YACO es
**Zadarma + FALCON**, no Zadarma sola.

| Pieza del mundo tradicional | Quién la reemplaza |
|---|---|
| Conmutador / PBX física en la alcaldía (Panasonic, Avaya, caja Asterisk) | **Zadarma** (centralita en la nube) |
| Tarjetería E1 / analógica, gateways | **Zadarma** — deja de existir, es SIP de punta a punta |
| Teléfonos de escritorio y licencias de softphone | **FALCON** (barra propia, SIP sobre WebSocket) |
| Grabador de llamadas (equipo aparte) | **Zadarma** (grabación en la nube) |
| ACD / colas / IVR | **Zadarma** (escenarios) |
| Troncal y numeración | **Zadarma** si es número de nube; **el operador del municipio** si es el 1XY |
| Barra CTI (pantalla del agente) | **FALCON** — es justo lo que YACO no ha entregado |
| CAD: caso, despacho, mapa, informes | **FALCON** — Zadarma no tiene nada de esto |
| Relación con el operador para el **123** | **Nadie la reemplaza.** Sigue siendo del operador local |

**La conclusión comercial:** Zadarma no compite con YACO. Zadarma reemplaza el
*conmutador* de YACO; FALCON reemplaza *todo lo demás* de YACO. Si la
cotización de YACO es por puesto de agente con la barra incluida, lo que hay
que comparar contra ella es la suma de abajo **más** el precio de FALCON.

---

## 2. Cuánto se le paga a Zadarma

### 2.1 Los planes (el piso)

| Operadores | Plan | Precio de lista | Grabación incluida |
|---|---|---|---|
| hasta 5 | **Standard** | **$0** | 5 extensiones |
| hasta 10 | **Office** | **$39/mes** (facturación anual; ~$44 mensual) | 8 extensiones |
| hasta 20 | **Corporation** | **$79/mes** (anual; ~$88 mensual) | 20 extensiones |

Extensiones sueltas por fuera del plan: **$2/mes** cada una. Grabación extra:
**$2/mes por extensión**. Y la centralita es gratis **si se recarga saldo al
menos cada 3 meses**; si no, pasa a **$5/mes** (los planes Office y
Corporation ya la incluyen siempre).

> **Hay un arbitraje, y conviene conocerlo antes de que lo descubra el
> cliente.** Para 10 puestos, *Standard + 5 extensiones sueltas* son **$10/mes**
> contra los **$39** de Office. La diferencia son las funciones del plan —IVR,
> grabación en 8 extensiones, etc.—. Para un CAD la grabación no es opcional,
> así que hay que sumarle $2/mes por cada extensión que grabe de más: 10
> puestos grabando por Standard son $10 + $10 = **$20/mes**. Sigue siendo la
> mitad. Vale la pena pedirle a Zadarma la comparación por escrito antes de
> pagar Office.

### 2.2 Lo que NO está en el plan, y es lo que de verdad cuesta

El plan cobra **puestos**, no **llamadas simultáneas**. Son dos cosas
distintas y confundirlas arruina una cotización:

- **Canales salientes.** En la cuenta de prueba el panel dice literalmente
  *«Canales salientes: 5»*. Veinte operadores con cinco canales salientes
  significa que la sexta devolución de llamada no sale. Hay reportes de
  terceros de que el plan Standard limita a 4 salientes simultáneas.
- **Canales de la línea externa** (el número del municipio, §1.2 de
  [`telefonia-zadarma.md`](telefonia-zadarma.md)): **1 entrante y 0
  salientes gratis**, 3+3 por **$6/mes**, 10+10 por **$16/mes**.
- **El número.** Colombia: ~**$16 de conexión + $23/mes**, solo móvil, se
  asigna al azar y pide documentos. Estados Unidos: ~**$2–4/mes**, inmediato.

> **La pregunta que hay que hacerle a soporte de Zadarma ANTES de cotizar 20
> puestos:** *¿cuántas llamadas simultáneas —entrantes y salientes— admite el
> plan Corporation sobre un número propio de Zadarma, y cuánto cuesta
> subirlo?* Una sala de emergencias de 20 puestos necesita 20 simultáneas. Si
> la respuesta es «5», el plan de $79 no sirve y el precio real es otro.

### 2.3 Los minutos, que es la línea que manda

A partir de 10 puestos **los minutos pesan más que el plan**, y por mucho.
El orden de magnitud, con la aritmética a la vista:

```
20 operadores × 6 h productivas/día × 20 días  =  2.400 h/mes  =  144.000 min/mes
```

Las entrantes a un número propio suelen venir incluidas; las **devoluciones de
llamada a móviles colombianos se pagan por minuto**. Con un 20 % de
devoluciones son ~29.000 min/mes: a $0,02/min son **$580/mes**, a $0,05/min son
**$1.450/mes**. Contra $79 del plan.

**No invente esa tarifa.** Pídale a Zadarma por escrito el precio por minuto a
**móvil Colombia** y a **fijo Colombia**, y multiplique. Esa casilla decide la
comparación con YACO, no el plan.

### 2.4 Resumen para dimensionar (sin minutos)

| | 5 puestos | 10 puestos | 20 puestos |
|---|---|---|---|
| Plan | $0 | $39 (o ~$20 por Standard + extras) | $79 |
| Número de nube Colombia | $23 | $23 | $23 |
| Línea externa 3+3 (número del municipio) | $6 | $6 | $16 (10+10) |
| **Piso mensual** | **~$29** | **~$49–68** | **~$118** |
| Minutos de devolución | **a cotizar — domina el total** | | |

---

## 3. El punto débil, que no es solo «no está en Colombia»

Sí, ese es el problema, pero conviene decirlo desarmado en cinco piezas,
porque cada una se responde distinto:

1. **Numeración pobre.** Para Colombia Zadarma solo ofrece **móviles**, y
   **asignados al azar**. Una alcaldía publicando «llame a este celular» es
   mala señal, y no se puede elegir un número bonito ni geográfico.
2. **El audio sale del país.** La señalización de la cuenta de prueba va a
   `pbxny2.zadarma.com` — Nueva York. Cada llamada Bogotá → NY → Bogotá:
   latencia añadida y una dependencia transcontinental en una línea de
   emergencias.
3. **Regulación del 1XY.** El 123 es numeración regulada y lo carga un
   operador habilitado en Colombia. **Zadarma no puede ser el operador del
   123.** Esto hay que confirmarlo con el área jurídica y la CRC, no darlo por
   sabido — pero planear como si fuera así.
4. **Contratación pública.** Esto es probablemente lo que mata el negocio
   antes que lo técnico: una alcaldía necesita RUT, facturación electrónica
   DIAN, contrato en español bajo ley colombiana y un SLA exigible. Zadarma no
   da nada de eso. En la práctica **el municipio los contrata a ustedes y
   ustedes contratan a Zadarma**: el riesgo, el margen y el SLA quedan de su
   lado.
5. **Residencia de los datos.** Las grabaciones de llamadas de emergencia
   viviendo en servidores en el exterior va a salir en cualquier licitación
   seria, aunque hoy no sea una prioridad.

---

## 4. Qué evaluar con presencia en Colombia

Hay tres familias, y la elección cambia quién es el dueño de la centralita.

### 4.1 CPaaS con numeración colombiana (Twilio, Telnyx, Plivo, Vonage, Infobip)

Dan **número + troncal SIP + API**, no una centralita. Twilio sí tiene
numeración colombiana, con una condición dura: la dirección de la empresa
debe estar **en la localidad del prefijo del número**, con documento que lo
pruebe (registro mercantil, factura de servicios, recibo de impuestos), y la
revisión del expediente tarda **hasta tres días hábiles, a veces semanas**.

**Y aquí está lo interesante para FALCON:** si ya no se necesita la centralita
del proveedor —porque FALCON tiene su propia barra y su propio manejo de
cola— un CPaaS encaja mejor que Zadarma. Se paga numeración y minutos, no
puestos. **El precio deja de escalar con el número de operadores**, que es
exactamente donde YACO cobra.

### 4.2 Operador o ITSP colombiano (Claro, ETB, Movistar, Tigo, integradores locales)

Troncal SIP con **contrato local, factura local, SLA exigible y capacidad de
cargar el 1XY**. Es la única familia que resuelve los puntos 3, 4 y 5 de
arriba. A cambio: menos API, menos autoservicio, y hay que negociar.

### 4.3 Centralita propia en Colombia

Asterisk/FreeSWITCH en infraestructura colombiana + troncal de 4.2, y esa
centralita se registra en FALCON **como un proveedor más** (un archivo en
`pbx/proveedores/` y una línea en el registro — ver
[`telefonia-proveedores.md`](telefonia-proveedores.md)). Control total,
responsabilidad total: la disponibilidad de la telefonía pasa a ser de
ustedes.

### 4.4 La recomendación

- **Zadarma se queda** como banco de pruebas y como el número de nube del
  caso **C** (municipio pequeño sin nada). Ahí su precio es imbatible.
- **Para una sala de 10–20 puestos en Colombia, no.** Esa debería ser
  **troncal colombiana + centralita propia o de un ITSP local + la barra de
  FALCON**. Y eso es exactamente para lo que se construyó el puerto de
  proveedores.
- **El argumento de venta contra YACO no es el precio de la telefonía**: es
  que FALCON no cobra por puesto de agente y no amarra al municipio a un
  operador. La telefonía se vuelve un insumo intercambiable — y poder decir
  «si su operador mejora la oferta, lo cambiamos sin tocar la aplicación» es
  algo que YACO no puede ofrecer.

---

## 5. Lo que falta averiguar antes de cotizar

Nada de lo de abajo se puede resolver desde el código; son llamadas y correos.

1. **A Zadarma:** llamadas simultáneas reales del plan Corporation, y precio
   por minuto a móvil y fijo Colombia.
2. **A dos CPaaS (Twilio y Telnyx, o Plivo):** disponibilidad de DID fijo
   colombiano, requisitos de documentación y tarifa por minuto.
3. **A dos operadores colombianos:** troncal SIP, canales simultáneos, si
   pueden entregar el 1XY del municipio y qué piden para hacerlo.
4. **Al área jurídica:** si una troncal de 123 puede terminar en una
   plataforma en el exterior, y dónde pueden vivir las grabaciones.
5. **De YACO:** la cotización desglosada. Si cobra por puesto, la comparación
   se gana sola a partir del décimo operador; si cobra por plataforma, hay que
   comparar con la suma completa de la §2.4 más los minutos.
