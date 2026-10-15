# Mesa de ayuda de FALCON CAD

Cómo se reciben, clasifican y atienden los reportes de las instancias.

> Estado: la matriz de severidad y los niveles están acordados. La herramienta
> de tickets **todavía no está contratada**; hasta que lo esté, el reporte sale
> de FALCON **por correo** a `soporte@falconcad.com.co`, con copia a quien lo
> abrió y un número para nombrarlo. Ese buzón es, por ahora, la mesa entera.
> Ver *Lo que falta* al final.

---

## 1. Por qué no hay turnos 24/7

Con la semana de 42 horas, cubrir el reloj completo en turnos exige
168 ÷ 42 = **4,0 personas a tiempo completo sin un solo día de ausencia**; con
vacaciones, incapacidades y capacitación son unas cinco. El equipo es de tres o
cuatro, así que montar turnos dejaría un turno descubierto al primer
incapacitado — y se caería justo cuando más se nota.

El modelo es entonces **mesa en horario + disponibilidad para severidad 1**.
Eso sí lo sostiene el equipo, y es lo que de verdad necesita un CAD: a las tres
de la mañana nadie reporta que un informe salió mal, pero sí que no pueden
crear un caso.

---

## 2. Matriz de severidad

| | Qué es | Ejemplos en FALCON | Respuesta | Mitigación |
|---|---|---|---|---|
| **S1** | La operación está detenida | No se puede crear un caso · el despacho no responde · la planta no entrega llamadas a ningún puesto · caída total | **15 min, 24/7**, por teléfono | 2 h |
| **S2** | Funciona degradado | La videollamada no conecta · el mapa no carga · un canal (WhatsApp/SMS) caído · lentitud generalizada · un puesto afectado | 1 h en horario; si es de noche, a primera hora | 1 día hábil |
| **S3** | Falla sin impacto operativo | Un informe sale con datos malos · un catálogo no guarda · un permiso mal asignado | 1 día hábil | 5 días hábiles |
| **S4** | Petición, duda o mejora | Cómo se hace algo · crear un usuario · agregar un tipo de caso | 2 días hábiles | Sin compromiso; entra al backlog |

Dos reglas que valen tanto como la tabla:

- **Quien reporta propone la severidad; la mesa la confirma.** Si la fija quien
  reporta, en dos semanas todo es S1 y la escala deja de significar nada.
- **S1 se reporta por teléfono, además del ticket.** Un mensaje que nadie vio
  no es un aviso. El diálogo de reporte lo dice en pantalla al elegir S1.

---

## 3. Niveles

| Nivel | Quién | Qué resuelve | Meta |
|---|---|---|---|
| **N1** | Quien esté en turno | Claves, permisos, catálogos, "cómo se hace". Reproduce y clasifica. | Cerrar 60–70 % aquí |
| **N2** | Quien conoce el sistema | Logs, base de datos, re-despliegue, configuración de instancia | |
| **N3** | Desarrollo | Código | Se llega **solo por N2** |

El tenant nunca escala directo a N3. Si puede, N1 y N2 dejan de existir en la
práctica y la mesa se convierte en una lista de llamadas al desarrollador.

---

## 4. El reporte desde dentro del sistema

En la barra superior, junto a *Cambiar mi contraseña*, hay un botón de soporte
disponible desde **cualquier pantalla** — el problema casi siempre está en la
pantalla donde se está parado, y mandar al usuario a otra página a reportarlo
pierde justamente el contexto que hace útil el reporte.

El diálogo pide dos cosas (severidad y relato) y adjunta solo el contexto
técnico, que **se muestra completo antes de enviarlo**:

```
── FALCON CAD · contexto técnico ─────────────────────
Generado      10/11/2026, 5:02:00 PM
Versión       2ee819c (publicada 2026-10-11T16:55:31Z)
Usuario       Juan Pérez (jperez) · rol despachador
Instancia     63001 · agencia policia
Pantalla      /despacho
Canal casos   caido
Planta        sin contratar o sin abrir
Red           en línea
Navegador     Mozilla/5.0 (…) Chrome/141.0.0.0
Entorno       ventana 1280×900 · pantalla 1280×900 · es-CO · America/Bogota

Últimos 3 errores (el más reciente al final):
  5:01:53 PM  GET /api/auth/perfil [0] — sin respuesta del servidor
  5:01:55 PM  POST /api/casos [403] — No tiene permisos para esta acción
  5:01:58 PM  TypeError — no se puede leer la propiedad lat de null
──────────────────────────────────────────────────────
```

### Qué NO lleva, y por qué

El reporte sale del sistema: va a un correo, a un ticket, a un proveedor. Por
eso quedan fuera, por diseño y con pruebas que lo verifican:

- **El token de la sesión.** Es una credencial viva: quien recibiera el ticket
  podría actuar como quien lo reportó.
- **Los cuerpos de las peticiones y respuestas.** Ahí viajan el relato de la
  emergencia, el teléfono y la dirección del ciudadano. Un ticket de soporte no
  es lugar para los datos de una víctima (Ley 1581 de 2012). Del cuerpo de un
  error se toma únicamente el campo `message`, que es texto nuestro.
- **La cadena de consulta de cualquier URL.** Una búsqueda por teléfono dejaría
  el teléfono ahí. Se guarda solo la ruta.

El registro de errores está acotado a los **últimos 25** —un puesto de despacho
no recarga la página en doce horas— y **se vacía al cerrar sesión**, para que
el reporte del relevo no lleve los errores ni las rutas del turno anterior en
la misma pantalla.

### Cómo sale el reporte

`POST /api/soporte/ticket` (autenticado, 5 cada 10 minutos por IP) recibe lo
que arma el diálogo y manda **dos correos**:

| | A dónde | Qué lleva | Responder va a |
|---|---|---|---|
| Aviso a la mesa | `SOPORTE_CORREO` (por defecto `soporte@falconcad.com.co`) | Número, severidad propuesta y su compromiso, instancia, quién reporta y su correo, pantalla, el relato y el contexto técnico completo | Quien reportó |
| Acuse | El correo de la cuenta que reportó | Número, severidad, compromiso, instancia y el relato | La mesa |

El número es de la forma `FC-261015-7K3Q`: `FC`, la fecha **en hora de
Colombia** y cuatro caracteres de un alfabeto sin `I`, `O`, `0` ni `1`, porque
se dicta por teléfono.

Tres decisiones que conviene no deshacer sin pensarlo:

- **Ningún correo habla de ESTADO.** No hay tablero que lo mantenga. Decir
  «estado: abierto» sería prometer una consulta que no existe, y la primera
  persona que intente verla deja de creerse el resto del mensaje. Hay una
  prueba que lo vigila (`soporte.service.spec.ts`).
- **Si el correo a la mesa no sale, no se acusa recibo.** El diálogo lo dice,
  deja el reporte a la vista para copiarlo o descargarlo, y no muestra ningún
  número: uno que no está en ningún buzón es peor que ninguno.
- **El correo del acuse sale de la cuenta autenticada, nunca del cuerpo de la
  petición.** De lo contrario el endpoint sería una forma de mandar correo con
  el membrete de FALCON CAD a donde se quiera.

Pase lo que pase con el correo, el reporte queda en la **bitácora de la
instancia** (`soporte.ticket`) con el relato completo — hoy, el único registro
durable que existe.

Si la cuenta no tiene correo registrado, el ticket sale igual: el aviso a la
mesa lo dice («la cuenta no tiene correo») para que se la contacte por otro
medio, y el diálogo le pide a la persona que anote el número.

### Dónde vive

| Pieza | Archivo |
|---|---|
| Búfer de errores y redacción | `frontend/src/app/core/registro-errores.ts` |
| Enganche de errores HTTP | `frontend/src/app/core/error-toast.interceptor.ts` |
| Enganche de excepciones del navegador | `frontend/src/app/core/manejador-errores.ts` |
| Armado del informe | `frontend/src/app/core/diagnostico.service.ts` |
| Diálogo | `frontend/src/app/shared/soporte/` |
| Envío (frontend) | `frontend/src/app/core/soporte.service.ts` |
| Endpoint y correos | `backend/src/soporte/`, `backend/src/correo/plantillas.ts` |
| Escala de severidad del servidor | `backend/src/soporte/severidad.ts` |
| Sello de versión | `publicar_version()` en `deploy/deploy-falcon.sh` → `/config/version.json` |

---

## 5. Lo que falta

1. **Contratar la herramienta de tickets.** Debe ser **alojada, no propia**: la
   mesa tiene que estar arriba exactamente cuando FALCON está caído, y montarla
   en el mismo servidor haría que una caída se lleve el canal por el que uno se
   entera de la caída. Requisito técnico: API REST para crear el ticket desde
   aquí.
2. ~~**Enviar el reporte, no solo copiarlo.**~~ Hecho: el reporte sale por
   correo (ver *Cómo sale el reporte*). Cuando se contrate la herramienta, lo
   que cambia es el final de `SoporteService.abrir()` —una llamada a su API en
   lugar de, o además de, el correo— y el número pasa a ser el suyo. El resto
   de la cadena, incluido el diálogo, no se toca.
   Queda pendiente de ese cambio: **el estado**. Hoy ningún correo lo menciona,
   a propósito; cuando haya dónde consultarlo, el acuse puede llevar el enlace.
3. **Base de conocimiento.** Sin ella N1 no cierra nada y todo escala.
4. **Informe mensual** por instancia y severidad: sin medir, no se sabe si la
   mesa mejora o solo aguanta.
