import {
  CampoCredencial, ConfigSoftphone, CredencialesPbx,
  DescriptorProveedor, ProveedorPbx, ResultadoMarcar,
} from './proveedor';

const CREDENCIALES: CampoCredencial[] = [
  {
    clave: 'wss',
    etiqueta: 'WebSocket SIP (wss://)',
    ayuda: 'La dirección de señalización de su centralita. En un Asterisk con el transporte WSS en el 8089 es «wss://centralita.sudominio.com:8089/ws». Tiene que tener certificado válido: el navegador no acepta uno autofirmado.',
    secreto: false,
    requerido: true,
    ejemplo: 'wss://centralita.ejemplo.com:8089/ws',
  },
  {
    clave: 'dominio',
    etiqueta: 'Dominio SIP',
    ayuda: 'El nombre con el que se arma la identidad del operador: sip:101@ESTE-DOMINIO. Normalmente el mismo nombre de la máquina de la centralita.',
    secreto: false,
    requerido: true,
    ejemplo: 'centralita.ejemplo.com',
  },
  {
    clave: 'ariUrl',
    etiqueta: 'URL de ARI (para el botón «Llamar»)',
    ayuda: 'La interfaz REST de Asterisk, normalmente «https://centralita.sudominio.com:8089/ari». Solo hace falta para originar llamadas desde el caso; sin ella, entrantes y softphone funcionan igual.',
    secreto: false,
    requerido: false,
    ejemplo: 'https://centralita.ejemplo.com:8089/ari',
  },
  {
    clave: 'ariUsuario',
    etiqueta: 'Usuario de ARI',
    ayuda: 'El que está en ari.conf de la centralita. No es una extensión: es una cuenta de la API.',
    secreto: false,
    requerido: false,
    ejemplo: 'falcon',
  },
  {
    clave: 'ariClave',
    etiqueta: 'Clave de ARI',
    ayuda: 'La contraseña de ese usuario en ari.conf. Se guarda cifrada y no se vuelve a mostrar.',
    secreto: true,
    requerido: false,
  },
  {
    clave: 'contextoSaliente',
    etiqueta: 'Contexto del dialplan para salientes',
    ayuda: 'El contexto de extensions.conf por donde salen las llamadas al ciudadano. Si lo deja vacío se usa «salientes».',
    secreto: false,
    requerido: false,
    ejemplo: 'salientes',
  },
];

/** Si no se configura otro, es el contexto que trae la plantilla de `deploy/asterisk/`. */
const CONTEXTO_POR_DEFECTO = 'salientes';

/**
 * ASTERISK PROPIO — la centralita que operamos nosotros.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE PROVEEDOR ES EL MÁS CORTO DE TODOS
 *
 * Porque **no tiene traductor de eventos**, y eso no es una omisión: Asterisk
 * es nuestro, así que en vez de adivinar el idioma de una central ajena, el
 * *dialplan* llama directamente al **webhook genérico** de FALCON
 * (`POST /api/pbx/webhook`, autenticado con la API key de la instancia) — el
 * mismo por donde entran hoy las llamadas de YACO, que ya habla el modelo de
 * FALCON. La plantilla de `extensions.conf` está en `deploy/asterisk/`.
 *
 * Dicho de otro modo: con una central ajena el trabajo es traducir; con la
 * propia, el trabajo es hablar bien desde el principio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SÍ HAY QUE RESOLVER AQUÍ
 *
 *  - **`softphone()`**: qué se le entrega al navegador para registrarse. Es
 *    más simple que en Zadarma porque en Asterisk el usuario SIP **es** la
 *    extensión: la 101 se registra como «101», no como «598703-101». Ese
 *    prefijo de cuenta era una particularidad de Zadarma, no de SIP.
 *  - **`marcar()`**: originar la llamada del botón del caso, por ARI.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN DE `marcar()`, QUE NO ES OBVIO
 *
 * Se llama PRIMERO a la extensión del operador y, cuando descuelga, al
 * ciudadano. Es el mismo orden de Zadarma y no es un capricho: si se llamara
 * primero al ciudadano, contestaría a un silencio mientras la central busca a
 * un operador que puede no estar en su puesto. En una línea de emergencias eso
 * es inaceptable.
 *
 * En ARI se expresa con `POST /channels`: el canal que se crea es el del
 * OPERADOR (`endpoint=PJSIP/101`), y el `context`/`extension` a donde se le
 * manda al contestar es el que marca al ciudadano.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class ProveedorAsterisk implements ProveedorPbx {
  /**
   * @param pedir  El `fetch` a usar; se inyecta para poder probar el camino
   *   completo —autenticación, parámetros, cada forma de fallar— sin levantar
   *   una centralita.
   */
  constructor(private readonly pedir: typeof fetch = (...a) => fetch(...a)) {}

  readonly descriptor: DescriptorProveedor = {
    clave: 'ASTERISK',
    nombre: 'Asterisk propio',
    resumen: 'Una centralita que operamos nosotros, con la troncal del operador del municipio. Es la opción que deja la llamada dentro del país y no amarra a ningún proveedor: la troncal se cambia sin tocar FALCON.',
    capacidades: ['entrantes', 'marcar', 'softphone'],
    credenciales: CREDENCIALES,
    rutaAviso: '/api/pbx/webhook',
    dondeSePega: 'En el dialplan de la centralita (extensions.conf), con la API key de la instancia en el encabezado x-api-key. Hay una plantilla lista en deploy/asterisk/ del repositorio.',
  };

  /**
   * Lo que el navegador necesita para registrarse como la extensión del
   * operador.
   *
   * Devuelve `null` —y no una configuración a medias— si falta cualquier
   * pieza: una dirección vacía produce un error de WebSocket que no se parece
   * en nada a «esto nunca se configuró», y manda a buscar el problema donde
   * no está.
   */
  softphone(cred: CredencialesPbx, extension: string, claveSip: string): ConfigSoftphone | null {
    const wss = cred.wss?.trim();
    const dominio = cred.dominio?.trim();
    const ext = extension?.trim();
    if (!wss || !dominio || !ext || !claveSip) return null;

    // En Asterisk el usuario SIP es la extensión, sin prefijo de cuenta.
    return { wss, dominio, usuario: ext, extension: ext, clave: claveSip };
  }

  async marcar(cred: CredencialesPbx, orden: { extension: string; numero: string }): Promise<ResultadoMarcar> {
    const url = cred.ariUrl?.trim().replace(/\/+$/, '');
    const usuario = cred.ariUsuario?.trim();
    const clave = cred.ariClave?.trim();
    if (!url || !usuario || !clave) {
      return {
        ok: false,
        error: 'Falta la configuración de ARI de la centralita (URL, usuario y clave). '
          + 'Un administrador la registra en Plataforma → Planta telefónica.',
      };
    }

    const contexto = cred.contextoSaliente?.trim() || CONTEXTO_POR_DEFECTO;
    const parametros = new URLSearchParams({
      // El canal que se crea es el del OPERADOR; el ciudadano viene después.
      endpoint: `PJSIP/${orden.extension}`,
      extension: orden.numero,
      context: contexto,
      priority: '1',
      // SU PROPIA extensión, y el navegador depende de ello: es así como la
      // barra del softphone sabe que ese INVITE es la saliente que el operador
      // acaba de pedir y no una emergencia entrando. Nadie más puede llamar
      // desde la extensión de uno. Ver `esMiSaliente` en el frontend.
      callerId: orden.extension,
      // Si el operador no descuelga en 30 s, la central suelta el intento en
      // vez de dejar un canal colgado consumiendo un cupo de la troncal.
      timeout: '30',
    });

    try {
      const res = await this.pedir(`${url}/channels?${parametros.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${usuario}:${clave}`).toString('base64')}` },
        // Sin tope, una centralita lenta deja al operador mirando un botón
        // girando con el ciudadano esperando.
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return { ok: false, error: this.porQueFallo(res.status) };
      }
      const cuerpo = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: cuerpo?.id || undefined };
    } catch (e) {
      const m = (e as Error)?.name === 'TimeoutError'
        ? 'La centralita no respondió a tiempo.'
        : `No se pudo hablar con la centralita: ${(e as Error)?.message ?? 'error desconocido'}.`;
      return { ok: false, error: m };
    }
  }

  /**
   * Traducir el código HTTP a algo que le sirva a quien está atendiendo.
   *
   * «401» en pantalla no le dice nada a un operador con un ciudadano al
   * teléfono; «la clave de ARI no es la de la centralita» le dice a quién
   * llamar.
   */
  private porQueFallo(estado: number): string {
    if (estado === 401 || estado === 403) {
      return 'La centralita rechazó las credenciales de ARI. Revise usuario y clave en Plataforma, '
        + 'y que en ari.conf de la centralita ese usuario exista y esté habilitado.';
    }
    if (estado === 404) {
      return 'La centralita no encontró la extensión o el contexto del dialplan. '
        + 'Revise que la extensión del operador exista y que el contexto de salientes sea el correcto.';
    }
    if (estado >= 500) {
      return 'La centralita falló al originar la llamada. Revise sus registros (/var/log/asterisk).';
    }
    return `La centralita respondió ${estado} al intentar originar la llamada.`;
  }
}
