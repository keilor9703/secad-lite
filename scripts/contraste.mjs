#!/usr/bin/env node
/**
 * Comprueba el contraste de la paleta de FALCON CAD contra WCAG 2.1 AA.
 *
 * Por qué existe: `--muted` es el color de todos los subtítulos, cabeceras de
 * columna, estados vacíos, ayudas y marcas de tiempo del sistema. Cuando se
 * queda corto no falla una pantalla, fallan los diez módulos a la vez, y no se
 * nota mirando — se nota midiendo. Lo mismo con `--accent`, que se usa tanto de
 * fondo como de texto, y con las cinco etiquetas de estado.
 *
 * Lee los tokens de `frontend/src/styles.scss` (no los duplica: si alguien
 * aclara un color allá, esto lo ve) y comprueba cada par texto/fondo que de
 * verdad existe en la interfaz.
 *
 *     node scripts/contraste.mjs          # informe completo
 *     node scripts/contraste.mjs --breve  # solo lo que falla
 *
 * Sale con código 1 si algún par baja de 4,5:1, que es lo que pide AA para
 * texto normal. Los títulos grandes aguantarían 3,0, pero ninguno de estos
 * tokens se usa solo en títulos, así que se les exige el umbral estricto.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOJA = join(RAIZ, 'frontend', 'src', 'styles.scss');
const MINIMO = 4.5;

// --- color ------------------------------------------------------------------

const aRgb = (hex) => {
  const h = hex.replace('#', '');
  const largo = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(largo.slice(i, i + 2), 16));
};

const luminancia = (hex) =>
  aRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);

const contraste = (a, b) => {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** `color-mix(in srgb, color p%, transparent)` pintado sobre un fondo opaco. */
const mezclar = (color, fondo, p) => {
  const [a, b] = [aRgb(color), aRgb(fondo)];
  const v = a.map((c, i) => Math.round(c * p + b[i] * (1 - p)));
  return '#' + v.map((c) => c.toString(16).padStart(2, '0')).join('');
};

// --- lectura de los tokens --------------------------------------------------

/**
 * Saca los `--token: #valor` de un bloque con llaves balanceadas que empieza en
 * `inicio`. Contar llaves —y no cortar en el primer `}`— importa porque el
 * bloque del tema claro trae comentarios y, el día que traiga una regla
 * anidada, un corte ingenuo se llevaría la mitad de la paleta sin avisar.
 */
function tokensDeBloque(texto, ancla, comoSeLlama) {
  const inicio = texto.indexOf(ancla);
  // Sin esto, un `indexOf` fallido (-1) hace que la búsqueda empiece desde el
  // principio del archivo y el script acabe auditando OTRO bloque — y pasando
  // en verde. Lo encontró un sabotaje: renombrar el mixin del tema oscuro no
  // rompía nada, simplemente dejaba de comprobarlo.
  if (inicio < 0) {
    console.error(`No encontré el bloque del tema ${comoSeLlama} («${ancla}») en styles.scss.`);
    process.exit(2);
  }
  const abre = texto.indexOf('{', inicio);
  let nivel = 0;
  let fin = abre;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}' && --nivel === 0) { fin = i; break; }
  }
  const cuerpo = texto.slice(abre + 1, fin);
  const tokens = {};
  for (const [, nombre, valor] of cuerpo.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[nombre] = valor.toLowerCase();
  }
  return tokens;
}

const hoja = readFileSync(HOJA, 'utf8');
const claro = tokensDeBloque(hoja, '\n:root {', 'claro');
const oscuro = tokensDeBloque(hoja, '@mixin tema-oscuro', 'oscuro');

if (Object.keys(claro).length < 20 || Object.keys(oscuro).length < 20) {
  console.error('No pude leer la paleta de styles.scss. ¿Cambió la estructura del archivo?');
  process.exit(2);
}
// Los dos bloques tienen que ser DISTINTOS: si un cambio de estructura hiciera
// que ambos apuntaran al mismo sitio, el informe diría «todo pasa» habiendo
// comprobado el tema claro dos veces.
if (claro.bg === oscuro.bg) {
  console.error('Los dos temas leyeron el mismo --bg: el parseo está apuntando al mismo bloque.');
  process.exit(2);
}

// --- los pares que de verdad existen en la interfaz -------------------------

const SUPERFICIES = ['bg', 'surface', 'surface-2'];

/** Devuelve [{ que, texto, fondo }] para un tema. */
function pares(t) {
  const lista = [];
  const añadir = (que, texto, fondo) => lista.push({ que, texto, fondo });

  // Texto corriente sobre las tres superficies. `--muted` es el que más duele:
  // subtítulos de página, cabeceras de columna, estados vacíos, ayudas y horas.
  for (const s of SUPERFICIES) {
    añadir(`ink sobre ${s}`, t.ink, t[s]);
    añadir(`ink-soft sobre ${s}`, t['ink-soft'], t[s]);
    añadir(`muted sobre ${s}`, t.muted, t[s]);
    añadir(`accent como texto sobre ${s}`, t.accent, t[s]);
    añadir(`danger como texto sobre ${s}`, t.danger, t[s]);
    añadir(`warn como texto sobre ${s}`, t.warn, t[s]);
  }

  // El acento también se usa de texto sobre su propio tinte (pestaña activa de
  // un módulo, .badge.on, el rol en la ficha de usuario).
  añadir('accent sobre accent-soft', t.accent, t['accent-soft']);
  // Y de fondo, con --on-accent encima: el botón primario.
  añadir('on-accent sobre accent (botón primario)', t['on-accent'], t.accent);
  añadir('on-accent sobre accent-deep (botón primario, hover)', t['on-accent'], t['accent-deep']);

  // Las cinco etiquetas de estado, cada una contra su propio fondo.
  for (const fam of ['info', 'warn', 'ok', 'teal', 'danger']) {
    añadir(`etiqueta ${fam}`, t[`tag-${fam}-fg`], t[`tag-${fam}-bg`]);
  }

  // Pestaña activa de la barra: el color del módulo sobre un tinte del 14% de
  // ese mismo color (ver `.nav a.active` en shell.scss).
  for (const m of ['recepcion', 'despacho', 'consulta', 'recursos', 'panel', 'mapa',
                   'catalogos', 'admin', 'plataforma', 'monitor', 'chat']) {
    const c = t[`mod-${m}`];
    añadir(`pestaña ${m}`, c, mezclar(c, t.surface, 0.14));
  }

  return lista;
}

// --- informe ----------------------------------------------------------------

// Y cada par que se va a medir tiene que existir: un token que se renombre en
// styles.scss debe romper esto, no desaparecer del informe en silencio.
for (const [nombre, t] of [['claro', claro], ['oscuro', oscuro]]) {
  const faltan = pares(t).filter((p) => !p.texto || !p.fondo);
  if (faltan.length) {
    console.error(`Tema ${nombre}: ${faltan.length} par(es) con un token que ya no existe:`);
    faltan.forEach((p) => console.error(`  · ${p.que}`));
    process.exit(2);
  }
}

const breve = process.argv.includes('--breve');
let fallos = 0;

for (const [nombre, t] of [['claro', claro], ['oscuro', oscuro]]) {
  const lista = pares(t);
  const malos = [];
  if (!breve) console.log(`\n── tema ${nombre} ──`);
  for (const { que, texto, fondo } of lista) {
    if (!texto || !fondo) {
      console.error(`  ${que}: token sin valor — revise styles.scss`);
      fallos++;
      continue;
    }
    const v = contraste(texto, fondo);
    const pasa = v >= MINIMO;
    if (!pasa) { malos.push({ que, v, texto, fondo }); fallos++; }
    if (!breve) {
      console.log(`  ${pasa ? ' ' : '✗'} ${que.padEnd(42)} ${v.toFixed(2).padStart(6)}  ${texto} / ${fondo}`);
    }
  }
  if (breve && malos.length) {
    console.log(`── tema ${nombre}: ${malos.length} par(es) por debajo de ${MINIMO} ──`);
    malos.forEach((m) => console.log(`  ✗ ${m.que.padEnd(42)} ${m.v.toFixed(2)}  ${m.texto} / ${m.fondo}`));
  }
}

console.log(
  fallos === 0
    ? `\nTodos los pares llegan a ${MINIMO}:1 (WCAG 2.1 AA para texto normal).`
    : `\n${fallos} par(es) por debajo de ${MINIMO}:1. Oscurezca el color de texto o aclare el fondo.`,
);
process.exit(fallos === 0 ? 0 : 1);
