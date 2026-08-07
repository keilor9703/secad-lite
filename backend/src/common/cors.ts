/**
 * Qué orígenes pueden hablar con la API.
 *
 * `CORS_ORIGINS` es una lista separada por comas; admite comodín de subdominio
 * para los despliegues de vista previa, que cambian de URL en cada commit:
 *
 *   CORS_ORIGINS=https://falcon-cad.vercel.app,https://*.vercel.app,http://localhost:4200
 *
 * Sin la variable no se restringe nada (cómodo en desarrollo). En un despliegue
 * publicado conviene fijarla: es lo único que impide que otra página use la API
 * con la sesión del funcionario.
 */

/** Lista configurada, o null si no hay restricción. */
function lista(): string[] | null {
  const crudo = process.env.CORS_ORIGINS?.trim();
  if (!crudo) return null;
  const entradas = crudo
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return entradas.length ? entradas : null;
}

/** Compara un origen contra un patrón, que puede ser `https://*.dominio.com`. */
function coincide(patron: string, origen: string): boolean {
  if (patron === origen) return true;
  const i = patron.indexOf('://*.');
  if (i < 0) return false;
  const esquema = patron.slice(0, i + 3);
  const dominio = patron.slice(i + 5);
  return origen.startsWith(esquema) && origen.slice(esquema.length).endsWith(`.${dominio}`);
}

/**
 * Callback de origen para `enableCors` y para el gateway de Socket.IO. Las
 * peticiones sin cabecera `Origin` (curl, integraciones servidor a servidor)
 * pasan siempre: CORS solo protege al navegador, y esas ya las gobierna el JWT.
 */
export function origenPermitido(
  origen: string | undefined,
  cb: (err: Error | null, permitido?: boolean) => void,
): void {
  const permitidos = lista();
  if (!permitidos || !origen) return cb(null, true);
  cb(null, permitidos.some((p) => coincide(p, origen.replace(/\/+$/, ''))));
}
