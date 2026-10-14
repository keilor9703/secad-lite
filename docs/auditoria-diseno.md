# Auditoría de diseño de FALCON CAD

Qué se ve distinto en cada módulo, medido sobre el código y sobre la pantalla.

> Estado: **auditoría terminada, nada arreglado todavía**. Este documento es el
> inventario; el paso siguiente es arreglar el sistema de diseño (`styles.scss`)
> y después aplicarlo módulo por módulo. Cada hallazgo dice dónde está y qué
> cuesta.
>
> Fecha de la medición: 14 de octubre de 2026, sobre `1669909`.

---

## 1. Cómo se midió

Dos pasadas, porque ninguna de las dos sola alcanza:

**Sobre el código.** Las 31 hojas `.scss` del frontend (5 241 líneas) contadas
por valor: cada `font-size`, cada `padding`, cada `gap`, cada `border-radius`,
cada `z-index` y cada literal de color, agrupados para ver la dispersión real en
lugar de la impresión.

**Sobre la pantalla.** Navegador sin interfaz (Chromium) recorriendo los diez
módulos más Wallboard y el detalle del caso, en tema claro y oscuro, a 1440 px y
a 390 px, midiendo en el DOM ya pintado: el tamaño real de cada texto visible,
el radio y el relleno de cada caja con borde, el desborde horizontal. Lo medido
en pantalla es lo que manda: una hoja puede declarar 0,86 rem y la cascada
dejarlo en otra cosa.

**Lo que esta auditoría no cubre** —y conviene decirlo antes que los hallazgos:

- Las teselas de OpenStreetMap están bloqueadas en el entorno donde se corrió
  esto, así que **no pude juzgar nada que se lea sobre cartografía real**: ni el
  marcador de caso, ni la leyenda, ni el mapa de calor.
- Algunos módulos (Panel, Monitor, Catálogos) se midieron con respuestas
  simuladas que no siempre calzan con el contrato real, así que se auditó su
  *estructura*, no sus datos. En Consulta y Recursos sí se sembraron datos
  correctos y por eso de ahí salen las comparaciones más finas.
- No se auditó la videollamada en curso ni el Wallboard en un televisor: los dos
  viven en condiciones (vídeo de fondo, 3 m de distancia) que no se reproducen
  en una captura de escritorio.
- Esto mira **coherencia y legibilidad**, no la arquitectura de la información.
  Si un módulo pide demasiados pasos para hacer su trabajo, eso es otro estudio.

---

## 2. Lo primero, que no es de diseño

### H0 · La barra de navegación esconde la mitad del sistema

En un `superadmin` la barra tiene **10 pestañas y necesita 1 110 px**. El
espacio que le queda, descontando marca, selector de instancia, tema y bloque de
usuario, es bastante menos. Medido:

| Ancho de pantalla | Espacio para las pestañas | Pestañas ocultas |
|---|---|---|
| 1920 px | 1 126 px | ninguna |
| 1800 px | 1 006 px | Monitor |
| 1600 px | 806 px | Administración, Plataforma, Monitor |
| **1440 px** | 646 px | Catálogos, Administración, Plataforma, Monitor |
| **1366 px** | 572 px | **Mapa, Catálogos, Administración, Plataforma, Monitor** |
| 1280 px | 486 px | Panel, Mapa, Catálogos, Administración, Plataforma, Monitor |
| 1100 px (solo iconos) | 306 px | Administración, Plataforma, Monitor |
| 1000 px (solo iconos) | 206 px | seis módulos |
| ≤ 900 px | hamburguesa | ninguna, el menú funciona |

A **1366 × 768**, que es la pantalla de un portátil institucional corriente, un
superadministrador ve cinco módulos de diez.

Y no es solo que no se vean. La barra es `overflow-x: auto` con la barra de
desplazamiento oculta a propósito (`shell.scss:41-49`), así que:

- rueda **horizontal** (dos dedos en un trackpad): desplaza, `scrollLeft` 0 → 517;
- rueda **vertical**, que es lo único que tiene un ratón de escritorio: **no hace
  nada**, `scrollLeft` 0 → 0;
- no hay barra visible, ni degradado, ni flecha, ni `::after`: **cero señal** de
  que haya más.

En una consola de despacho con ratón normal a 1366 px, Mapa, Catálogos,
Administración, Plataforma y Monitor **no se pueden alcanzar desde la barra**.
Se llega escribiendo la URL.

El escalón de iconos sin etiqueta entra a 1150 px y la hamburguesa a 900 px
(`shell.scss:56,64,214`), o sea que los dos remedios existen pero empiezan
*debajo* de la franja donde está el problema. Y a 1100 px, ya en modo iconos,
sigue recortando: los iconos solos necesitan 425 px y tienen 306 px.

![La barra a 1440 px: después de «Mapa» queda un fragmento de 4 px del icono
siguiente, y cuatro módulos más quedan fuera](img/auditoria/h0-barra-1440.png)

A 1440 px la barra termina en «Mapa» y deja asomando una astilla de cuatro
píxeles del icono de Catálogos. No se lee como «hay más, desplace»: se lee como
un defecto de render.

**Por qué va primero:** es el único hallazgo de esta lista que no es cuestión de
gusto. Y es exactamente lo que estalla en una demostración comercial hecha en el
portátil del cliente.

**Arreglo:** o un menú «más» que recoge lo que no cabe, o subir el escalón de
iconos a ~1750 px y el de hamburguesa a ~1200 px, o permitir dos filas. Media
jornada; hay que probarlo en los siete anchos de la tabla.

---

## 3. Coherencia, por orden de lo que más se nota

### H1 · Tipografía: 49 tamaños declarados, 24 en pantalla a la vez

411 declaraciones de `font-size` con **49 valores distintos**. En pantalla, en
los doce módulos medidos a 1440 px, quedan **24 tamaños de texto diferentes**.

La franja pequeña es la que está rota: entre 10,4 px y 14,4 px hay **catorce
tamaños distintos** —10,4 · 10,88 · 11,52 · 11,84 · 12,16 · 12,48 · 12,8 ·
13,12 · 13,44 · 13,6 · 13,76 · 14 · 14,08 · 14,4—. La diferencia entre 13,6 y
13,76 px no la ve nadie, pero cada una es una decisión tomada por separado que
hay que mantener por separado. Catorce decisiones para, como mucho, cuatro
escalones que el ojo distingue.

No hay escala tipográfica en `styles.scss`: hay `--sans`, `--mono` y el
`font-size: 14px` del `body`, y de ahí en adelante cada hoja inventa.

**Arreglo:** definir seis u ocho peldaños como tokens
(`--texto-xs … --texto-2xl`) y sustituir. Es mecánico pero toca 411 sitios: dos
jornadas con revisión visual módulo a módulo.

---

### H2 · La píldora de estado: nueve nombres, y el mismo estado de dos colores

Es el elemento más repetido del producto —aparece en Consulta, Detalle,
Recepción, Despacho, Panel, Recursos y los dos modales de detalle— y es el que
peor está.

**El sistema ya lo tiene.** `styles.scss:204-215` define `.badge` con sus cinco
variantes. Pero `.badge` está **redefinido localmente en seis componentes**
(`admin`, `casos`, `catalogos`, `detalle`, `detalle-llamadas`,
`detalle-reporte`), y como Angular encapsula los estilos del componente, el
local gana siempre. Además hay la misma idea con otros ocho nombres: `.rbadge`,
`.prio`, `.chip`, `.chip-prio`, `.chip-ro`, `.chip-canal`, `.rol-tag`,
`.etiqueta`.

Medido en pantalla, el mismo dato en dos módulos vecinos:

| | Consulta | Recursos |
|---|---|---|
| tamaño | 11,84 px | 11,52 px |
| alto | 23 px | 24 px |
| relleno | 2,4 / 8 px | 3,2 / 8,8 px |
| mayúsculas | **sí**, «NUEVO» | **no**, «Disponible» |
| espaciado entre letras | 0,47 px | normal |

![Consulta: los estados en mayúsculas, pequeños y con
espaciado](img/auditoria/h2-pildora-consulta.png)

![Recursos: los estados en caja alta y baja, más grandes y sin
espaciado](img/auditoria/h2-pildora-recursos.png)

Un clic de distancia y cambia el registro tipográfico entero. En las dos
capturas se ve además que la cabecera de columna de Recursos lleva banda gris y
la de Consulta no (H7), y que las acciones de fila de Recursos son texto suelto
—«Editar · Fuera de servicio · Eliminar»— donde el resto del sistema usa
botones.

**Lo grave es el color.** El mismo estado se pinta distinto según la pantalla:

| Estado | Consulta y Detalle | Modal de reporte |
|---|---|---|
| `nuevo` | teal | **ámbar** |
| `en_gestion` | ámbar | **teal** |
| `derivado` | azul (info) | **gris** |
| `cerrado` | gris | **verde (ok)** |
| `finalizada` | gris (Detalle) | **teal** (modal de llamadas) |

`casos.scss:38-42`, `detalle.scss:92-96`, `detalle-reporte.scss:90-94`,
`detalle-llamadas.scss:89-92`.

En un sistema de emergencias el color de un estado **es información**. Que
`nuevo` sea teal en una pantalla y ámbar en la de al lado no es un detalle
estético: quien baja del reporte al detalle ve cambiar de color el mismo caso.

**Arreglo:** un único mapa estado → variante, en un solo lugar, y borrar las
seis redefiniciones y los ocho alias. Una jornada, y conviene hacerlo antes que
nada de lo demás porque es el que más superficie toca.

---

### H3 · El título de sección: seis tamaños para una sola cosa

«Título dentro de una tarjeta» es un `h2` en todos lados, y mide, medido en
pantalla:

| Tamaño | Dónde |
|---|---|
| 20 px | Wallboard (mayúsculas) |
| 18,4 px | Recepción (`.fp-head h2`) |
| 16,8 px | Despacho, Recursos, Plataforma |
| 16,32 px | Mapa |
| 15,2 px | Panel, Administración |
| **12,48 px** | **Monitor** |

Monitor es el caso extremo: sus títulos de sección son **más pequeños que el
texto corrido** y van en mayúsculas, así que «ESTADO DEL SERVICIO» no se lee
como un título sino como el encabezado de una columna de tabla. Es el único
módulo con otro idioma de jerarquía, y se nota apenas se entra.

![Monitor: «ESTADO DEL SERVICIO» e «INFRAESTRUCTURA» a 12,48 px, más pequeños
que el texto corrido](img/auditoria/h3-titulos-monitor.png)

En la misma página Monitor mezcla además dos tratamientos de sección: «Estado
del servicio» e «Infraestructura» van en tarjetas; «Cartera de instancias» y
«Uso y transaccionalidad» son rótulos sueltos sobre el fondo, sin tarjeta.

---

### H4 · El encabezado de página: bien, pero copiado trece veces

Aquí la noticia es buena a medias. El `h1` mide **21,6 px en once de los doce
módulos** —Wallboard es la excepción, con `clamp(1.4rem, 3vw, 2.2rem)`, y está
bien porque se lee desde lejos en un televisor—: coherente. Pero la regla `margin: 0; font-size: 1.35rem; font-weight: 600;
letter-spacing: -0.02em` está **escrita trece veces** en trece archivos
(`admin`, `mapa`, `recursos`, `recepcion`, `casos`, `catalogos`, `monitor`,
`plataforma`, `dashboard`, `detalle`, `despacho`, más `login` a 1,4 rem y
`activar` a 1,15 rem).

Lo mismo con el subtítulo: `.​*-head p { margin: 0.2rem 0 0; color: var(--muted);
font-size: 0.85rem }` repetido en ocho archivos, salvo Recepción que lo pone a
0,9 rem.

Está coherente **por disciplina**, no por construcción. El próximo módulo que se
escriba no lo heredará de ningún lado, y el día que se quiera cambiar el tamaño
del título del producto hay que tocar trece archivos y acordarse de los dos que
se salieron.

---

### H5 · Las pestañas: tres copias idénticas y una distinta

`.admin-tabs`, `.cat-tabs` y `.plat-tabs` son **tres bloques equivalentes**
—mismo 0,86 rem, mismo relleno 0,6/0,9 rem, mismo subrayado de 2 px en acento,
mismo `:hover`, mismo `:focus-visible`— escritos tres veces
(`admin.scss:15-42`, `catalogos.scss:90-98`, `plataforma.scss:8-35`).

Y `.tab-btn` en Detalle (`detalle.scss:32-68`) es una **cuarta pestaña
visualmente distinta**: no subrayado sino pastilla con fondo, borde y radio,
relleno 0,45/0,85 rem. El mismo gesto de navegación se dibuja de dos maneras
según el módulo.

---

### H6 · El modal: seis implementaciones, dos velos, sin escala de apilamiento

Seis cajas modales, cada una por su cuenta:

| | Velo | `z-index` | Ancho |
|---|---|---|---|
| `shell` (cerrar sesión) | `rgba(6,16,24,.45)` | 900 | 420 px |
| `soporte` | `rgba(6,16,24,.45)` | 900 | 560 px |
| `admin` (alta de usuario) | `rgba(6,16,24,.45)` | 900 | 680 px |
| `detalle-llamadas` | `rgba(0,0,0,.45)` | 2500 | propio |
| `detalle-reporte` | `rgba(0,0,0,.45)` | 2500 | propio |
| `confirm` | `rgba(0,0,0,.45)` | 3000 | propio |
| `mfa-modal` | propio | 1000 | propio |

Dos velos distintos: tres modales oscurecen la página con un azul marino y tres
con negro puro. Se ve, sobre todo en tema claro.

El `z-index` no tiene escala. Repartidos por el código hay 3000, 2500, 2000,
1000, 900, 500, 30, 25, 20, 15, 10, 2, 1, 0. Dos consecuencias concretas:

- El **toast** está en 1000 y los modales de detalle en 2500: el aviso que
  confirma una acción sale **por debajo** del modal que la disparó.
- Los desplegables (`selector`, `fecha`, `autocompletar`) están en 2000, por
  encima de los modales de 900: un desplegable abierto en la página de atrás se
  pinta sobre el modal.

También el botón de cerrar: `.dl-x` y `.dr-x` son **idénticos byte a byte** en
dos archivos, y el de Despacho (`.panel-caso .cerrar`) es un tercero
completamente distinto —redondo, 28 px, con borde y fondo—.

---

### H7 · La tabla: ocho implementaciones, tres cabeceras

Ocho tablas, con el texto a 0,82 / 0,88 / 0,9 rem según el módulo, y tres
envoltorios con tres nombres (`.tbl-wrap`, `.dl-tabla-wrap`/`.dr-tabla-wrap`,
`.tabla-envoltura`) y tres rellenos distintos.

La cabecera de columna, que es un solo concepto, en siete variantes:

| Módulo | Tamaño | Espaciado | Relleno | Fondo |
|---|---|---|---|---|
| Administración | 0,72 rem | 0,05 em | 0,55 / 0,75 | `surface-2` |
| Recursos | 0,72 rem | 0,05 em | 0,55 / 0,75 | `surface-2` |
| Consulta | 0,72 rem | 0,05 em | 0,6 | — |
| Catálogos | 0,72 rem | 0,05 em | 0,5 / 0,6 | — |
| Panel | 0,70 rem | 0,06 em | 0,45 / 0,7 | — |
| Modales de detalle | 0,68 rem | 0,04 em | 0,4 / 0,6 | — |
| Monitor | 0,68 rem | 0,06 em, peso 700 | propio | — |

Que unas lleven banda gris y otras no se ve de inmediato al pasar de Recursos a
Consulta.

---

### H8 · La tarjeta: ocho rellenos interiores

`.card` existe en el sistema (`styles.scss:179`) y se usa. Lo que no está en el
sistema es **el interior** de la tarjeta, y cada módulo lo decide:

`17,6 × 19,2 px` (seis módulos) · `19,2 × 20,8` (Detalle) · `19,2 × 16`
(Wallboard) · `17,6 × 20,8` (Wallboard, otra) · `24 × 28,8` (Recepción) ·
`32 × 24` (Despacho) · `12,8 × 16` (Panel, Plataforma) · `11,2 × 13,6`
(Monitor).

Lo mismo con el radio: hay `var(--radius)` y `var(--radius-sm)`, pero también
9 usos de `10px` y 9 de `6px` escritos a mano —el mismo número que el token— más
`8px`, `12px`, `4px`, `9px`, `14px`, `18px` y `2px` fuera de escala.

Y con el espaciado: **39 valores distintos de `gap`** y **137 de `padding`**, en
una rampa casi continua de 0,1 a 1,5 rem de 0,05 en 0,05. No hay escala de
espaciado en el sistema.

---

### H9 · El estado vacío: doce declaraciones, y ninguno es un estado vacío

Dos nombres para lo mismo (`.vacio` y `.vacio-inline`) repartidos en once
archivos, con seis tamaños (heredado · 0,8 · 0,82 · 0,85 · 0,88 · 0,9 rem) y
Consulta centrando el texto mientras los demás lo alinean a la izquierda.

Pero el problema de fondo es otro: **ninguno de los doce es realmente un estado
vacío**. Son una frase gris. Consulta sin resultados muestra la fila de diez
títulos de columna y, debajo, 600 px de fondo liso: ni mensaje, ni sugerencia de
quitar filtros, ni nada. Esa pantalla —la que ve cualquiera que filtre mal en
una demostración— parece un error de carga.

---

### H10 · Los iconos: cincuenta glifos sueltos y un componente que casi no se usa

Hay un componente de iconos, `app-icono`, con dieciocho trazos SVG propios que
siguen el tema. **Se usa en un solo archivo**: la barra superior.

En el resto de las plantillas la iconografía son **50 glifos Unicode distintos**
puestos a mano, en catorce archivos:

```
🔥 ◎ •  (modos del mapa)        ⬇ ⬆ (exportar/importar)
🔔 🔕 📹 📍 🚓 💬 📝 ✋ ⏳ ✓     🛡 🖥 🔌 🧾 👤 📞 🟢
🔒 🔐 📱 🗄 🏢 🔗 🌐 ⚠ ⛔        ⏹ ⏺ 🎙 🔇 ⛶ 🗗 ▸ ▾ ✕ ← → ↩ ↪ ⟲ ▲ ▼ 🔊 📺
```

Tres problemas, en orden de gravedad comercial:

1. **No se ven igual en cada máquina.** En Windows, `🛡 🖥 🎙 🗗 🗄` salen como
   trazos monocromos de Segoe UI Symbol o directamente como cuadro vacío,
   mientras `🔥 🚓 🟢 📹` salen a todo color. En la misma barra de herramientas
   conviven dos registros gráficos, y cuál sale en cuál depende del portátil del
   cliente.
2. **No siguen el tema.** Un emoji trae su propio color; en tema oscuro queda
   igual de saturado sobre fondo oscuro.
3. **Es el registro que el cliente ya señaló.** `🔥 Calor`, `◎ Cluster` y
   `• Puntos` como botones de modo del mapa son exactamente el mismo problema
   que tenía el selector de tema.

**Arreglo:** ampliar `app-icono` a los veinte o veinticinco símbolos que de
verdad se usan y sustituir. Dos jornadas, y es de los que más cambian la
percepción por hora invertida.

---

### H11 · El foco: dos idiomas y cuatro desplazamientos

Conviven dos maneras de marcar el foco de teclado, que de por sí es defendible
—anillo relleno para campos, contorno para controles—, pero sin regla escrita y
con el desplazamiento sorteado: `outline-offset` vale **−2 px** (fila de
Despacho), **1 px** (acciones de la barra, soporte), **2 px** (casi todo) y
**3 px** (videollamada). Y `.ext` (`admin.scss:246`) y `.editable`
(`catalogos.scss:48`) hacen `outline: none` y se quedan solo con el cambio de
borde: el indicador más débil del sistema está justo en los dos campos que se
editan en línea dentro de una tabla.

---

### H12 · Contraste: `--muted` no pasa AA en tema claro

Calculado sobre los tokens, relación de contraste WCAG:

| Token | sobre `bg` | sobre `surface` | sobre `surface-2` |
|---|---|---|---|
| `--ink` | 14,25 | 15,46 | 13,73 |
| `--ink-soft` | 6,98 | 7,57 | 6,72 |
| **`--muted`** | **3,91** | **4,24** | **3,77** |
| `--accent` (texto) | **4,39** | 4,76 | **4,22** |

AA pide 4,5 para texto normal. **`--muted` falla en las tres superficies del
tema claro**, y `--muted` es el color de: todos los subtítulos de página, todas
las cabeceras de columna, todos los estados vacíos, todas las ayudas, todas las
marcas de tiempo y el contador «0 de 0». Está en los diez módulos.

El tema oscuro pasa con holgura (4,80 – 6,04). El problema es solo del claro, que
es el que se usa de día en una sala de despacho con luz.

Subir `--muted` de `#6a7d90` a `#5c6f82` lo lleva a **4,78 / 5,18 / 4,60** sobre
las tres superficies —por encima de AA— sin cambiar el carácter de la paleta. Es **un token**, y
arregla los diez módulos de una vez: de toda la lista, es la mejor relación
entre esfuerzo y resultado.

Sobre la norma: la Resolución 1519 de 2020 del MinTIC exige nivel **WCAG 2.1 AA**
a los sujetos obligados de la Ley 1712 de 2014 para sus portales y sedes
electrónicas. **No verifiqué** si una consola operativa interna contratada a un
tercero entra en ese alcance —es discutible y no es una pregunta técnica—, pero
si un municipio lo pregunta en una licitación, hoy la respuesta honesta sería
«no en tema claro». Vale la pena resolverlo antes de que lo pregunten.

---

### H13 · Literales de color fuera del tema

Bastante contenido, para ser justos: 19 literales en `video-ciudadano`, 4 en
`videollamada`, 2 en `mapa-recorrido`, 2 en `shell` y uno suelto en `recepcion`,
`mfa-modal` y `detalle`.

Los de `video-ciudadano` y `videollamada` son en buena parte **legítimos**: son
controles que flotan sobre vídeo, donde el fondo no es el del tema sino la
imagen de la cámara, y ahí un color fijo es la decisión correcta (lo mismo que
el marcador del mapa, que ya se resolvió así en `shared/mapa/pin-caso.ts`).

Los que hay que revisar son los sueltos de `shell`, `recepcion`, `detalle` y
`mfa-modal`: esos sí están sobre superficies del tema y, por definición, uno de
los dos temas los lleva mal.

---

## 4. Lo que está bien

Para que la lista no engañe: el sistema no está mal construido, está **sin
terminar de sistematizar**. Lo que ya funciona y no hay que tocar:

- **La paleta.** Los tokens de color están bien pensados, documentados con el
  porqué, y validados con el script de la paleta para banda de luminosidad,
  croma y separación para daltonismo. Los dos temas están completos y el oscuro
  pasa contraste con holgura.
- **El color por módulo.** Los once `--mod-*` en una banda de luminosidad
  parecida, con el icono llevando la identidad y el texto neutro, es una
  decisión fina y poco común.
- **El `h1`.** 21,6 px en once de los doce módulos, y la excepción (Wallboard)
  es deliberada. Copiado trece veces, pero coherente.
- **Nada desborda.** Cero desbordamiento horizontal en los doce módulos, en los
  dos temas, a 1440 px y a 390 px. Eso no pasa solo.
- **El `prefers-reduced-motion`** está atendido globalmente.
- **Los comentarios del CSS.** La mayoría de las reglas raras explican por qué
  existen. Eso es lo que hizo posible esta auditoría en un día.

---

## 5. En qué orden conviene arreglarlo

Ordenado por lo que cambia la percepción por hora invertida, no por gravedad
técnica:

| | Hallazgo | Coste | Por qué ahí |
|---|---|---|---|
| 1 | **H12** contraste de `--muted` | 15 min | un token, arregla los diez módulos |
| 2 | **H0** barra de navegación | ½ jornada | no es diseño, es un módulo inalcanzable |
| 3 | **H2** píldora de estado | 1 jornada | el elemento más repetido, y hay conflicto semántico |
| 4 | **H10** iconos | 2 jornadas | lo que el cliente ya señaló dos veces |
| 5 | **H9** estados vacíos | 1 jornada | es la pantalla que se ve cuando algo no sale |
| 6 | **H1** escala tipográfica | 2 jornadas | mecánico, pero hay que mirarlo módulo a módulo |
| 7 | **H3 · H5 · H6 · H7 · H8** componentes repetidos | 3 jornadas | tarjeta, pestaña, modal, tabla y título a un solo sitio |
| 8 | **H4** encabezado de página | ½ jornada | sale casi solo al hacer el 7 |
| 9 | **H11** foco | ½ jornada | accesibilidad, poco visible pero barato |
| 10 | **H13** literales sueltos | 2 h | solo los cuatro que están sobre superficies del tema |

Antes del punto 3 hay que hacer el trabajo que no está en la tabla: **escribir lo
que falta del sistema** en `styles.scss` —escala tipográfica, escala de
espaciado, escala de `z-index`, el interior de la tarjeta, la cabecera de página,
la tabla, la pestaña, el modal y el estado vacío— porque sin eso cada arreglo
vuelve a ser una decisión suelta y en seis meses estamos igual.

---

## 6. Material de la auditoría

Las cuatro capturas que sostienen los hallazgos H0, H2 y H3 están en
`docs/img/auditoria/`. Las otras 32 (doce módulos × claro / oscuro / celular) y
las medidas en bruto quedaron fuera del repositorio, en el espacio de trabajo de
la sesión, para no cargarlo con 3 MB de imágenes. Si hace falta volver a correrlas, lo que se
midió está descrito en el punto 1 y se reproduce levantando `ng serve` y
recorriendo las rutas de `app.routes.ts` con el navegador sin interfaz.
