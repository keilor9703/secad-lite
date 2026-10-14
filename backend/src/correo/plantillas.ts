import { MensajeCorreo } from './correo.service';

/**
 * Los correos que manda FALCON CAD.
 *
 * Un correo transaccional de una plataforma de emergencias lo abre un
 * funcionario público, a veces en el turno de noche, y decide si confía en el
 * enlace que trae. Eso impone una estética concreta: **sobriedad**. Un acento
 * y nada más, mucho blanco, la información presentada como datos, y cero
 * adornos. Un correo con degradados, emoji y signos de admiración se lee como
 * promoción; uno con un panel de datos y una nota de seguridad al pie se lee
 * como un sistema institucional.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DECISIONES QUE NO SON DE GUSTO:
 *
 *  - **Sin imágenes, ni el logo.** La mayoría de los clientes de correo
 *    bloquean las imágenes hasta que el lector las autoriza. Un encabezado que
 *    depende de un PNG se ve roto en la primera impresión, que es justo la que
 *    decide si el mensaje parece legítimo. El membrete es tipográfico y se ve
 *    igual siempre.
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
 *    encuentre — normalmente «Si el botón no funciona…», que da pésima
 *    impresión antes de abrir.
 *
 * Y lo de siempre: aquí NUNCA va una contraseña.
 * ────────────────────────────────────────────────────────────────────────────
 */

// Paleta tomada de la aplicación (frontend/src/styles.scss), no inventada.
const ACENTO = '#0c7e92';
const ACENTO_HONDO = '#0a6273';
const TINTA = '#102639';
const TINTA_SUAVE = '#42566b';
const APAGADO = '#6a7d90';
const BORDE = '#dce5ee';
const FONDO = '#f3f6f9';
const PAPEL = '#ffffff';

const FUENTE = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

interface Dato { etiqueta: string; valor: string }

/**
 * El marco común. `preencabezado` es el resumen de una línea que se ve en la
 * bandeja; `datos` es el panel institucional de usuario y vigencia.
 */
function documento(opciones: {
  titulo: string;
  preencabezado: string;
  entrada: string;
  datos: Dato[];
  textoBoton: string;
  url: string;
  nota: string;
}): string {
  const { titulo, preencabezado, entrada, datos, textoBoton, url, nota } = opciones;

  const filas = datos.map((d) => `
            <tr>
              <td class="apagado linea" style="padding:9px 0;border-bottom:1px solid ${BORDE};font-size:13px;color:${APAGADO};white-space:nowrap">${escapar(d.etiqueta)}</td>
              <td class="tinta linea" style="padding:9px 0;border-bottom:1px solid ${BORDE};font-size:14px;color:${TINTA};font-weight:600;text-align:right">${escapar(d.valor)}</td>
            </tr>`).join('');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapar(titulo)}</title>
<style>
  @media (max-width:620px){
    .marco{width:100%!important}
    .relleno{padding-left:24px!important;padding-right:24px!important}
  }
  @media (prefers-color-scheme:dark){
    .lienzo{background:#0d1620!important}
    .marco{background:#16222e!important;border-color:#24323f!important}
    .tinta{color:#e8eef4!important}
    .suave,.apagado{color:#9fb0c0!important}
    .linea{border-color:#24323f!important}
    .urlcaja{background:#101a24!important;border-color:#24323f!important}
  }
</style>
</head>
<body class="lienzo" style="margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapar(preencabezado)}</div>

<table role="presentation" class="lienzo" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FONDO}">
<tr><td align="center" style="padding:32px 16px">

  <table role="presentation" class="marco" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:600px;max-width:600px;background:${PAPEL};border:1px solid ${BORDE};border-radius:6px">

    <!-- Membrete -->
    <tr><td class="relleno" style="padding:28px 40px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:${FUENTE};font-size:17px;font-weight:700;letter-spacing:.11em;color:${TINTA}" class="tinta">FALCON<span style="color:${ACENTO}">&nbsp;CAD</span></td>
        <td align="right" style="font-family:${FUENTE};font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:${APAGADO}" class="apagado">Central de despacho</td>
      </tr></table>
    </td></tr>
    <tr><td class="relleno" style="padding:16px 40px 0">
      <div class="linea" style="height:2px;background:${ACENTO};width:44px;font-size:0;line-height:0">&nbsp;</div>
    </td></tr>

    <!-- Cuerpo -->
    <tr><td class="relleno" style="padding:22px 40px 0;font-family:${FUENTE}">
      <h1 class="tinta" style="margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:600;color:${TINTA}">${escapar(titulo)}</h1>
      <p class="suave" style="margin:0 0 22px;font-size:15px;line-height:1.6;color:${TINTA_SUAVE}">${entrada}</p>
    </td></tr>

    <!-- Datos -->
    <tr><td class="relleno" style="padding:0 40px">
      <table role="presentation" class="linea" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="font-family:${FUENTE};border-top:1px solid ${BORDE}">${filas}
      </table>
    </td></tr>

    <!-- Acción -->
    <tr><td class="relleno" align="center" style="padding:28px 40px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${ACENTO};border-radius:6px">
          <a href="${url}" style="display:inline-block;padding:13px 30px;font-family:${FUENTE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;border:1px solid ${ACENTO_HONDO}">${escapar(textoBoton)}</a>
        </td>
      </tr></table>
    </td></tr>

    <!-- Respaldo del enlace -->
    <tr><td class="relleno" style="padding:22px 40px 0;font-family:${FUENTE}">
      <p class="apagado" style="margin:0 0 7px;font-size:12px;color:${APAGADO}">O copie esta dirección en su navegador:</p>
      <div class="urlcaja apagado" style="padding:10px 12px;background:${FONDO};border:1px solid ${BORDE};border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:${TINTA_SUAVE};word-break:break-all">${url}</div>
    </td></tr>

    <!-- Nota de seguridad -->
    <tr><td class="relleno" style="padding:24px 40px 0;font-family:${FUENTE}">
      <div class="linea" style="border-top:1px solid ${BORDE};padding-top:16px">
        <p class="apagado" style="margin:0;font-size:12.5px;line-height:1.6;color:${APAGADO}">${nota}</p>
      </div>
    </td></tr>

    <tr><td class="relleno" style="padding:20px 40px 28px;font-family:${FUENTE}">
      <p class="apagado" style="margin:0;font-size:11.5px;line-height:1.6;color:${APAGADO}">
        Mensaje automático de FALCON CAD. No responda a este correo.
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

/** La versión en texto plano. No es un descarte: varios filtros puntúan peor un correo sin ella. */
function textoPlano(opciones: {
  titulo: string; entrada: string; datos: Dato[]; url: string; nota: string;
}): string {
  const ancho = Math.max(...opciones.datos.map((d) => d.etiqueta.length));
  const datos = opciones.datos.map((d) => `  ${d.etiqueta.padEnd(ancho)}   ${d.valor}`).join('\n');
  return `FALCON CAD · Central de despacho
${'─'.repeat(42)}

${opciones.titulo.toUpperCase()}

${sinEtiquetas(opciones.entrada)}

${datos}

${opciones.url}

${'─'.repeat(42)}
${sinEtiquetas(opciones.nota)}

Mensaje automático de FALCON CAD. No responda a este correo.`;
}

/** Invitación: la cuenta existe y falta que su dueño defina su contraseña. */
export function plantillaInvitacion(
  nombre: string, username: string, url: string, horas: number,
): MensajeCorreo {
  const titulo = 'Su cuenta está lista';
  const entrada = `${escapar(primerNombre(nombre))}, se creó su cuenta en FALCON CAD. `
    + 'Para entrar por primera vez, defina su contraseña: será suya y nadie más la conocerá, '
    + 'tampoco quien creó la cuenta.';
  const datos: Dato[] = [
    { etiqueta: 'Usuario', valor: username },
    { etiqueta: 'Vigencia del enlace', valor: vigencia(horas) },
  ];
  const nota = 'El enlace puede usarse <strong>una sola vez</strong>. '
    + 'Si vence antes de que lo use, pida a su administrador que se lo reenvíe. '
    + 'Si usted no esperaba este mensaje, ignórelo: nadie puede entrar con él.';

  return {
    para: '',
    asunto: `Active su cuenta de FALCON CAD · ${username}`,
    html: documento({
      titulo, preencabezado: `Defina la contraseña de su usuario ${username}. El enlace vence en ${vigencia(horas)}.`,
      entrada, datos, textoBoton: 'Definir mi contraseña', url, nota,
    }),
    texto: textoPlano({ titulo, entrada, datos, url, nota }),
  };
}

/** Recuperación: la cuenta ya existía y su dueño olvidó la contraseña. */
export function plantillaRecuperacion(
  nombre: string, username: string, url: string, horas: number,
): MensajeCorreo {
  const titulo = 'Restablecer su contraseña';
  const entrada = `Se recibió una solicitud para restablecer la contraseña del usuario `
    + `<strong>${escapar(username)}</strong>. Si fue usted, continúe con el botón.`;
  const datos: Dato[] = [
    { etiqueta: 'Usuario', valor: username },
    { etiqueta: 'Vigencia del enlace', valor: vigencia(horas) },
  ];
  const nota = 'El enlace puede usarse <strong>una sola vez</strong>. '
    + 'Si no fue usted quien lo solicitó, no haga nada: su contraseña actual sigue vigente '
    + 'y nadie puede entrar con este mensaje.';

  return {
    para: '',
    asunto: `Restablecer la contraseña de ${username} · FALCON CAD`,
    html: documento({
      titulo, preencabezado: `Enlace para definir una contraseña nueva. Vence en ${vigencia(horas)}.`,
      entrada, datos, textoBoton: 'Definir una contraseña nueva', url, nota,
    }),
    texto: textoPlano({ titulo, entrada, datos, url, nota }),
  };
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
  return String(nombre ?? '').trim().split(/\s+/)[0] || 'Buen día';
}

/**
 * Escapa lo que viene de la base antes de meterlo en el HTML. El nombre lo
 * teclea un administrador: es texto de otra persona dentro de un documento, y
 * sin esto un nombre con `<` rompe el correo en el mejor caso.
 */
function escapar(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Para la versión en texto: quita el marcado que el HTML sí usa. */
function sinEtiquetas(v: string): string {
  return String(v ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
