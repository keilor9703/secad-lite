import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { PbxService } from '../pbx.service';
import { AuthService } from '../auth.service';
import { Llamada } from '../models';
import { ConfigSoftphone, EstadoSip, LlamadaSip } from './transporte-sip';
import { TransporteSipJs } from './transporte-sipjs';
import { Timbre } from './timbre';

/**
 * A partir de aquí, contestar tarda lo suficiente para que el operador lo
 * note y vuelva a oprimir. No es un límite que se imponga a nada: es el
 * umbral para dejarlo anotado en la consola, porque una demora así siempre
 * tiene una causa —hoy, la recolección de candidatos ICE contra un relevo
 * cerrado— y conviene que quede rastro.
 */
const DEMORA_QUE_SE_NOTA_MS = 400;

/**
 * Cuánto vale la anotación de «acabo de pedir una llamada saliente».
 *
 * Solo sirve para DECIR a quién se está llamando; quien decide que esta
 * llamada es una saliente es la extensión del `From` (ver `esMiSaliente`).
 * Con dos minutos sobra: si la central no timbró en ese tiempo, el intento
 * se perdió y lo que entre después es otra cosa.
 */
const VENTANA_SALIENTE_MS = 120_000;

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
   * ESTO QUE ESTÁ TIMBRANDO ES MI PROPIA LLAMADA SALIENTE, NO UNA EMERGENCIA.
   *
   * El botón «Llamar» de un caso no marca primero al ciudadano: le timbra
   * primero al operador y, cuando descuelga, la central marca. Ese orden es
   * deliberado —si se llamara primero al ciudadano, contestaría a un silencio
   * mientras la central busca a un operador que puede no estar en su puesto—
   * pero tiene una consecuencia incómoda: para el navegador es un INVITE
   * entrante igual al de una emergencia.
   *
   * Y se notaba. La barra ofrecía «Entra una llamada · Contestar / Rechazar»
   * para la llamada que el propio operador acababa de pedir, y al oprimir
   * «Rechazar» —lo natural, porque nadie está esperando una llamada— cancelaba
   * su propia marcación sin entender qué había pasado.
   *
   * Se reconoce porque la central crea ese canal con el `callerId` de la
   * PROPIA extensión del operador (ver `asterisk.proveedor.ts`): nadie más
   * puede llamar desde la extensión de uno. Es una condición estructural y no
   * una ventana de tiempo, así que sigue siendo cierta aunque el navegador se
   * haya recargado entre pedir la llamada y que timbre.
   */
  readonly esMiSaliente = computed(() => {
    const ext = this.extension().trim();
    const l = this.entrante() ?? this.enCurso();
    return !!ext && !!l && l.numero.trim() === ext;
  });

  /** A quién se está llamando, si se pidió hace poco. Vacío = no se sabe. */
  readonly destinoSaliente = computed(() => {
    const p = this.pbx.salientePedida();
    if (!p) return '';
    return Date.now() - p.en <= VENTANA_SALIENTE_MS ? p.numero : '';
  });
  /**
   * La llamada se estableció y NO llegó audio de la otra parte.
   *
   * Es un estado real y conviene decirlo: pasó en producción —al operador lo
   * oían y él no oía nada— y el silencio no se distingue de «el ciudadano no
   * ha dicho nada todavía» hasta que es tarde.
   */
  readonly sinAudioRemoto = signal(false);

  /**
   * SE OPRIMIÓ «CONTESTAR» Y TODAVÍA NO HAY AUDIO.
   *
   * Existe porque sin él la barra no cambiaba NADA al oprimir el botón: el
   * paso a «En llamada» solo ocurre cuando la central confirma, y antes de
   * eso el navegador tiene que recolectar sus candidatos ICE. Eso tarda —hoy
   * más de lo que debería (ver `ESPERA_ICE_MS`)— y el operador, que no ve
   * ninguna reacción, vuelve a oprimir creyendo que su clic no entró.
   *
   * Dicho de otro modo: el retraso es un problema de red, pero «parece que no
   * hice nada» es un problema de la interfaz, y se arregla aquí.
   */
  readonly contestando = signal(false);

  /**
   * Cuánto tardó la última vez en contestar, en milisegundos.
   *
   * Es el número que separa dos causas que desde la silla del operador se ven
   * iguales: si son ~1500 ms, es el navegador recolectando candidatos; si es
   * casi cero y el audio igual tarda, el que tarda es la central o la
   * troncal. No se muestra en la barra —al operador no le sirve— pero queda
   * en la consola y disponible para el informe de soporte.
   */
  readonly demoraContestarMs = signal(0);

  /**
   * ¿El aviso de la cola es un FALLO que el operador todavía tiene que leer?
   *
   * Los dos tipos de aviso viven en la misma línea de la barra y se borran
   * distinto, y por eso hace falta distinguirlos:
   *
   *  - El acuse («Tomada para usted») es feedback del momento: al colgar ya
   *    no dice nada, y dejarlo colgando debajo de una barra plegada se ve
   *    roto.
   *  - El diagnóstico («la cola de esta instancia está vacía…») es algo que
   *    hay que ATENDER. Las llamadas son cortas; si se borra al colgar, el
   *    operador puede no alcanzar a leerlo nunca. Ese dura hasta la
   *    siguiente llamada.
   */
  private avisoEsFallo = false;

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

    // A quién se le puede pasar una llamada. Se pide aquí y no al transferir:
    // cuando el operador necesita pasarla ya la tiene en la oreja, y una lista
    // que tarda en cargar son segundos de silencio con un ciudadano esperando.
    this.cargarCompaneros();

    this.extension.set(r.config.extension ?? '');
    await this.transporte.conectar(r.config, {
      registro: (estado, motivo) => {
        this.estado.set(estado);
        if (motivo) this.motivo.set(motivo);
        else if (estado === 'registrado') this.motivo.set('');
      },
      entrante: (l) => {
        this.entrante.set(l);
        this.avisoEsFallo = false;
        this.avisoCola.set('');
        this.sinAudioRemoto.set(false);
        // El timbre es para una emergencia que entra. La saliente que el
        // propio operador acaba de pedir no se anuncia con el mismo timbre
        // que una llamada al 123: en una sala con varios puestos, eso hace
        // que los demás miren su pantalla por nada.
        if (!this.esMiSaliente()) this.timbre.arrancar();
      },
      establecida: (pistasRemotas) => {
        this.timbre.parar();
        this.contestando.set(false);
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
        // Si la llamada se cae MIENTRAS se contestaba —el ciudadano colgó en
        // esos segundos, que es de lo más normal— la barra tiene que volver a
        // su sitio y no quedarse en «Contestando…» para siempre.
        this.contestando.set(false);
        this.entrante.set(null);
        this.enCurso.set(null);
        this.silenciado.set(false);
        this.sinAudioRemoto.set(false);
        // El acuse de la cola muere con la llamada; el diagnóstico no.
        if (!this.avisoEsFallo) this.avisoCola.set('');
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
    // ────────────────────────────────────────────────────────────────────────
    // UN SOLO INTENTO, Y REACCIÓN INMEDIATA
    //
    // Contestar no es instantáneo: el navegador tiene que recolectar sus
    // candidatos ICE antes de que la respuesta SDP pueda salir. Sin este
    // estado la barra se quedaba idéntica durante esos segundos, el operador
    // volvía a oprimir —porque cualquiera lo haría— y el segundo clic llamaba
    // a `answer()` sobre una sesión que ya no estaba entrando: SIP.js lo
    // rechaza, y ese rechazo abortaba el resto de ESTA función, que es la que
    // reclama la llamada en la cola. O sea que insistir no solo no ayudaba:
    // podía dejar la llamada contestada y sin tomar.
    // ────────────────────────────────────────────────────────────────────────
    if (this.contestando()) return;
    this.contestando.set(true);
    this.timbre.parar();
    try {
      const ms = await this.transporte.contestar();
      this.demoraContestarMs.set(ms);
      if (ms > DEMORA_QUE_SE_NOTA_MS) {
        // Queda en la consola del operador, que es lo que se pega en un
        // reporte de soporte. No se le pone en pantalla: saber que su
        // teléfono tardó 1,6 s no le sirve con un ciudadano al otro lado.
        console.info(`[softphone] contestar tardó ${ms} ms (recolección de candidatos ICE)`);
      }
    } catch (e) {
      // Falló el contestar mismo: sin esto la barra se quedaba en
      // «Contestando…» hasta que alguien recargara la página.
      this.contestando.set(false);
      this.avisoEsFallo = true;
      this.avisoCola.set(
        `No se pudo contestar: ${(e as Error)?.message ?? 'la centralita no respondió'}.`,
      );
      return;
    }

    // ── MI PROPIA SALIENTE NO VA A LA COLA, Y ESO NO ES UNA AVERÍA ──────────
    //
    // La cola de un CAD es de lo que ENTRA; el dialplan lo dice con todas sus
    // letras y por eso una saliente no se avisa como «entrante». Buscarla
    // aquí y no encontrarla llevaba a decirle al operador que revisara
    // `pbx_webhook_log` por una llamada que nunca debió estar en la cola.
    //
    // Un mensaje que describe como avería el comportamiento correcto es peor
    // que no decir nada: manda a buscar media hora donde no hay nada, y sale
    // en pantalla con un ciudadano al teléfono.
    if (this.esMiSaliente()) {
      const a = this.destinoSaliente();
      this.avisoEsFallo = false;
      this.avisoCola.set(
        a
          ? `La central está marcando a ${a}.`
          : 'La central está marcando. Es su llamada saliente, no una emergencia en cola.',
      );
      return;
    }

    let dela = this.deLaCola(sip);
    if (!dela) {
      // ANTES DE CULPAR A LA CENTRALITA, PREGUNTARLE AL SERVIDOR.
      //
      // La cola en memoria la llena Socket.IO, y ese canal tiene huecos: una
      // red que se cayó, la pantalla suspendida, un despliegue que reinicia
      // las tres réplicas una por una. Si este navegador se perdió el aviso,
      // la llamada SÍ está en la cola del servidor y la copia local miente.
      // Concluir con la copia vieja mandaba a revisar la API key del webhook
      // —media hora en el panel de la centralita— por un aviso perdido.
      const vista = await this.pbx.recargarYEsperar();
      dela = this.deLaCola(sip);
      if (!dela) {
        this.avisoEsFallo = true;
        this.avisoCola.set(this.porQueNoEstaEnLaCola(vista));
        return;
      }
    }
    this.pbx.reclamar(dela.id).subscribe({
      next: (llamada) => {
        // El traspaso a Recepción: de un solo uso, para que el formulario se
        // llene con esta llamada y no se vuelva a llenar solo después.
        this.pbx.paraTrabajar.set(llamada);
        this.avisoEsFallo = false;
        this.avisoCola.set(`Tomada para usted. Complete el caso en Recepción (${llamada.numero}).`);
      },
      error: (e) => {
        this.avisoEsFallo = true;
        this.avisoCola.set(
          `Contestada, pero no quedó tomada en FALCON: ${e?.error?.message ?? 'el servidor no respondió'}.`,
        );
      },
    });
  }

  /** Está transfiriendo ahora mismo: el botón no se puede oprimir dos veces. */
  readonly transfiriendo = signal(false);

  /**
   * A quién se le puede pasar la llamada. Se pide al encender, una sola vez.
   *
   * Al encender y no al transferir: cuando el operador necesita pasar una
   * llamada ya la tiene en la oreja, y una lista que tarda en cargar se
   * traduce en segundos de silencio con un ciudadano esperando.
   */
  readonly companeros = signal<{ extension: string; nombre: string }[]>([]);

  /** Carga los compañeros. Que falle no puede impedir usar el teléfono. */
  private cargarCompaneros(): void {
    this.http
      .get<{ extension: string; nombre: string }[]>(
        `${this.base}/pbx/companeros`,
      )
      .subscribe({
        next: (c) => this.companeros.set(c ?? []),
        error: () => this.companeros.set([]),
      });
  }

  /**
   * Pasa la llamada en curso a otra extensión.
   *
   * Es una transferencia CIEGA: se suelta y se va, sin poder deshacerla desde
   * aquí. Si el destino no contesta, el plan de marcación de la planta
   * devuelve la llamada a la cola, así que el peor caso de equivocarse de
   * compañero es que vuelva a timbrar en la sala. Aun así la lista ofrece
   * primero a los que están conectados: que haya red debajo no es excusa para
   * ofrecer un puesto vacío.
   *
   * Lo que pasa después no lo decide esta pantalla: la central avisa a FALCON
   * con el evento `transferida`, y es ese aviso el que hace que el caso
   * aparezca en el puesto del que la recibe. Si el operador que transfiere
   * tuviera que «mandar» el caso, una transferencia hecha desde un teléfono
   * de escritorio no movería nada.
   */
  async transferir(extension: string): Promise<boolean> {
    if (this.transfiriendo()) return false;
    this.transfiriendo.set(true);
    try {
      await this.transporte.transferir(extension);
      return true;
    } catch (e) {
      this.motivo.set(
        (e as Error)?.message ?? 'No se pudo transferir la llamada.',
      );
      return false;
    } finally {
      this.transfiriendo.set(false);
    }
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
   * POR QUÉ ESTA LLAMADA NO ESTÁ EN LA COLA — cuatro causas, cuatro arreglos.
   *
   * Esto se escribe en la barra con el ciudadano al teléfono, así que no puede
   * decir «no se encontró»: eso manda a buscar a ciegas. Cada caso tiene un
   * arreglo distinto y en un sitio distinto.
   *
   * `vista` es lo que contestó el servidor, o `null` si no se pudo preguntar.
   * «No sé» y «no hay nada» no son lo mismo y no se dicen igual.
   */
  private porQueNoEstaEnLaCola(vista: Llamada[] | null): string {
    // 1. No se pudo preguntar. Puede que la llamada esté en la cola; no se
    //    sabe. Lo único seguro es que la conversación está en pie.
    if (!vista) {
      return 'Contestada, pero no se pudo consultar la cola de FALCON '
        + '(¿sin conexión con el servidor?). Si va a radicar un caso, tómela a mano en Recepción.';
    }

    // 2. Hay llamadas timbrando y ninguna es esta: el webhook llega bien y lo
    //    que falló fue el emparejamiento (el número que manda la central, o
    //    la extensión que tiene puesta este usuario).
    if (vista.some((l) => l.estado === 'sonando')) {
      return 'Contestada, pero ninguna de las llamadas que están timbrando corresponde a esta. '
        + 'Revise que la extensión de su usuario sea la misma con la que se registró el teléfono. '
        + 'Si va a radicar un caso, tómela a mano en Recepción.';
    }

    // 3. La cola tiene historial pero nada timbrando: a ESTA instancia sí le
    //    llegan avisos de la central, así que la API key de la URL es la
    //    correcta. Lo que no llegó es el aviso de ESTA llamada — el evento que
    //    manda la central para este tipo de llamada, o una firma rechazada.
    if (vista.length) {
      return 'Contestada, pero esta llamada no entró a la cola. A esta instancia SÍ le llegan '
        + 'avisos de la central —hay llamadas anteriores—, así que lo que no llegó es el aviso de '
        + 'esta: revise en pbx_webhook_log si fue rechazada por firma, o si la central no manda '
        + 'evento para este tipo de llamada.';
    }

    // 4. La cola está vacía del todo: ni una llamada, nunca. La dirección del
    //    webhook lleva la API key de UNA instancia, así que una cuenta de la
    //    centralita entrega sus llamadas a una sola.
    return 'Contestada, pero la cola de esta instancia está vacía: nunca ha llegado un aviso de '
      + 'la central. Revise que la dirección del webhook en la centralita lleve la API key de '
      + 'ESTA instancia —una cuenta entrega sus llamadas a una sola—.';
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
