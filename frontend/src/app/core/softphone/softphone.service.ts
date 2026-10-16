import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { PbxService } from '../pbx.service';
import { AuthService } from '../auth.service';
import { Llamada } from '../models';
import { ConfigSoftphone, EstadoSip, LlamadaSip } from './transporte-sip';
import { TransporteSipJs } from './transporte-sipjs';
import { Timbre } from './timbre';

/** Lo que responde `GET /api/pbx/softphone`. */
type RespuestaSoftphone =
  | { disponible: true; config: ConfigSoftphone }
  | { disponible: false; motivo: string };

/**
 * CONTESTAR DENTRO DE FALCON.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIA, Y POR QUÉ ES EL PUNTO DE TODO
 *
 * Hasta aquí el operador contestaba en MicroSIP (o en el teléfono web del
 * proveedor) y después, en FALCON, tomaba la llamada de la cola. Dos gestos en
 * dos programas para una sola cosa, y entre uno y otro se pierde el número, se
 * toma la llamada de otro, o se contesta sin que FALCON se entere nunca.
 *
 * Contestar aquí es UN gesto: se acepta el audio y, con el mismo clic, la
 * llamada de la cola queda tomada por este operador —desaparece de la cola de
 * los demás— y su número viaja a Recepción para que el caso se escriba
 * mientras se habla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE ATA LA LLAMADA DEL NAVEGADOR CON LA DE LA COLA
 *
 * Son dos caminos distintos: el audio llega por SIP al navegador, y el aviso
 * llega por webhook al servidor. Hay que reconocer que son la misma llamada.
 *
 *  1. Si la central manda su identificador en una cabecera del INVITE, se usa
 *     ese: es exacto.
 *  2. Si no, por **MI EXTENSIÓN**: una llamada que está sonando en la cola
 *     dirigida a la 102, mientras suena el teléfono registrado COMO la 102,
 *     es la misma llamada. Es la señal más fuerte que hay y por eso va
 *     primero —la primera versión casaba solo por número y en la prueba real
 *     falló: la central mandó la llamada interna sin `caller_id`, la cola
 *     mostró «Sin número» y no había nada que comparar—.
 *  3. Y si eso no alcanza, por **número**, con la misma normalización que usa
 *     el servidor al guardarlo. Entre varias, se prefiere la que la central
 *     dirigió a este operador.
 *
 * Y si no se encuentra ninguna, la llamada se contesta igual. El audio es lo
 * urgente; la fila de la cola es el registro. Se dice que no se encontró, en
 * vez de dejar al ciudadano esperando por un problema de nuestra contabilidad.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable({ providedIn: 'root' })
export class SoftphoneService {
  private readonly http = inject(HttpClient);
  private readonly pbx = inject(PbxService);
  private readonly auth = inject(AuthService);
  private readonly transporte = inject(TransporteSipJs);
  private readonly base = environment.apiBaseUrl;

  /** Registro contra la centralita. */
  readonly estado = signal<EstadoSip>('apagado');
  /** Por qué no se puede, o por qué falló. Siempre que haya algo que decir. */
  readonly motivo = signal('');
  /** Está sonando. */
  readonly entrante = signal<LlamadaSip | null>(null);
  /** Hay audio en curso. */
  readonly enCurso = signal<LlamadaSip | null>(null);
  /** La extensión con la que está registrado este navegador. */
  readonly extension = signal('');
  readonly silenciado = signal(false);
  /** Qué pasó con la llamada de la cola al contestar. */
  readonly avisoCola = signal('');
  /**
   * La llamada se estableció y NO llegó audio de la otra parte.
   *
   * Es un estado real y conviene decirlo: pasó en producción —al operador lo
   * oían y él no oía nada— y el silencio no se distingue de «el ciudadano no
   * ha dicho nada todavía» hasta que es tarde.
   */
  readonly sinAudioRemoto = signal(false);

  /** El timbre. Se prepara al encender, que es el clic que desbloquea el audio. */
  private readonly timbre = new Timbre();

  /** ¿Se puede ofrecer el softphone en la interfaz? */
  readonly disponible = computed(() =>
    this.auth.tieneIntegracion('pbx')
    && this.auth.tienePermiso('pbx.usar')
    && this.pbx.puede('softphone'));

  /** ¿Hay algo que mostrar en el panel? */
  readonly activo = computed(() => this.estado() !== 'apagado' || !!this.motivo());

  /**
   * Enciende el teléfono: pide su configuración y se registra.
   *
   * Es a petición y no automático a propósito. Registrarse toma el micrófono y
   * hace que la central empiece a entregarle llamadas a este navegador: no es
   * algo que deba pasarle a alguien que solo entró a consultar un caso.
   */
  async encender(): Promise<void> {
    if (this.estado() === 'conectando' || this.estado() === 'registrado') return;
    this.motivo.set('');
    this.estado.set('conectando');

    // Antes de nada: este método lo dispara un clic del operador, y es el
    // único momento en que el navegador deja preparar el audio. Si el timbre
    // se creara al entrar la primera llamada, no sonaría.
    this.timbre.preparar();

    const r = await this.pedirConfig();
    if (!r) {
      this.estado.set('fallo');
      this.motivo.set('No fue posible consultar la configuración del teléfono.');
      return;
    }
    if (!r.disponible) {
      this.estado.set('apagado');
      this.motivo.set(r.motivo);
      return;
    }

    this.extension.set(r.config.extension ?? '');
    await this.transporte.conectar(r.config, {
      registro: (estado, motivo) => {
        this.estado.set(estado);
        if (motivo) this.motivo.set(motivo);
        else if (estado === 'registrado') this.motivo.set('');
      },
      entrante: (l) => {
        this.entrante.set(l);
        this.avisoCola.set('');
        this.sinAudioRemoto.set(false);
        this.timbre.arrancar();
      },
      establecida: (pistasRemotas) => {
        this.timbre.parar();
        // Esto puede llegar DOS veces para la misma llamada: una al
        // establecerse, y otra si el audio remoto aparece tarde —el flujo de
        // SIP.js nace sin pistas—. La segunda solo viene a corregir el aviso,
        // así que el paso de «entrando» a «en llamada» se hace una sola vez:
        // repetirlo dejaría `enCurso` en nulo y la llamada desaparecería de
        // la barra con el ciudadano al otro lado.
        const sip = this.entrante();
        if (sip) {
          this.enCurso.set(sip);
          this.entrante.set(null);
        }
        // Cero pistas de audio remoto significa que la llamada se estableció
        // y no se va a oír nada. Decirlo es mejor que dejar al operador
        // hablando solo.
        this.sinAudioRemoto.set(pistasRemotas === 0);
      },
      terminada: () => {
        this.timbre.parar();
        this.entrante.set(null);
        this.enCurso.set(null);
        this.silenciado.set(false);
        this.sinAudioRemoto.set(false);
      },
    });
  }

  async apagar(): Promise<void> {
    this.timbre.soltar();
    await this.transporte.desconectar();
    this.estado.set('apagado');
    this.extension.set('');
    this.entrante.set(null);
    this.enCurso.set(null);
    this.silenciado.set(false);
    this.motivo.set('');
    this.avisoCola.set('');
  }

  /**
   * Contesta: primero el audio, después la cola.
   *
   * Ese orden no es casual. El ciudadano está esperando; la fila de la cola
   * es nuestro registro. Si tomar la llamada en la cola falla —otro operador
   * se la llevó, el servidor no responde—, la conversación ya está en pie y
   * se dice qué pasó, en vez de dejar el teléfono sonando.
   */
  async contestar(): Promise<void> {
    const sip = this.entrante();
    if (!sip) return;
    this.timbre.parar();
    await this.transporte.contestar();

    const dela = this.deLaCola(sip);
    if (!dela) {
      // DOS CAUSAS MUY DISTINTAS, Y HAY QUE DISTINGUIRLAS.
      //
      // Si la cola está vacía, el problema no es el emparejamiento: es que la
      // central no le está avisando a ESTA instancia. La dirección del
      // webhook lleva la API key de UNA instancia, así que una cuenta de la
      // centralita entrega sus llamadas a una sola. Decir «no se encontró» a
      // secas manda a buscar el error donde no está.
      const hayCola = this.pbx.llamadas().some((l) => l.estado === 'sonando');
      this.avisoCola.set(hayCola
        ? 'Contestada, pero ninguna llamada de la cola corresponde a esta. Si va a radicar un '
          + 'caso, tómela a mano en Recepción.'
        : 'Contestada, pero la cola de esta instancia está vacía: la central no le está avisando '
          + 'a FALCON de esta llamada. Revise que la dirección del webhook en la centralita lleve '
          + 'la API key de ESTA instancia —una cuenta entrega sus llamadas a una sola—.');
      return;
    }
    this.pbx.reclamar(dela.id).subscribe({
      next: (llamada) => {
        // El traspaso a Recepción: de un solo uso, para que el formulario se
        // llene con esta llamada y no se vuelva a llenar solo después.
        this.pbx.paraTrabajar.set(llamada);
        this.avisoCola.set(`Tomada para usted. Complete el caso en Recepción (${llamada.numero}).`);
      },
      error: (e) => this.avisoCola.set(
        `Contestada, pero no quedó tomada en FALCON: ${e?.error?.message ?? 'el servidor no respondió'}.`,
      ),
    });
  }

  async colgar(): Promise<void> {
    // Primero callar: colgar tarda un instante en ir y volver por la red, y
    // un timbre que sigue sonando después de rechazar la llamada es lo que
    // hace que alguien le baje el volumen al equipo y se pierda la siguiente.
    this.timbre.parar();
    await this.transporte.colgar();
  }

  alternarSilencio(): void {
    const nuevo = !this.silenciado();
    this.silenciado.set(nuevo);
    this.transporte.silenciar(nuevo);
  }

  tono(dtmf: string): void {
    void this.transporte.tono(dtmf);
  }

  usarAudio(elemento: HTMLAudioElement): void {
    this.transporte.usarAudio(elemento);
  }

  /**
   * La llamada de la cola que corresponde a esta del navegador.
   *
   * Por identificador si la central lo manda; si no, por número normalizado
   * igual que en el servidor. Entre varias que suenan del mismo número se
   * prefiere la que la central dirigió a este operador: si dos personas
   * llaman desde el mismo teléfono —una cabina, un conmutador— tomar la del
   * compañero le quita la suya.
   */
  deLaCola(sip: LlamadaSip): Llamada | null {
    const sonando = this.pbx.llamadas().filter((l) => l.estado === 'sonando');
    const yo = this.auth.sesion()?.usuario;

    // 1. El identificador de la central, si lo manda: es exacto.
    if (sip.callId) {
      const exacta = sonando.find((l) => l.callId === sip.callId);
      if (exacta) return exacta;
    }

    // 2. MI extensión. Si la central dirigió una llamada a la 102 y está
    //    sonando el teléfono registrado como la 102, es la misma llamada.
    //    Va antes que el número porque el número a veces no viene —una
    //    llamada entre extensiones llegó sin `caller_id` y la cola mostró
    //    «Sin número»— y la extensión siempre está.
    const mia = this.extension();
    if (mia) {
      const porExtension = sonando.filter((l) => l.extension === mia);
      if (porExtension.length === 1) return porExtension[0];
      // Varias a la misma extensión: la que ya es suya, si la hay.
      const suya = porExtension.find((l) => l.destinatario === yo);
      if (suya) return suya;
    }

    // 3. El número de quien llama, normalizado igual que en el servidor.
    const numero = PbxService.normalizarNumero(sip.numero ?? '');
    if (!numero) return null;
    const mismas = sonando.filter((l) => PbxService.normalizarNumero(l.numero) === numero);
    return mismas.find((l) => l.destinatario === yo) ?? mismas.find((l) => !l.destinatario) ?? mismas[0] ?? null;
  }

  private async pedirConfig(): Promise<RespuestaSoftphone | null> {
    try {
      return await new Promise<RespuestaSoftphone>((resolver, rechazar) => {
        this.http.get<RespuestaSoftphone>(`${this.base}/pbx/softphone`).subscribe({
          next: resolver, error: rechazar,
        });
      });
    } catch {
      return null;
    }
  }
}
