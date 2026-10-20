import { MensajeCorreo } from './correo.service';

/**
 * Los correos que manda FALCON CAD.
 *
 * Un correo transaccional de una plataforma de emergencias lo abre un
 * funcionario público, a veces en el turno de noche, y decide en dos segundos
 * si confía en el enlace que trae. Eso impone una estética concreta: una
 * franja institucional con la marca arriba, el mensaje en una frase que se lee
 * sin esfuerzo, mucho blanco debajo, una sola acción, y cero adornos. Un
 * correo con degradados, emoji y signos de admiración se lee como promoción;
 * este tiene que leerse como un sistema del que depende un turno.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DECISIONES QUE NO SON DE GUSTO:
 *
 *  - **El águila es un adorno, no el membrete.** La mayoría de los clientes de
 *    correo —Outlook siempre, Gmail en varios casos— bloquean las imágenes
 *    hasta que el lector las autoriza. Por eso el logotipo va JUNTO a la
 *    palabra «FALCON CAD» escrita en texto, nunca en su lugar: con la imagen
 *    bloqueada la franja sigue diciendo de quién es el correo, que es lo que
 *    decide si parece legítimo. Y por eso el `alt` del águila va vacío: un
 *    «[Logo de FALCON CAD]» al lado del nombre escrito es ruido para quien usa
 *    lector de pantalla.
 *  - **Tablas, no divs.** Outlook en Windows maqueta con el motor de Word:
 *    ignora flex, grid y buena parte de los márgenes. Las tablas son lo único
 *    que se ve igual en los dos mundos.
 *  - **Estilos en línea.** Gmail descarta hojas de estilo en varios contextos.
 *    El `<style>` del encabezado solo lleva mejoras que pueden faltar sin que
 *    el correo se rompa (modo oscuro, ancho de teléfono).
 *  - **Botón «a prueba de balas»**: el relleno va en el `<td>`, no en el `<a>`,
 *    porque Outlook descarta el relleno de un enlace y el botón queda como
 *    texto suelto.
 *  - **Preencabezado**: la línea que el buzón muestra junto al asunto en la
 *    lista. Sin ella, el cliente rellena ese espacio con el primer texto que
 *    encuentre — normalmente «Si el botón no abre…», que da pésima impresión
 *    antes de abrir.
 *  - **El enlace completo, a la vista.** Debajo del botón va la dirección
 *    entera y legible. No es un respaldo por si el botón falla: es la forma de
 *    que quien recibe pueda LEER a dónde lo mandan antes de pulsar, que es
 *    exactamente lo que se le pide a un funcionario que desconfíe de un correo.
 *
 * Y lo de siempre: aquí NUNCA va una contraseña.
 * ────────────────────────────────────────────────────────────────────────────
 */

// Paleta: azul marino y turquesa del kit de marca
// (frontend/public/kit-marca-aguila/LEEME.txt), tinta y acento de la
// aplicación (frontend/src/styles.scss). Nada inventado para el correo.
const MARINO = '#0e2a47';
const TURQUESA = '#2bc4d4';
/** La mitad de arriba de la tarjeta: teal muy lavado, para separar sin gritar. */
const CABECERA = '#e4f2f2';
/**
 * El acento. Es el `--accent` del tema claro de la aplicación, no un teal
 * inventado para el correo, y llega a 4,5:1 en los TRES fondos donde se usa:
 * la cabecera teal (4,86), el papel blanco (5,59) y de fondo con texto blanco
 * encima en el botón (5,59). Con el anterior (#0c7e92) la cabecera daba 4,14.
 */
const ACENTO = '#0a7285';
const ACENTO_HONDO = '#095a69';
const TINTA = '#102639';
const TINTA_SUAVE = '#42566b';
// Medido, no elegido a ojo: este gris tiene que llegar a 4,5:1 sobre el papel
// blanco Y sobre el fondo gris, porque se usa en los dos — rótulos y nota
// dentro de la tarjeta, pie fuera de ella. Con #5f7286 el pie daba 4,41.
const APAGADO = '#5b6e82';
const BORDE = '#dce5ee';
const FONDO = '#eef2f7';
const PAPEL = '#ffffff';

/**
 * La paleta, expuesta para poder MEDIRLA.
 *
 * `plantillas.spec.ts` comprueba el contraste de los pares que de verdad
 * existen en el correo, igual que `scripts/contraste.mjs` hace con la
 * aplicación. Un correo se lee en el turno de noche y en el teléfono de
 * alguien que va en un carro: un gris que «se ve bien» en el monitor del que
 * lo escribió no es un criterio.
 */
export const PALETA_CORREO = {
  MARINO,
  TURQUESA,
  CABECERA,
  ACENTO,
  ACENTO_HONDO,
  TINTA,
  TINTA_SUAVE,
  APAGADO,
  BORDE,
  FONDO,
  PAPEL,
  BLANCO: '#ffffff',
} as const;

const FUENTE = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace`;

/**
 * El águila, servida desde el propio dominio.
 *
 * Tiene que ser una URL pública y absoluta: un `data:` incrustado lo descartan
 * Gmail y Outlook, y un `cid:` exige mandar el archivo como adjunto en cada
 * envío. Vive en el frontend (`public/kit-marca-aguila/aguila-correo.png`), así
 * que la publica el mismo despliegue que sirve la aplicación — y si ese
 * despliegue no está al día, lo único que pasa es que la franja se ve sin
 * águila, con el nombre escrito en su sitio.
 */
function logoUrl(): string {
  const propio = (process.env.CORREO_LOGO_URL ?? '').trim();
  if (propio) return propio;
  const base = (process.env.URL_PUBLICA ?? '').replace(/\/+$/, '');
  return base ? `${base}/kit-marca-aguila/aguila-correo.png` : '';
}

/**
 * A dónde contesta quien recibe un correo del sistema.
 *
 * Un `no-reply` es cómodo para quien lo manda y malo para todo lo demás: la
 * persona que contesta «no me llegó nada» le escribe al vacío, y los buzones
 * grandes puntúan peor a un remitente al que nadie puede responder. Por
 * defecto, las respuestas caen en la mesa de ayuda — que es a donde iban a ir
 * de todos modos, pero por teléfono.
 *
 * Con `CORREO_RESPONDER_A=` (vacío, declarada a propósito) se vuelve al
 * comportamiento de antes y el pie lo dice.
 */
function responderA(): string {
  const propio = process.env.CORREO_RESPONDER_A;
  if (propio !== undefined) return propio.trim();
  return (process.env.SOPORTE_CORREO ?? 'soporte@falconcad.com.co').trim();
}

/** El cierre, acorde con lo anterior: no se promete una respuesta que no existe. */
function piePorDefecto(): string {
  // Va detrás de «FALCON CAD · Central de despacho ·», así que no repite la marca.
  return responderA()
    ? 'Mensaje automático · Puede responder a este correo'
    : 'Mensaje automático · No responda a este correo';
}

interface Dato {
  etiqueta: string;
  valor: string;
}

/**
 * Un bloque de texto tal como lo escribió alguien: el relato de un ticket, el
 * contexto técnico de una pantalla. Va en monoespaciada y respetando los
 * saltos de línea — un informe alineado en columnas queda ilegible si el
 * cliente de correo le colapsa los espacios.
 */
interface Bloque {
  titulo: string;
  texto: string;
}

/**
 * El marco común de todos los correos: dos tonos.
 *
 * Arriba, la marca sola sobre el fondo. Debajo, una tarjeta partida en dos: la
 * mitad superior en teal lavado lleva el saludo, el titular, la frase y el
 * dato que la persona vino a buscar; la inferior, en blanco, lleva la única
 * acción y nada más. La nota y el pie quedan FUERA de la tarjeta, en gris:
 * son letra pequeña y tienen que parecerlo.
 *
 * El corte entre los dos tonos hace el trabajo que antes hacía una franja
 * oscura, sin el peso: el ojo encuentra dónde empieza lo que hay que leer y
 * dónde está lo que hay que pulsar, sin que el correo parezca una valla.
 *
 * Casi todo es opcional porque los cuatro correos no se parecen: la invitación
 * tiene botón y un usuario destacado; el aviso de un ticket no tiene ninguna
 * acción y sí dos bloques de texto largo.
 */
function documento(opciones: {
  /** «Hola, Juan». Pequeño, encima del titular; se omite si no hay a quién saludar. */
  saludo?: string;
  titulo: string;
  /** Segunda línea del titular, en el acento. Dice de qué va, no qué hacer. */
  tituloAcento?: string;
  preencabezado: string;
  entrada: string;
  /** El dato que la persona vino a buscar: su usuario, el número del reporte. */
  destacado?: Dato;
  datos?: Dato[];
  bloques?: Bloque[];
  textoBoton?: string;
  url?: string;
  /** Letra pequeña bajo el botón, a la izquierda: «Vence en 72 horas». */
  bajoBoton?: string;
  /** Y a la derecha: «Enlace de un solo uso». */
  bajoBotonDerecha?: string;
  nota: string;
  /** El cierre. Por defecto «no responda»; los correos de un ticket sí se responden. */
  pie?: string;
}): string {
  const {
    saludo,
    titulo,
    tituloAcento,
    preencabezado,
    entrada,
    destacado,
    datos,
    bloques,
    textoBoton,
    url,
    bajoBoton,
    bajoBotonDerecha,
    nota,
  } = opciones;
  const pie = opciones.pie ?? piePorDefecto();
  const logo = logoUrl();

  // El monograma: cuadrado marino con el águila. Con las imágenes bloqueadas
  // —Outlook, por defecto— el cuadrado sigue pintándose y al lado sigue
  // estando el nombre escrito, que es lo que dice de quién es el correo.
  const monograma = `
        <td width="38" valign="middle" style="padding-right:11px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="38" height="38" align="center" valign="middle"
                style="width:38px;height:38px;background:${MARINO};border-radius:9px;line-height:0">${
                  logo
                    ? `<img src="${logo}" width="26" height="25" alt="" style="display:block;width:26px;height:25px;border:0">`
                    : '&nbsp;'
                }</td>
          </tr></table>
        </td>`;

  const hola = !saludo
    ? ''
    : `
      <p style="margin:0 0 8px;font-family:${FUENTE};font-size:14px;font-weight:600;color:${ACENTO}" class="acento">${escapar(saludo)}</p>`;

  const segundaLinea = !tituloAcento
    ? ''
    : `
        <span style="display:block;color:${ACENTO}" class="acento">${escapar(tituloAcento)}</span>`;

  // El dato, en una pastilla blanca sobre el teal: se despega del fondo sin
  // necesidad de un recuadro con borde. Monoespaciada porque un usuario se
  // copia a mano, y ahí la diferencia entre l, 1 e I deja de ser un detalle.
  const elDestacado = !destacado
    ? ''
    : `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr>
        <td style="background:${PAPEL};border-radius:10px;padding:11px 15px;font-family:${FUENTE}" class="pastilla">
          <span style="font-size:13px;color:${APAGADO}" class="apagado">${escapar(destacado.etiqueta)}</span>
          <span style="font-family:${MONO};font-size:15px;font-weight:600;color:${TINTA};padding-left:8px" class="tinta">${escapar(destacado.valor)}</span>
        </td>
      </tr></table>`;

  const filas = (datos ?? [])
    .map(
      (d) => `
            <tr>
              <td class="apagado linea" style="padding:9px 0;border-bottom:1px solid ${BORDE};font-size:13px;color:${APAGADO};white-space:nowrap;vertical-align:top">${escapar(d.etiqueta)}</td>
              <td class="tinta linea" style="padding:9px 0 9px 16px;border-bottom:1px solid ${BORDE};font-size:14px;color:${TINTA};font-weight:600;text-align:right">${escapar(d.valor)}</td>
            </tr>`,
    )
    .join('');

  const tabla = !filas
    ? ''
    : `
      <table role="presentation" class="linea" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="font-family:${FUENTE};border-top:1px solid ${BORDE};margin:0 0 24px">${filas}
      </table>`;

  const cajas = (bloques ?? [])
    .map(
      (b) => `
      <p class="apagado" style="margin:0 0 7px;font-family:${FUENTE};font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:${APAGADO}">${escapar(b.titulo)}</p>
      <div class="caja suave" style="margin:0 0 22px;padding:14px 16px;background:${FONDO};border-radius:10px;font-family:${MONO};font-size:12px;line-height:1.55;color:${TINTA_SUAVE};white-space:pre-wrap;word-break:break-word">${escapar(b.texto)}</div>`,
    )
    .join('');

  // Botón de ancho completo, como en el resto del sistema: en un teléfono, un
  // botón que ocupa la línea entera no se falla con el pulgar.
  const accion = !url
    ? ''
    : `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" style="background:${ACENTO};border-radius:10px">
          <a href="${url}" style="display:block;padding:15px 24px;font-family:${FUENTE};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;border:1px solid ${ACENTO_HONDO}">${escapar(textoBoton ?? 'Continuar')}</a>
        </td>
      </tr></table>
      ${
        !bajoBoton && !bajoBotonDerecha
          ? ''
          : `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0"><tr>
        <td class="apagado" style="font-family:${FUENTE};font-size:13px;color:${APAGADO}">${bajoBoton ?? ''}</td>
        <td class="apagado" align="right" style="font-family:${FUENTE};font-size:13px;color:${APAGADO}">${bajoBotonDerecha ?? ''}</td>
      </tr></table>`
      }
      <div class="linea" style="border-top:1px solid ${BORDE};margin:22px 0 18px;font-size:0;line-height:0">&nbsp;</div>
      <p class="apagado" style="margin:0 0 6px;font-family:${FUENTE};font-size:13px;color:${APAGADO}">Si el botón no abre, copie este enlace:</p>
      <p class="enlace" style="margin:0;font-family:${MONO};font-size:12.5px;line-height:1.5;color:${ACENTO};word-break:break-all">${url}</p>`;

  const cuerpo = `${tabla}${cajas}${accion}`;

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapar(titulo)}</title>
<style>
  @media (max-width:620px){
    .marco{width:100%!important}
    .relleno{padding-left:22px!important;padding-right:22px!important}
    .titular{font-size:24px!important}
  }
  @media (prefers-color-scheme:dark){
    .lienzo{background:#0a131c!important}
    .cabecera{background:#13303a!important}
    .cuerpo{background:#16222e!important}
    .pastilla{background:#0d1c26!important}
    .tinta{color:#e8eef4!important}
    .suave{color:#c3d0dc!important}
    .apagado{color:#9fb0c0!important}
    .acento,.enlace{color:#56cfe0!important}
    .linea{border-color:#24323f!important}
    .caja{background:#101a24!important}
  }
</style>
</head>
<body class="lienzo" style="margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapar(preencabezado)}</div>

<table role="presentation" class="lienzo" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FONDO}">
<tr><td align="center" style="padding:32px 16px">

  <table role="presentation" class="marco" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:600px;max-width:600px">

    <!-- Marca, fuera de la tarjeta -->
    <tr><td class="relleno" style="padding:0 4px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${monograma}
        <td valign="middle" style="font-family:${FUENTE};font-size:15px;font-weight:700;letter-spacing:.17em;color:${TINTA}" class="tinta">FALCON<span style="color:${ACENTO}" class="acento">&nbsp;CAD</span></td>
      </tr></table>
    </td></tr>

    <!-- Mitad de arriba: lo que hay que leer -->
    <tr><td class="relleno cabecera" style="padding:30px 34px 32px;background:${CABECERA};border-radius:16px 16px 0 0;font-family:${FUENTE}">${hola}
      <h1 class="titular tinta" style="margin:0 0 14px;font-size:29px;line-height:1.22;font-weight:700;color:${TINTA}">${escapar(titulo)}${segundaLinea}</h1>
      <p class="suave" style="margin:0;font-size:15.5px;line-height:1.6;color:${TINTA_SUAVE}">${entrada}</p>${elDestacado}
    </td></tr>

    <!-- Mitad de abajo: lo que hay que hacer -->
    <tr><td class="relleno cuerpo" style="padding:28px 34px ${accion ? '30' : '8'}px;background:${PAPEL};border-radius:0 0 16px 16px;font-family:${FUENTE}">
      ${cuerpo}
    </td></tr>

    <!-- Nota y pie, fuera de la tarjeta -->
    <tr><td class="relleno" style="padding:20px 6px 0;font-family:${FUENTE}">
      <p class="apagado" style="margin:0 0 6px;font-size:12.5px;line-height:1.6;color:${APAGADO}">${nota}</p>
      <p class="apagado" style="margin:0;font-size:12px;line-height:1.6;color:${APAGADO}">FALCON CAD · Central de despacho · ${pie}</p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

/** La versión en texto plano. No es un descarte: varios filtros puntúan peor un correo sin ella. */
function textoPlano(opciones: {
  saludo?: string;
  titulo: string;
  tituloAcento?: string;
  entrada: string;
  destacado?: Dato;
  datos?: Dato[];
  bloques?: Bloque[];
  url?: string;
  bajoBoton?: string;
  bajoBotonDerecha?: string;
  nota: string;
  pie?: string;
}): string {
  const regla = '─'.repeat(42);
  const partes: string[] = ['FALCON CAD · Central de despacho', regla, ''];
  if (opciones.saludo) partes.push(opciones.saludo, '');
  partes.push(
    [opciones.titulo, opciones.tituloAcento]
      .filter(Boolean)
      .join(' ')
      .toUpperCase(),
    '',
  );
  partes.push(sinEtiquetas(opciones.entrada), '');
  if (opciones.destacado) {
    partes.push(
      `${opciones.destacado.etiqueta.toUpperCase()}: ${opciones.destacado.valor}`,
      '',
    );
  }
  if (opciones.datos?.length) {
    // `Math.max()` sin argumentos devuelve -Infinity, y `padEnd(-Infinity)`
    // deja de alinear sin avisar: un correo sin panel de datos no es raro.
    const ancho = Math.max(...opciones.datos.map((d) => d.etiqueta.length));
    partes.push(
      opciones.datos
        .map((d) => `  ${d.etiqueta.padEnd(ancho)}   ${d.valor}`)
        .join('\n'),
      '',
    );
  }
  for (const b of opciones.bloques ?? []) {
    partes.push(b.titulo.toUpperCase(), regla, b.texto, '');
  }
  if (opciones.url) {
    partes.push(opciones.url, '');
    const pequena = [opciones.bajoBoton, opciones.bajoBotonDerecha]
      .filter(Boolean)
      .map((t) => sinEtiquetas(t as string))
      .join(' · ');
    if (pequena) partes.push(pequena, '');
  }
  partes.push(regla, sinEtiquetas(opciones.nota), '');
  partes.push(
    `FALCON CAD · Central de despacho · ${opciones.pie ?? piePorDefecto()}`,
  );
  return partes.join('\n');
}

import { esGrave, FallaPlanta } from '../pbx/planta/planta-salud.entity';

/** Lo que el aviso de una planta necesita saber para escribirse. */
export interface AvisoPlanta {
  tenant: string;
  dominio: string;
  servidor: string;
  fallas: string[];
  detalle: string;
  operadores: number;
  /** Desde cuándo falla sin interrupción. */
  desde: Date;
}

/** Cada falla, dicha en términos de lo que el ciudadano deja de poder hacer. */
const QUE_SIGNIFICA: Record<string, string> = {
  asterisk:
    'La central no responde. No entran llamadas y el softphone no conecta.',
  troncal:
    'La central responde pero la troncal no está disponible: las llamadas del ' +
    'ciudadano no llegan.',
  'troncal-sin-sondeo':
    'No se puede sondear la troncal, así que no se sabe cómo está. Las ' +
    'llamadas entrantes SÍ siguen llegando —se identifican por IP— pero las ' +
    'salientes y el sondeo no funcionan.',
  certificado:
    'El certificado está por vencer. El día que venza, el softphone deja de ' +
    'conectar en todos los puestos.',
  'certificado-vencido':
    'El certificado venció. El softphone ya no puede conectar.',
};

/**
 * El aviso de que una planta dejó de estar bien.
 *
 * Se manda cuando APARECE una falla, no mientras dura: un correo cada cinco
 * minutos deja de leerse al tercero, y entonces el monitoreo empeora las cosas
 * en vez de mejorarlas.
 *
 * Dice qué dejó de poder hacer el ciudadano, no qué comprobación falló. Quien
 * lo recibe a las tres de la mañana necesita saber si tiene que levantarse.
 */
export function plantillaAvisoPlanta(a: AvisoPlanta): MensajeCorreo {
  // Qué cuenta como grave lo decide la entidad, no esta plantilla: si cada
  // sitio lo decidiera por su cuenta, el correo diría una cosa y la pantalla
  // otra sobre la misma revisión.
  const grave = esGrave(a.fallas as FallaPlanta[]);

  const consecuencias = a.fallas
    .map((f) => QUE_SIGNIFICA[f])
    .filter(Boolean) as string[];

  const entrada = grave
    ? `La planta telefónica de <strong>${escapar(a.tenant)}</strong> no está ` +
      'atendiendo con normalidad.'
    : `La planta telefónica de <strong>${escapar(a.tenant)}</strong> sigue ` +
      'atendiendo, pero hay algo que va a fallar si nadie lo toca.';

  const datos: Dato[] = [
    { etiqueta: 'Instancia', valor: a.tenant },
    { etiqueta: 'Nombre de la planta', valor: a.dominio },
    { etiqueta: 'Servidor', valor: a.servidor },
    { etiqueta: 'Falla desde', valor: fechaLegible(a.desde) },
    {
      etiqueta: 'Operadores conectados',
      valor: String(a.operadores),
    },
  ];

  const comun = {
    titulo: grave
      ? 'La planta no está atendiendo'
      : 'La planta necesita atención',
    tituloAcento: a.tenant,
    entrada,
    destacado: { etiqueta: 'Qué falla', valor: a.fallas.join(' · ') },
    datos,
    bloques: [
      { titulo: 'Qué significa', texto: consecuencias.join('\n\n') },
      { titulo: 'Lo que se midió', texto: a.detalle },
    ],
    // Dónde mirar, sin repetir el manual: el que recibe esto a las tres de la
    // mañana necesita el nombre del documento, no sus veinte pasos.
    nota:
      'El procedimiento de diagnóstico está en <strong>docs/planta-telefonica-despliegue.md</strong>, ' +
      'sección 11. Se mide de abajo hacia arriba y el primer nivel es si existe el socket.',
    pie: 'Revisión automática de plantas',
  };

  return {
    para: '',
    asunto: `${grave ? '🔴' : '🟡'} Planta ${a.tenant} · ${a.fallas.join(', ')}`,
    html: documento({
      ...comun,
      preencabezado: `${a.tenant} · ${a.fallas.join(', ')} · desde ${fechaLegible(a.desde)}`,
    }),
    texto: textoPlano(comun),
  };
}

/** Una fecha que se lee de un vistazo en un correo, sin segundos ni zona. */
function fechaLegible(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return (
    `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${dos(d.getHours())}:${dos(d.getMinutes())}`
  );
}

/** Invitación: la cuenta existe y falta que su dueño defina su contraseña. */
export function plantillaInvitacion(
  nombre: string,
  username: string,
  url: string,
  horas: number,
): MensajeCorreo {
  const comun = {
    saludo: `Hola, ${primerNombre(nombre)}`,
    titulo: 'Su cuenta está lista',
    entrada:
      'Solo falta definir su contraseña. Será solo suya: nadie más la conocerá, ' +
      'tampoco quien creó la cuenta.',
    destacado: { etiqueta: 'Usuario', valor: username },
    url,
    bajoBoton: `Vence en <strong>${vigencia(horas)}</strong>`,
    bajoBotonDerecha: 'Enlace de <strong>un solo uso</strong>',
    nota:
      '¿No esperaba este correo? Ignórelo, nadie puede entrar con él. Si vence, ' +
      'pida a su administrador que lo reenvíe.',
  };

  return {
    para: '',
    responderA: responderA() || undefined,
    asunto: `Active su cuenta de FALCON CAD · ${username}`,
    html: documento({
      ...comun,
      preencabezado: `Defina la contraseña de su usuario ${username}. El enlace vence en ${vigencia(horas)}.`,
      textoBoton: 'Definir mi contraseña',
    }),
    texto: textoPlano(comun),
  };
}

/** Recuperación: la cuenta ya existía y su dueño olvidó la contraseña. */
export function plantillaRecuperacion(
  nombre: string,
  username: string,
  url: string,
  horas: number,
): MensajeCorreo {
  const comun = {
    saludo: `Hola, ${primerNombre(nombre)}`,
    titulo: 'Recupere su acceso',
    entrada:
      `Se recibió una solicitud para restablecer la contraseña del usuario ` +
      `<strong>${escapar(username)}</strong>. Si fue usted, continúe con el botón.`,
    destacado: { etiqueta: 'Usuario', valor: username },
    url,
    bajoBoton: `Vence en <strong>${vigencia(horas)}</strong>`,
    bajoBotonDerecha: 'Enlace de <strong>un solo uso</strong>',
    nota:
      'Si no fue usted quien lo solicitó, no haga nada: su contraseña actual sigue ' +
      'vigente y nadie puede entrar con este mensaje.',
  };

  return {
    para: '',
    responderA: responderA() || undefined,
    asunto: `Restablecer la contraseña de ${username} · FALCON CAD`,
    html: documento({
      ...comun,
      preencabezado: `Enlace para definir una contraseña nueva. Vence en ${vigencia(horas)}.`,
      textoBoton: 'Definir una contraseña nueva',
    }),
    texto: textoPlano(comun),
  };
}

// ── Mesa de ayuda ──────────────────────────────────────────────────────────
// Dos correos por cada reporte: el que lleva el ticket a la mesa y el acuse
// para quien lo abrió. Ninguno de los dos habla de ESTADO, y eso es a
// propósito: todavía no hay herramienta de tickets que lo mantenga, y un
// correo que dijera «estado: abierto» estaría prometiendo un tablero que nadie
// puede consultar. Dice el número, que es lo único que de verdad existe.

/** Lo que la mesa necesita para atender el reporte sin preguntar nada primero. */
export interface TicketCorreo {
  id: string;
  severidad: string;
  severidadTitulo: string;
  compromiso: string;
  relato: string;
  contexto: string;
  instancia: string;
  /** Quién reporta, como lo muestra el sistema: «Juan Pérez (jperez)». */
  quien: string;
  /** Su correo, si la cuenta tiene uno; '' si no. Decide si la mesa puede responder. */
  correoQuien: string;
  pantalla: string;
}

/** El aviso a la mesa: el ticket entero, en un correo que se puede responder. */
export function plantillaTicketMesa(t: TicketCorreo): MensajeCorreo {
  // «Reporte abierto» se leería como un estado de ticket, y no hay ninguno que
  // mantener: el verbo describe quién lo mandó, no en qué situación está.
  const entrada =
    `Reporte enviado desde FALCON CAD por <strong>${escapar(t.quien)}</strong>, ` +
    `en la instancia <strong>${escapar(t.instancia)}</strong>.`;
  const datos: Dato[] = [
    {
      etiqueta: 'Severidad propuesta',
      valor: `${t.severidad} — ${t.severidadTitulo}`,
    },
    { etiqueta: 'Compromiso', valor: t.compromiso },
    { etiqueta: 'Instancia', valor: t.instancia },
    { etiqueta: 'Reportado por', valor: t.quien },
    {
      etiqueta: 'Correo de contacto',
      valor: t.correoQuien || 'la cuenta no tiene correo',
    },
    { etiqueta: 'Pantalla', valor: t.pantalla || '—' },
  ];
  // La severidad la propone quien reporta y la confirma la mesa: lo dice la
  // matriz de docs/mesa-de-ayuda.md, y el correo lo repite donde se decide.
  const nota = t.correoQuien
    ? 'La severidad la propone quien reporta; <strong>la confirma la mesa</strong>. ' +
      'Al responder a este correo, la respuesta le llega a quien lo reportó.'
    : 'La severidad la propone quien reporta; <strong>la confirma la mesa</strong>. ' +
      'La cuenta que reportó no tiene correo registrado: hay que contactarla por otro medio.';
  const comun = {
    titulo: `${t.severidad} · ${t.severidadTitulo}`,
    tituloAcento: t.instancia,
    entrada,
    destacado: { etiqueta: 'Reporte', valor: t.id },
    datos,
    bloques: [
      { titulo: 'Lo que reportó', texto: t.relato },
      { titulo: 'Contexto técnico', texto: t.contexto },
    ],
    nota,
    pie: 'Enviado desde la propia aplicación',
  };

  return {
    para: '',
    responderA: t.correoQuien || undefined,
    asunto: asuntoMesa(t),
    html: documento({
      ...comun,
      preencabezado: `${t.id} · ${t.instancia} · ${resumen(t.relato, 90)}`,
    }),
    texto: textoPlano(comun),
  };
}

/**
 * El acuse para quien reportó. Lleva el número y lo que escribió — no el
 * contexto técnico, que ya vio en pantalla y aquí solo sería un muro — y no
 * promete ningún estado consultable.
 */
export function plantillaTicketAcuse(
  t: TicketCorreo,
  correoMesa: string,
): MensajeCorreo {
  const entrada =
    'Su reporte salió hacia la mesa de ayuda de FALCON CAD. Guarde este ' +
    'número: es con el que se identifica el reporte si hay que hablar de él.';
  const datos: Dato[] = [
    {
      etiqueta: 'Severidad que indicó',
      valor: `${t.severidad} — ${t.severidadTitulo}`,
    },
    { etiqueta: 'Compromiso de respuesta', valor: t.compromiso },
    { etiqueta: 'Instancia', valor: t.instancia },
  ];
  const nota =
    (t.severidad === 'S1'
      ? 'Un reporte crítico se atiende a cualquier hora, pero <strong>por teléfono</strong>: ' +
        'un texto que nadie leyó todavía no es un aviso. Llame además a la línea de soporte. '
      : '') +
    'Si tiene algo más que agregar, responda a este correo: la respuesta llega a la mesa ' +
    'con el número del reporte.';
  const comun = {
    saludo: `Hola, ${primerNombre(t.quien)}`,
    titulo: 'Su reporte llegó',
    tituloAcento: 'a la mesa de ayuda.',
    entrada,
    destacado: { etiqueta: 'Número del reporte', valor: t.id },
    datos,
    bloques: [{ titulo: 'Lo que reportó', texto: t.relato }],
    nota,
    pie: 'Puede responder a este correo',
  };

  return {
    para: '',
    responderA: correoMesa,
    asunto: `Su reporte ${t.id} llegó a la mesa de ayuda · FALCON CAD`,
    html: documento({
      ...comun,
      preencabezado: `Reporte ${t.id} · ${t.severidad} · ${resumen(t.relato, 90)}`,
    }),
    texto: textoPlano(comun),
  };
}

/**
 * El asunto de la mesa. El número y la severidad van primero porque son lo
 * único que sobrevive al recorte de la lista del buzón; el resumen del relato
 * va después, y se recorta para que el asunto entero quepa en lo que muestra
 * un cliente de correo (unos 78 caracteres).
 */
function asuntoMesa(t: TicketCorreo): string {
  const cabeza = `[${t.id}] ${t.severidad} · ${t.instancia}`;
  const queda = 78 - cabeza.length - 3;
  const cola = queda >= 12 ? ` · ${resumen(t.relato, queda)}` : '';
  return `${cabeza}${cola}`;
}

/**
 * La primera línea del relato, recortada. Sirve para el asunto y el
 * preencabezado: lo que se ve antes de abrir el correo.
 */
function resumen(texto: string, tope: number): string {
  const una = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (una.length <= tope) return una;
  // Cortar en el último espacio evita terminar en media palabra.
  const corte = una.slice(0, tope);
  const espacio = corte.lastIndexOf(' ');
  return `${espacio > tope * 0.6 ? corte.slice(0, espacio) : corte}…`;
}

/** «72 horas», «1 hora». Un número suelto junto a la palabra queda mal escrito. */
function vigencia(horas: number): string {
  return horas === 1 ? '1 hora' : `${horas} horas`;
}

/**
 * Solo el nombre de pila para el saludo: «Juan, se creó su cuenta» suena a
 * persona; «Juan Carlos Pérez Gómez, se creó su cuenta» suena a formulario.
 */
function primerNombre(nombre: string): string {
  return (
    String(nombre ?? '')
      .trim()
      .split(/\s+/)[0] || 'Buen día'
  );
}

/**
 * Escapa lo que viene de la base antes de meterlo en el HTML. El nombre lo
 * teclea un administrador: es texto de otra persona dentro de un documento, y
 * sin esto un nombre con `<` rompe el correo en el mejor caso.
 */
function escapar(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Para la versión en texto: quita el marcado que el HTML sí usa. */
function sinEtiquetas(v: string): string {
  return String(v ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
