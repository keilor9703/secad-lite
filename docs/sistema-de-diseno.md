# Sistema de diseño de FALCON CAD

Los valores y las piezas con las que se arma cualquier pantalla del sistema.

> Vive en `frontend/src/styles.scss`. Este documento explica **por qué** cada
> cosa es como es; el archivo es la fuente de verdad. Si los dos se
> contradicen, manda el archivo y este documento está desactualizado.
>
> Nace de `auditoria-diseno.md`, que midió lo que había: 49 tamaños de letra
> distintos, 39 separaciones, 137 rellenos, catorce z-index sin orden, seis
> modales, ocho tablas y el mismo estado de un caso pintado de dos colores
> según la pantalla.

---

## 1. Para qué sirve esto

Un sistema de diseño no es una guía de estilo bonita. Es la respuesta a una
pregunta práctica: **cuando alguien escriba la pantalla número once, ¿de dónde
va a sacar los valores?**

Hasta ahora los sacaba de la pantalla que tuviera más a mano, y por eso el
título de sección mide seis tamaños distintos según el módulo. Ninguna de esas
seis decisiones estuvo mal tomada por separado; el problema es que fueron seis
decisiones donde debía haber una.

La regla, entonces, es una sola:

> **Si el valor que necesita está en la escala, úselo. Si no está, casi
> siempre es que el que hacía falta era el de al lado.**

Las excepciones existen y están nombradas en el punto 7. Lo que no vale es la
excepción silenciosa.

---

## 2. Color

La paleta ya estaba bien pensada y no se tocó más que para el contraste. Los
tokens están en `styles.scss` y hay dos juegos completos: el tema claro en
`:root` y el oscuro en el mixin `tema-oscuro`.

### Superficies y texto

| Token | Para qué |
|---|---|
| `--bg` | el fondo de la página |
| `--surface` | una tarjeta, un diálogo, un campo |
| `--surface-2` | un realce dentro de una superficie: cabecera de tabla, `:hover`, insignia apagada |
| `--border` | separador entre cosas del mismo grupo (filas de una tabla, borde de una tarjeta) |
| `--border-2` | borde de algo con lo que se interactúa (un campo, un botón) |
| `--ink` | texto principal |
| `--ink-soft` | texto secundario que todavía hay que leer |
| `--muted` | texto de apoyo que se mira solo si hace falta |

### Acento y estados

`--accent` es la identidad (teal). `--accent-deep` es su versión oscura para el
`:hover` del botón primario. `--accent-soft` es el fondo diluido.
`--danger`, `--warn` y `--ok` son los tres estados; `--on-accent` es el texto
que va **encima** del acento.

### Contraste: esto no es opinable

Los valores de `--muted`, `--accent`, `--warn` y `--tag-warn-fg` están puestos
en el borde bajo que todavía cumple **WCAG 2.1 AA (4,5:1)** sobre las tres
superficies del tema claro. No se aclaran. Antes daban entre 3,77 y 4,45 y,
como `--muted` es el color de todos los subtítulos, cabeceras de columna,
estados vacíos y marcas de tiempo, fallaban en los diez módulos a la vez.

```bash
node scripts/contraste.mjs          # informe de los 74 pares
node scripts/contraste.mjs --breve  # solo lo que falla
```

Sale con código **1** si un par baja de 4,5, y con **2** si la estructura de
`styles.scss` cambió de forma que ya no se puede leer la paleta — esto último
lo encontró un sabotaje: antes, renombrar el bloque del tema oscuro dejaba el
script pasando en verde sin haber comprobado nada.

### Color por módulo

Los once `--mod-*` son la identidad de cada módulo en la barra superior. Los
lleva **el icono**; el texto se queda neutro. Así la barra se escanea por color
—la memoria encuentra «el naranja» antes que leer «Despacho»— sin que once
palabras de colores distintos compitan entre sí. Todos están en una banda de
luminosidad parecida para que ninguno pese más que los demás, y los once pasan
contraste sobre su propio tinte al 14 % (la pestaña activa).

---

## 3. Tipografía

Una sola familia (`--sans`, Inter con respaldos del sistema) y `--mono` para lo
que es un identificador y no una palabra: códigos de caso, números de abonado,
horas en una tabla.

Ocho peldaños. El `rem` es relativo a la **raíz** (16 px), no al `font-size:
14px` del `body`, así que `0.875rem` es exactamente el cuerpo de texto.

| Token | px | Dónde |
|---|---|---|
| `--texto-2xs` | 10,4 | la meta más pequeña (el rol bajo el nombre del usuario) |
| `--texto-xs` | 11,5 | cabecera de columna, insignia, pie de un campo |
| `--texto-sm` | 12,8 | texto secundario, ayuda, marca de tiempo |
| `--texto-base` | **14** | **cuerpo**: celdas, botones, campos, párrafos |
| `--texto-md` | 16 | título de sección dentro de una tarjeta (`h2`) |
| `--texto-lg` | 18,4 | título de un diálogo |
| `--texto-xl` | 21,6 | **título de página** (`h1`) — uno por pantalla |
| `--texto-2xl` | 28 | la cifra grande de un indicador |

Por qué ocho y no catorce: la auditoría midió **catorce tamaños distintos entre
10,4 px y 14,4 px** en pantalla a la vez. La diferencia entre 13,6 y 13,76 px no
la ve nadie, pero cada una es una decisión que hay que mantener.

---

## 4. Espaciado

Rejilla de 4 px. Siete peldaños.

| Token | px | Cuándo |
|---|---|---|
| `--esp-1` | 4 | dentro de una misma línea: un icono y su texto |
| `--esp-2` | 8 | entre elementos hermanos: dos botones, dos campos |
| `--esp-3` | 12 | |
| `--esp-4` | 16 | entre grupos distintos, y entre tarjetas |
| `--esp-5` | 24 | entre secciones de una página |
| `--esp-6` | 32 | |
| `--esp-7` | 48 | aire grande: el interior de un estado vacío |

La regla que resuelve el 90 % de los casos: **lo que va junto se separa con
`--esp-2`; lo que es otra cosa, con `--esp-4`.** Si hace falta algo intermedio,
normalmente es que los dos elementos no eran tan distintos como parecía.

El interior de una tarjeta es un solo valor: `--pad-tarjeta` (16 px arriba y
abajo, 20 a los lados). Había ocho.

### Radio

`--radius-sm` (6 px) para un control —campo, botón, insignia rectangular—;
`--radius` (10 px) para una tarjeta o un diálogo; `--radius-lg` (14 px) para una
superficie grande; `--radius-pill` (999 px) para una cápsula.

---

## 5. Apilamiento (`z-index`)

Lo que había eran catorce números sueltos —3000, 2500, 2000, 1000, 900, 500,
30, 25, 20, 15, 10, 2, 1, 0— puestos cada uno para ganarle al de al lado. Dos
consecuencias concretas: el aviso (toast, 1000) salía **por debajo** del modal
que lo disparaba (2500), y un desplegable abierto se pintaba encima de un
diálogo.

El orden ahora tiene una razón:

| Token | Valor | Por qué ahí |
|---|---|---|
| `--z-base` | 1 | |
| `--z-barra` | 10 | la barra superior, pegada arriba |
| `--z-velo` | 100 | el fondo oscurecido de un diálogo |
| `--z-dialogo` | 110 | |
| `--z-desplegable` | 200 | **encima del diálogo**: un selector tiene que poder abrirse dentro de uno |
| `--z-flotante` | 300 | la ventana de videollamada que sigue al usuario |
| `--z-aviso` | 400 | el toast se ve siempre, también sobre un diálogo |

---

## 6. Componentes

### Ya estaban en el sistema

`.btn` (con `--primary`, `--ghost`, `--danger` y `.mini`), `.card`,
`.card-hover`, `.badge` (con sus cinco variantes) y `.field`. Sus nombres están
en inglés y el resto del sistema en español. Es incoherente, y se queda así a
propósito: `.btn` aparece 160 veces en las plantillas, y renombrarlo no mejora
ni una pantalla. Lo que sí importa es que no haya **dos** maneras de pintar un
botón.

### Nuevos

Cada uno existe porque la auditoría encontró el mismo concepto dibujado de
varias formas. El número entre paréntesis es cuántas versiones había.

**`.encabezado`** (13 copias) — el título de la pantalla, su frase de contexto
y, a la derecha, las acciones sobre toda la pantalla.

```html
<header class="encabezado">
  <div>
    <h1>Recursos</h1>
    <p>Patrullas y unidades disponibles.</p>
  </div>
  <div class="encabezado-acciones">
    <button class="btn btn--primary">Registrar unidad</button>
  </div>
</header>
```

**`.panel`** (8 rellenos distintos) — el interior de una tarjeta. `.card` pone
la caja; `.panel` lo de dentro. La disposición vertical se pide aparte con
`.panel--col`, por el motivo del punto 8.

```html
<section class="card panel panel--col">
  <h2>Casos por agencia</h2>
  …
</section>
```

**`.pestanas`** (3 copias idénticas y una cuarta distinta) — navegación dentro
de una pantalla. Subrayado, no pastilla: la pastilla compite visualmente con
los botones.

**`.tabla--sistema`** (8 implementaciones, 7 cabeceras) — siempre dentro de
`.tabla-envoltura`; sin el envoltorio, una tabla ancha ensancha la página
entera en un celular.

**`.estado-vacio`** (12 declaraciones, y ninguna lo era) — una frase gris no es
un estado vacío. Quien llega a una pantalla sin datos no sabe si está vacía, si
falló la carga o si filtró mal. Un estado vacío dice **qué pasa** y **qué
hacer**.

```html
<div class="estado-vacio">
  <strong>No hay casos con estos filtros</strong>
  <p>Pruebe ampliando el rango de fechas o quitando el filtro de estado.</p>
  <button class="btn">Quitar filtros</button>
</div>
```

**`.velo` + `.dialogo`** (6 implementaciones, con **dos velos distintos**: tres
módulos oscurecían con azul marino y tres con negro puro, y en tema claro se
nota). Ancho con `.dialogo--sm` (420), `--md` (560) o `--lg` (680).

**`.cerrar`** (3 versiones, dos de ellas idénticas byte a byte) — la ✕ de un
diálogo o un panel.

### El color de un estado no se elige por pantalla

Esto es lo más importante del documento y no es decoración. La auditoría
encontró el mismo estado pintado de dos colores según dónde se mirara:
`nuevo` era teal en Consulta y **ámbar** en el modal de reporte; `cerrado` era
gris allá y **verde** acá. En un sistema de emergencias el color de un estado
**es información**, y quien baja de un reporte al detalle veía cambiar de color
el mismo caso.

El mapa vive en `styles.scss`, una sola vez:

| Estado | Familia | Lectura |
|---|---|---|
| `nuevo` | teal | llegó, nadie lo ha tomado |
| `en_gestion` | ámbar | alguien está en ello |
| `despachado` | azul | hay una unidad asignada |
| `derivado` | gris | salió de esta bandeja |
| `cerrado` | verde | terminó |

Las pantallas ponen `class="badge" data-estado="nuevo"` y no eligen el color.

---

## 7. Las excepciones, con nombre

Un sistema sin excepciones nombradas se llena de excepciones escondidas.

- **Sala (`wallboard`)** se ve desde tres metros, en un televisor. Su escala
  tipográfica es propia (`clamp()`) y su `h1` llega a 35 px. No se alinea con
  `--texto-xl` y está bien.
- **La videollamada y la página del ciudadano** pintan controles **sobre
  vídeo**. Ahí el fondo no es una superficie del tema sino la imagen de la
  cámara, así que usan literales de color fijos a propósito — igual que el
  marcador del mapa (`shared/mapa/pin-caso.ts`), que se lee sobre cartografía.
- **La baliza de la barra** usa rojo y azul fijos en los dos temas: se pinta
  sobre el borde de la barra y su código —el de una señal de emergencia— no
  debería cambiar con el tema.
- **Despacho con un caso abierto** se sale del tope de ancho general
  (`body.desp-ancho`): es la única pantalla que muestra vídeo, mapa y ficha a
  la vez.

---

## 8. Cómo se adopta, módulo por módulo

Ocho módulos ya declaran su propio `.panel`, tres su propio `.velo`, uno su
propia `.tabla`. Como el estilo de un componente de Angular gana en
especificidad, una regla global con el mismo nombre **no reemplaza a la local:
le añade propiedades que la local no fijaba**.

Eso no es teórico. La primera versión de este sistema traía `.panel` con
`display: flex`, y medido sobre las 36 capturas movió el tablero de Sala 633 px
sin que nadie lo hubiera pedido. Un sistema que al escribirlo rediseña cuatro
pantallas no es un sistema: es un rediseño encubierto.

Por eso lo que podía chocar se pide explícitamente —`.panel--col`,
`.tabla--sistema`— y lo demás usa nombres que no estaban ocupados. **Escribir
el sistema no cambió ni un píxel**, comprobado capturando los diez módulos más
Sala y el detalle, en claro y oscuro, a 1440 y 390 px, antes y después.

### El procedimiento para migrar uno

1. Capturar el módulo antes (claro, oscuro, escritorio, celular).
2. Borrar del `.scss` del módulo las reglas que el sistema ya da, y poner en la
   plantilla las clases del sistema.
3. Volver a capturar y **mirar el diff**. Lo que cambie tiene que ser lo que
   usted quería que cambiara; lo demás es un efecto colateral que hay que
   entender antes de seguir.
4. `node scripts/contraste.mjs` y las pruebas.

Los relojes de Sala, Monitor y Recepción hacen que esas capturas nunca sean
idénticas entre dos corridas: una corrida de control (mismo código, dos
capturas) dice cuánto ruido hay antes de culpar al cambio.

### En qué orden

Siguiendo el punto 5 de `auditoria-diseno.md`:

1. **Píldora de estado** — es lo más repetido y lo único con un error de
   significado, no de estética.
2. **Iconos** — veinte glifos Unicode sueltos a `app-icono`.
3. **Estados vacíos** — es la pantalla que se ve cuando algo no sale.
4. **Escala tipográfica** — mecánico, pero hay que mirarlo módulo a módulo.
5. **Encabezado, tarjeta, pestañas, tabla y diálogo** — borrar las copias.

---

## 9. Lo que todavía no cubre

Para que no se lea como terminado:

- **No hay escala de sombras.** Hay `--shadow` y literales sueltos.
- **No hay estados de carga.** Cada módulo resuelve «cargando…» a su manera;
  no hay esqueleto ni spinner del sistema.
- **No hay reglas de formulario más allá de `.field`**: la validación, el error
  bajo el campo y el estado deshabilitado los pinta cada pantalla.
- **Los gráficos** (`--serie-*`) tienen paleta pero no reglas de ejes,
  leyendas ni rejilla.
- **La iconografía** son 20 trazos; faltan los veinte y pico que hoy son
  emoji.
