/**
 * ¿La URL del almacén de objetos tiene la forma de un PAR de cubo?
 *
 * Esto nació de un fallo real y silencioso: la variable acabó con la URL
 * pegada DOS veces. El `PUT` funcionó, el `GET` de verificación también
 * —ambos usaban la misma ruta mal formada— así que diez grabaciones se
 * archivaron sin perder un byte, pero con nombres como
 * `https://objectstorage…/o/grabaciones/…`. Nadie se enteró hasta mirar el
 * cubo. Un fallo que pasa todas las comprobaciones y solo se ve de lejos es el
 * peor tipo de fallo.
 *
 * Por eso la URL se revisa ANTES de usarla. Si no tiene forma de PAR de cubo,
 * el archivado no arranca y lo dice, en vez de llenar el cubo de basura.
 */

export interface RevisionUrl {
  ok: boolean;
  /** Qué está mal, en palabras que sirvan para arreglarlo. Vacío si está bien. */
  motivo: string;
}

const BIEN: RevisionUrl = { ok: true, motivo: '' };

export function revisarUrlAlmacen(valor: string): RevisionUrl {
  const v = (valor ?? '').trim().replace(/\/+$/, '');
  if (!v) return { ok: false, motivo: 'está vacía' };

  // La URL pegada dos veces es EL fallo que motivó esto. Se mira primero
  // porque produce objetos con nombres absurdos sin fallar en ningún sitio.
  const esquemas = v.match(/:\/\//g);
  if (esquemas && esquemas.length > 1) {
    return { ok: false, motivo: 'contiene la URL más de una vez (¿pegada dos veces?)' };
  }

  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, motivo: 'no es una URL válida' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, motivo: `el esquema «${url.protocol}» no sirve; debe ser https` };
  }

  const partes = url.pathname.split('/').filter(Boolean);
  if (partes[0] !== 'p') {
    return { ok: false, motivo: 'no parece una solicitud previamente autenticada (falta /p/)' };
  }
  if (!partes.includes('b')) {
    return { ok: false, motivo: 'no apunta a un cubo (falta /b/<nombre>)' };
  }
  // Un PAR de CUBO termina en /o: es donde empieza el nombre del objeto. Si no
  // está, es un PAR de objeto único y solo serviría para una grabación.
  if (partes[partes.length - 1] !== 'o') {
    return {
      ok: false,
      motivo: 'debe terminar en /o — ¿creó el enlace para un objeto en vez de para el cubo?',
    };
  }
  return BIEN;
}
