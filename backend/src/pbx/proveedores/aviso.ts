import { OrigenLlamada } from '../llamada.entity';

/**
 * El aviso de una central, en la forma más tonta posible: pares de texto.
 *
 * Así llega de verdad —`x-www-form-urlencoded` en Zadarma, JSON en otros— y
 * así se guarda en `pbx_webhook_log`. El puerto no intenta tipar los campos de
 * cada proveedor: eso es trabajo de su traductor.
 */
export type CuerpoAviso = Record<string, string | undefined>;

/** ¿El aviso viene del proveedor, o lo mandó cualquiera? */
export type ResultadoVerificacion =
  | { ok: true }
  | { ok: false; motivo: string; esperada?: string };

/**
 * Los hechos de una llamada, sin el idioma de ningún proveedor.
 *
 * Es deliberadamente lo mismo que acepta el webhook genérico (`numero`,
 * `callId`, `extension`…): ese modelo lleva años en producción con YACO y la
 * cola, el aviso en vivo, el screen-pop y los informes están construidos
 * sobre él. Un proveedor nuevo traduce a esto; no se traduce FALCON a él.
 */
export interface DatosLlamada {
  /** El identificador de la central. Es lo que ata los avisos entre sí. */
  callId?: string;
  /** Quién llama. */
  numero?: string;
  /** A qué número entró. */
  numeroDestino?: string;
  /** La extensión a la que la central ya dirigió la llamada, si la decidió. */
  extension?: string;
  /** Quién descolgó, según la central. */
  agente?: string;
  /** La hora que reporta la central (ISO 8601). Informativa. */
  fechaHora?: string;
  /** Teléfono, chat de WhatsApp, llamada de WhatsApp. */
  origen?: OrigenLlamada;
  /** La central dice que alguien contestó, aunque no fuera desde FALCON. */
  atendidaEnPlanta?: boolean;
}

/**
 * Qué significa un aviso, dicho por el traductor del proveedor.
 *
 * El traductor dice QUÉ pasó; quien lo aplica decide cómo —y redacta el
 * resultado, porque el resultado depende de lo que encuentre en la base
 * («se cerró» no es lo mismo que «ya estaba cerrada»), y eso el traductor no
 * lo puede saber.
 */
export type TraduccionAviso =
  /** Entró una llamada, o la misma llamada ahora trae más datos. */
  | { accion: 'entrante'; llamada: DatosLlamada; resumen: string }
  /**
   * Terminó una llamada. Se cierra la que nombre su `callId`, si queda
   * alguna: un aviso de fin no siempre corresponde a una llamada de la cola
   * —el fin de una llamada entre extensiones llega como fin de SALIENTE— y
   * tampoco siempre es el primero que llega por esa llamada.
   */
  | { accion: 'cerrar'; llamada: DatosLlamada; detalle: string; esSaliente: boolean }
  /** No hay nada que hacer, y conviene dejar escrito por qué. */
  | { accion: 'nada'; resumen: string };
