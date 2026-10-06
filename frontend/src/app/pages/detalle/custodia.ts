/**
 * Una grabación que ya no está en línea.
 *
 * No es un error: el archivo existe, está íntegro y el caso sabe exactamente
 * cuál es. Lo que pasa es que sus bytes se movieron al archivo permanente
 * —la NAS— porque la política es que NADA se borra nunca, y eso significa
 * sacarlo de la nube cuando ya hay copia verificada fuera.
 *
 * El operador tiene que poder leer el NOMBRE con el que está guardada, porque
 * es lo que le va a pedir al administrador. Decirle «no se pudo descargar» le
 * haría pensar que se perdió.
 */
export interface GrabacionEnCustodia {
  /** Nombre exacto con el que está archivada. Es lo que se pide. */
  archivo: string;
  /** Para comprobar, al recibirla, que es byte a byte la que se grabó. */
  sha256: string | null;
}

/**
 * Saca el aviso de custodia del cuerpo de un error del backend.
 *
 * Devuelve `null` para cualquier otro fallo: una descarga rota de verdad no
 * puede disfrazarse de «pídasela al administrador», o el administrador se
 * pasaría la tarde buscando algo que no existe.
 */
export function leerCustodia(cuerpo: unknown): GrabacionEnCustodia | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const c = cuerpo as Record<string, unknown>;
  if (c['motivo'] !== 'EN_CUSTODIA') return null;
  const archivo = typeof c['archivo'] === 'string' ? c['archivo'].trim() : '';
  if (!archivo) return null;
  return { archivo, sha256: typeof c['sha256'] === 'string' ? c['sha256'] : null };
}

/**
 * El cuerpo del error llega como Blob cuando la petición pidió `blob`, que es
 * lo que hace la descarga de una grabación. Sin esto, el JSON del backend se
 * quedaría sin leer y el aviso nunca aparecería.
 */
export async function cuerpoDeError(cuerpo: unknown): Promise<unknown> {
  if (cuerpo instanceof Blob) {
    try { return JSON.parse(await cuerpo.text()); } catch { return null; }
  }
  return cuerpo;
}
