import { CuerpoAviso, ResultadoVerificacion, TraduccionAviso } from './aviso';
import {
  CampoCredencial, CredencialesPbx, DescriptorProveedor, ProveedorPbx,
} from './proveedor';
import { EVENTOS_ZADARMA, EventoZadarma, verificarFirma } from '../zadarma/zadarma.firma';

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
  readonly descriptor: DescriptorProveedor = {
    clave: 'ZADARMA',
    nombre: 'Zadarma',
    resumen: 'Centralita en la nube que operamos nosotros: número, extensiones y grabación en su panel. Sirve para el municipio que no tiene línea propia, y como banco de pruebas de toda la cadena.',
    capacidades: ['entrantes'],
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
