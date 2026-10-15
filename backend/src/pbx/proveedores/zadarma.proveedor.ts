import { CuerpoAviso, ResultadoVerificacion, TraduccionAviso } from './aviso';
import {
  CampoCredencial, ConfigSoftphone, CredencialesPbx, DescriptorProveedor, ProveedorPbx,
  ResultadoMarcar,
} from './proveedor';
import { EVENTOS_ZADARMA, EventoZadarma, verificarFirma } from '../zadarma/zadarma.firma';
import {
  cadenaParametros, encabezadoAutorizacion, firmarPeticion, pareceCredencialZadarma,
} from '../zadarma/zadarma.api';

/** La API de Zadarma, y el método que origina una llamada. */
const API_POR_DEFECTO = 'https://api.zadarma.com';
const METODO_CALLBACK = '/v1/request/callback/';

/** Las credenciales que Zadarma necesita de nosotros, dichas por Zadarma. */
const CREDENCIALES: CampoCredencial[] = [
  {
    clave: 'key',
    etiqueta: 'Key de la API',
    ayuda: 'En el panel: Integraciones y API → Claves y API. No es secreta por sí sola.',
    secreto: false,
    requerido: true,
    forma: '^[A-Za-z0-9]{20}$',
    ejemplo: 'a1b2c3d4e5f6a7b8c9d0',
  },
  {
    clave: 'sipWss',
    etiqueta: 'WebSocket SIP (para contestar en FALCON)',
    ayuda: 'La dirección `wss://…` de señalización de la centralita. Se consigue en Integraciones y API → WebRTC, donde además hay que autorizar el dominio de FALCON. Sin esto, la telefonía funciona igual pero se contesta en el softphone de siempre.',
    secreto: false,
    requerido: false,
    ejemplo: 'wss://wss.zadarma.com',
  },
  {
    clave: 'sipDominio',
    etiqueta: 'Dominio SIP',
    ayuda: 'Con qué dominio se arma la identidad de cada extensión (`101@dominio`). Lo dice el panel junto a los datos de la extensión.',
    secreto: false,
    requerido: false,
    ejemplo: 'sip.zadarma.com',
  },
  {
    clave: 'secreto',
    etiqueta: 'Secret de la API',
    ayuda: 'Al lado de la Key, en el mismo panel. Con él se verifica la firma de cada aviso; sin él no se puede confiar en nada de lo que llegue.',
    secreto: true,
    requerido: true,
    forma: '^[A-Za-z0-9]{20}$',
  },
];

/**
 * Zadarma.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MAPA DE EVENTOS, Y LO QUE DELIBERADAMENTE NO HACE
 *
 *  NOTIFY_START      → `entrante`. Timbra en la cola, sin destinatario: la
 *                      centralita todavía no decidió a quién se la ofrece.
 *  NOTIFY_INTERNAL   → la misma llamada, ya dirigida a una extensión. No crea
 *                      otra: completa la que existe.
 *  NOTIFY_ANSWER     → quién descolgó, para el registro. **No** la marca como
 *                      «atendida» en FALCON: atendida significa que alguien la
 *                      tomó DESDE la aplicación y se le abrió el caso.
 *                      Mientras se conteste por softphone ajeno son dos cosas
 *                      distintas, y fingir que son una pondría casos vacíos en
 *                      el tablero. Cuando se conteste dentro de FALCON,
 *                      coincidirán solas.
 *  NOTIFY_END,
 *  NOTIFY_INTERNAL_END,
 *  NOTIFY_OUT_END    → `cerrar`. Los tres, y lo que decide cuál llamada se
 *                      cierra es el `pbx_call_id`, no el nombre del evento:
 *                      una llamada entre extensiones entra como entrante por
 *                      la pata que recibe y su fin llega como SALIENTE por la
 *                      pata que marcó. Mientras `NOTIFY_OUT_END` se ignoraba,
 *                      colgar en el teléfono no colgaba en FALCON.
 *  NOTIFY_OUT_START  → nada: la cola de un CAD es de lo que ENTRA.
 *  NOTIFY_RECORD     → todavía no: la grabación es el paso siguiente, y por
 *                      eso `grabacion` NO está entre sus capacidades. Las
 *                      capacidades dicen lo que FALCON sabe hacer con este
 *                      proveedor, no lo que el proveedor sabría hacer.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class ProveedorZadarma implements ProveedorPbx {
  /**
   * El `fetch` se inyecta para poder probar el camino completo —firma,
   * parámetros, lectura de la respuesta y cada forma de fallar— sin salir a
   * internet. En producción es el `fetch` de Node.
   */
  /**
   * @param pedir  El `fetch` a usar. Se inyecta para poder probar el camino
   *   completo —firma, parámetros, lectura de la respuesta y cada forma de
   *   fallar— sin salir a internet.
   * @param api  La base de la API. Configurable por `ZADARMA_API_URL` porque
   *   el webhook y la API van en direcciones CONTRARIAS: el webhook lo inicia
   *   Zadarma y basta con que el servidor sea alcanzable desde fuera; la API
   *   la inicia FALCON, y un servidor con la salida restringida —lo normal en
   *   una nube con reglas de egreso— puede recibir llamadas perfectamente y no
   *   poder originar ninguna. Con esto se apunta a un proxy de salida sin
   *   tocar código, y el error que se ve en pantalla («No se pudo hablar con
   *   la centralita») deja de ser un callejón sin salida.
   */
  constructor(
    private readonly pedir: typeof fetch = (...a) => fetch(...a),
    private readonly api: string = process.env.ZADARMA_API_URL?.trim() || API_POR_DEFECTO,
  ) {}

  readonly descriptor: DescriptorProveedor = {
    clave: 'ZADARMA',
    nombre: 'Zadarma',
    resumen: 'Centralita en la nube que operamos nosotros: número, extensiones y grabación en su panel. Sirve para el municipio que no tiene línea propia, y como banco de pruebas de toda la cadena.',
    capacidades: ['entrantes', 'marcar', 'softphone'],
    credenciales: CREDENCIALES,
    rutaAviso: '/api/pbx/zadarma/',
    dondeSePega: 'Integraciones y API → Integraciones → Notificaciones de eventos → campo «Sobre llamadas a la centralita»',
  };

  verificar(cuerpo: CuerpoAviso, firma: string | undefined, cred: CredencialesPbx): ResultadoVerificacion {
    return verificarFirma(cuerpo, firma, cred.secreto ?? '');
  }

  traducir(cuerpo: CuerpoAviso): TraduccionAviso {
    const evento = cuerpo.event as EventoZadarma | undefined;
    if (!evento || !(EVENTOS_ZADARMA as readonly string[]).includes(evento)) {
      return { accion: 'nada', resumen: `Evento desconocido, ignorado: ${evento ?? '(ninguno)'}` };
    }

    switch (evento) {
      case 'NOTIFY_START':
        return {
          accion: 'entrante',
          llamada: this.datos(cuerpo),
          resumen: `Entrante de ${cuerpo.caller_id ?? '(sin número)'}`,
        };

      case 'NOTIFY_INTERNAL':
        return {
          accion: 'entrante',
          llamada: { ...this.datos(cuerpo), extension: cuerpo.internal || undefined },
          resumen: `Dirigida a la extensión ${cuerpo.internal ?? '(sin dato)'}`,
        };

      case 'NOTIFY_ANSWER':
        return {
          accion: 'entrante',
          llamada: {
            ...this.datos(cuerpo),
            extension: cuerpo.internal || undefined,
            agente: cuerpo.internal || undefined,
          },
          resumen: `Contestada por la extensión ${cuerpo.internal ?? '(sin dato)'}`,
        };

      case 'NOTIFY_END':
      case 'NOTIFY_INTERNAL_END':
      case 'NOTIFY_OUT_END':
        return {
          accion: 'cerrar',
          llamada: {
            ...this.datos(cuerpo),
            // `internal` NO siempre es quien contestó: en un fin de saliente es
            // la extensión que MARCÓ, y tomarla por el agente dejaba la
            // llamada 101→102 atribuida a la 101 en el historial del
            // municipio.
            agente: evento === 'NOTIFY_OUT_END' ? undefined : cuerpo.internal || undefined,
            // `answered` es la palabra de la central: alguien descolgó. Sin
            // esto, una llamada atendida por softphone se contaba como perdida,
            // y «llamadas perdidas del 123» es una cifra que se reporta.
            atendidaEnPlanta: cuerpo.disposition === 'answered',
          },
          detalle: `${cuerpo.disposition ?? 'sin disposición'}, ${cuerpo.duration ?? '?'} s`,
          esSaliente: evento === 'NOTIFY_OUT_END',
        };

      case 'NOTIFY_OUT_START':
        return {
          accion: 'nada',
          resumen: `Saliente ${cuerpo.internal ?? '?'} → ${cuerpo.destination ?? '?'}, no entra a la cola`,
        };

      case 'NOTIFY_RECORD':
        return { accion: 'nada', resumen: 'Grabación disponible; descarga todavía no implementada' };

      default:
        return { accion: 'nada', resumen: `Evento sin traducción: ${evento}` };
    }
  }

  /**
   * LLAMADA SALIENTE: `/v1/request/callback/`.
   *
   * No es FALCON llamando al ciudadano: es FALCON pidiéndole a la centralita
   * que llame **primero a la extensión del operador** y, cuando descuelgue,
   * al ciudadano. Así el audio no pasa por el navegador —no hace falta
   * softphone— y la llamada queda en el registro de la central como cualquier
   * otra.
   *
   * Nunca lanza: una central caída, un 401 o una respuesta que no es JSON
   * devuelven `{ ok: false, error }` con algo que el operador pueda leer. Un
   * botón de llamar que revienta con un error de red en pantalla no sirve en
   * una sala de despacho.
   */
  async marcar(cred: CredencialesPbx, orden: { extension: string; numero: string }): Promise<ResultadoMarcar> {
    const key = cred.key?.trim();
    const secreto = cred.secreto?.trim();
    if (!key || !secreto) {
      return { ok: false, error: 'Faltan las credenciales de la API de Zadarma para esta instancia.' };
    }

    // `from` es a quién llama primero la central —la extensión del operador—
    // y `to` el ciudadano. `sip` repite la extensión: es la que factura y la
    // que queda en el registro de la central como originadora.
    const params = { from: orden.extension, to: orden.numero, sip: orden.extension };
    const cadena = cadenaParametros(params);
    const firma = firmarPeticion(METODO_CALLBACK, cadena, secreto);

    try {
      const res = await this.pedir(`${this.api}${METODO_CALLBACK}?${cadena}`, {
        headers: { Authorization: encabezadoAutorizacion(key, firma) },
        // Sin tope, una API lenta deja al operador mirando un botón girando.
        signal: AbortSignal.timeout(10_000),
      });
      const cuerpo = (await res.json().catch(() => ({}))) as {
        status?: string; message?: string; id?: string | number; call_id?: string;
      };

      if (!res.ok || cuerpo?.status === 'error') {
        return { ok: false, error: this.porQueFallo(res.status, cuerpo?.message, key, secreto) };
      }
      return { ok: true, id: String(cuerpo?.id ?? cuerpo?.call_id ?? '') || undefined };
    } catch (e) {
      const m = (e as Error)?.name === 'TimeoutError'
        ? 'La centralita no respondió a tiempo.'
        : `No se pudo hablar con la centralita: ${(e as Error)?.message ?? 'error desconocido'}.`;
      return { ok: false, error: m };
    }
  }

  /**
   * Por qué falló, en términos que sirvan para arreglarlo.
   *
   * Un 401 de Zadarma dice «authentication failed» y nada más, y la causa real
   * suele ser una credencial pegada con un espacio o a medias —da exactamente
   * el mismo error que una credencial equivocada—. Si la forma no cuadra, se
   * dice; es la única pista que hay.
   */
  private porQueFallo(estado: number, mensaje: string | undefined, key: string, secreto: string): string {
    const detalle = mensaje?.trim() || `HTTP ${estado}`;
    if (estado === 401 || /auth/i.test(detalle)) {
      const sospechosas = [
        pareceCredencialZadarma(key) ? null : 'la Key',
        pareceCredencialZadarma(secreto) ? null : 'el Secret',
      ].filter(Boolean);
      if (sospechosas.length) {
        return `Zadarma rechazó la autenticación (${detalle}). Revise ${sospechosas.join(' y ')}: `
          + 'no tiene la forma que espera Zadarma (20 caracteres), así que puede estar pegada '
          + 'con un espacio o a medias.';
      }
      return `Zadarma rechazó la autenticación (${detalle}). Las credenciales tienen la forma `
        + 'correcta, así que seguramente son de otra cuenta o se rotaron en su panel.';
    }
    return `Zadarma no pudo originar la llamada: ${detalle}`;
  }

  /**
   * La configuración con la que el navegador del operador se registra como
   * teléfono —o null si esta instancia no la tiene puesta.
   *
   * Devolver null es un estado normal y frecuente, no un error: la telefonía
   * funciona igual sin softphone (se contesta en MicroSIP, en el teléfono web
   * del panel o en el móvil) y lo único que cambia es que atender en FALCON
   * sigue siendo un segundo gesto. La pantalla lo dice en vez de intentar
   * registrarse contra una dirección vacía.
   *
   * No se inventa ningún valor por defecto a propósito. La dirección de
   * señalización y el dominio SIP los publica el proveedor en SU panel y
   * pueden cambiar; una dirección adivinada aquí fallaría con un error de
   * WebSocket que no se parece en nada a «esto nunca se configuró».
   */
  softphone(cred: CredencialesPbx, extension: string, claveSip: string): ConfigSoftphone | null {
    const wss = cred.sipWss?.trim();
    const dominio = cred.sipDominio?.trim();
    if (!wss || !dominio || !extension?.trim() || !claveSip) return null;
    return { wss, dominio, usuario: extension.trim(), clave: claveSip };
  }

  /** Los campos comunes a todos sus eventos. */
  private datos(cuerpo: CuerpoAviso) {
    return {
      callId: cuerpo.pbx_call_id || cuerpo.call_id_with_rec || undefined,
      numero: cuerpo.caller_id || undefined,
      numeroDestino: cuerpo.called_did || cuerpo.destination || undefined,
      fechaHora: fechaIso(cuerpo.call_start),
      origen: 'telefono' as const,
    };
  }
}

/**
 * «2026-10-15 09:12:33» → «2026-10-15T09:12:33». Lo que no cuadre, se omite.
 *
 * Es la hora de la central, sin zona, y se acepta así a propósito: es un dato
 * informativo para cruzar con sus registros. El instante que vale para FALCON
 * es el de recepción, que lo sella FALCON.
 */
export function fechaIso(valor: string | undefined): string | undefined {
  const v = String(valor ?? '').trim();
  if (!v) return undefined;
  const iso = v.includes('T') ? v : v.replace(' ', 'T');
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}
