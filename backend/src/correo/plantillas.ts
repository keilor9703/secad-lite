import { MensajeCorreo } from './correo.service';

/**
 * Los dos correos que manda FALCON CAD hoy.
 *
 * Escritos a mano, sin motor de plantillas: son dos, y una dependencia más
 * para interpolar cuatro variables no se paga. Van con estilos en línea
 * porque ningún cliente de correo respeta una hoja aparte, y con tabla de un
 * solo ancho porque es lo único que se ve igual en Outlook y en un teléfono.
 *
 * Lo que NUNCA va en estos correos: una contraseña. Esa es la razón de ser de
 * todo este módulo.
 */

const MARCA = '#0f6b7b';

function envolver(titulo: string, cuerpo: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17242b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #dfe5e8">
<tr><td style="padding:24px 28px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${MARCA};font-weight:600">FALCON CAD</p>
<h1 style="margin:0 0 16px;font-size:19px;font-weight:600">${titulo}</h1>
${cuerpo}
</td></tr></table>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#6b7a82;text-align:center">
Si usted no esperaba este mensaje, ignórelo: el enlace caduca solo y nadie puede entrar con él.
</p></body></html>`;
}

function boton(url: string, texto: string): string {
  return `<p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;padding:11px 22px;background:${MARCA};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">${texto}</a></p>
<p style="margin:0 0 20px;font-size:12px;color:#6b7a82;word-break:break-all">Si el botón no funciona, copie esta dirección en su navegador:<br>${url}</p>`;
}

/** Invitación: la cuenta existe, falta que su dueño elija contraseña. */
export function plantillaInvitacion(
  nombre: string, username: string, url: string, horas: number,
): MensajeCorreo {
  const html = envolver(
    `Bienvenido, ${escapar(nombre)}`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">Se creó su cuenta en FALCON CAD. Su usuario es <strong>${escapar(username)}</strong>.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55">Para entrar, elija su contraseña. Nadie más la conocerá, ni siquiera quien creó la cuenta.</p>
${boton(url, 'Elegir mi contraseña')}
<p style="margin:0;font-size:13px;color:#6b7a82">El enlace sirve <strong>una sola vez</strong> y vence en ${horas} horas. Si se le pasa, pídale a su administrador que se lo reenvíe.</p>`,
  );
  const texto = `FALCON CAD

Bienvenido, ${nombre}.

Se creó su cuenta. Su usuario es: ${username}

Elija su contraseña aquí:
${url}

El enlace sirve una sola vez y vence en ${horas} horas.
Si usted no esperaba este mensaje, ignórelo.`;
  return { para: '', asunto: 'Su cuenta de FALCON CAD está lista', html, texto };
}

/** Recuperación: la cuenta ya existía y su dueño olvidó la contraseña. */
export function plantillaRecuperacion(
  nombre: string, username: string, url: string, horas: number,
): MensajeCorreo {
  const html = envolver(
    'Restablecer su contraseña',
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">Alguien pidió restablecer la contraseña de <strong>${escapar(username)}</strong>. Si fue usted, continúe:</p>
${boton(url, 'Elegir una contraseña nueva')}
<p style="margin:0;font-size:13px;color:#6b7a82">El enlace sirve <strong>una sola vez</strong> y vence en ${horas === 1 ? 'una hora' : `${horas} horas`}. Si no fue usted, no haga nada: su contraseña actual sigue funcionando.</p>`,
  );
  const texto = `FALCON CAD

Alguien pidió restablecer la contraseña de: ${username}

Si fue usted, continúe aquí:
${url}

El enlace sirve una sola vez y vence en ${horas === 1 ? 'una hora' : `${horas} horas`}.
Si no fue usted, no haga nada: su contraseña actual sigue funcionando.`;
  return { para: '', asunto: 'Restablecer su contraseña de FALCON CAD', html, texto };
}

/**
 * Escapa lo que viene de la base antes de meterlo en el HTML. El nombre lo
 * teclea un administrador, así que es texto de otra persona dentro de un
 * documento: sin esto, un nombre con `<` rompe el correo en el mejor caso.
 */
function escapar(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
