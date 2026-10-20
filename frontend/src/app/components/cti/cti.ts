import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';
import { SoftphoneService } from '../../core/softphone/softphone.service';
import { Llamada } from '../../core/models';
import { IconoComponent, NombreIcono } from '../../shared/icono/icono';

/** Cada cuánto se repinta el reloj de la llamada y las esperas de la cola. */
const TIC_MS = 1000;

/** Las teclas, en el orden del teclado de un teléfono. */
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/**
 * EL PANEL DE TELEFONÍA DEL OPERADOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES, Y QUÉ NO ES
 *
 * Es el teléfono de un agente de emergencias, y **solo** eso: no hay chat, no
 * hay WhatsApp, no hay mapa. Esa decisión es de fondo, no de alcance. Un panel
 * que mezcla canales obliga a mirar dos veces para saber si lo que parpadea es
 * una llamada o un mensaje, y en el 123 la llamada siempre manda. Los demás
 * canales ya tienen su sitio en FALCON; este panel no compite con ellos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ENSEÑA LA COLA Y NO SOLO SU TAMAÑO
 *
 * Un contador dice «5 en cola». Eso no sirve para decidir nada: no dice si el
 * primero lleva seis segundos o seis minutos. Aquí cada llamada en espera trae
 * su número y **cuánto lleva esperando**, y el que más ha esperado va primero.
 * Es la diferencia entre un tablero y una herramienta de trabajo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL ESTADO SE DICE COMO ES
 *
 * El estado que se muestra es el del REGISTRO SIP, que es la única verdad
 * sobre si a este puesto le puede entrar una llamada. No hay un selector
 * decorativo de «rol» ni un estado que el operador pueda poner a mano sin que
 * nada lo respalde: un indicador que dice «disponible» cuando el teléfono está
 * caído es peor que no tener indicador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA COSA A LA VEZ
 *
 * El bloque del centro tiene un estado y solo uno: libre, timbrando, su propia
 * saliente, o en llamada. No se apilan tarjetas que compiten; lo que hay que
 * hacer ahora está siempre en el mismo sitio y con el mismo tamaño, para que
 * el operador no tenga que buscarlo con el ciudadano al teléfono.
 */
@Component({
  selector: 'app-cti',
  standalone: true,
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cti.html',
  styleUrl: './cti.scss',
})
export class CtiComponent implements OnDestroy {
  readonly sp = inject(SoftphoneService);
  private readonly pbx = inject(PbxService);
  private readonly auth = inject(AuthService);

  /**
   * El operador tomó una llamada de la cola.
   *
   * Sale como evento y no se resuelve aquí porque lo que hay que hacer con una
   * llamada tomada —llenar el formulario, consultar la ubicación, fijar el
   * medio— es asunto de la pantalla que aloja el panel, no del teléfono.
   */
  readonly tomar = output<Llamada>();

  /** Se repinta cada segundo: relojes de llamada y de espera. */
  private readonly ahora = signal(Date.now());
  private readonly reloj = setInterval(() => this.ahora.set(Date.now()), TIC_MS);

  /** El aviso sonoro de la cola, que es del puesto y no de este panel. */
  readonly sonidoActivo = this.pbx.sonidoActivo;
  readonly enVivo = this.pbx.enVivo;
  /** Una instancia sin planta no tiene canal que se caiga: no se avisa. */
  readonly canalEsperado = this.pbx.canalEsperado;
  alternarSonido(): void {
    this.pbx.alternarSonido();
  }

  readonly teclas = TECLAS;
  readonly tecleando = signal(false);
  readonly marcado = signal('');
  readonly eligiendoDestino = signal(false);
  /** Lo último que dijo el servidor al pedir una saliente desde el teclado. */
  readonly avisoMarcado = signal('');

  constructor() {
    void this.sp.encender();
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
  }

  // ── Quién es el operador ───────────────────────────────────────────────────

  readonly nombre = computed(
    () => this.auth.sesion()?.nombre || this.auth.sesion()?.usuario || 'Operador',
  );

  /** Las iniciales para la chapa. Dos, que es lo que cabe sin encoger. */
  readonly iniciales = computed(() =>
    this.nombre()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join(''),
  );

  // ── El estado del teléfono ─────────────────────────────────────────────────

  /**
   * Cómo está el teléfono, en una palabra.
   *
   * El orden importa: lo que está pasando ahora le gana a cómo está el
   * registro. A alguien en llamada no le sirve leer «Conectado».
   */
  readonly situacion = computed<
    'en-llamada' | 'timbrando' | 'saliente' | 'conectado' | 'conectando' | 'caido'
  >(() => {
    if (this.sp.enCurso()) return 'en-llamada';
    if (this.sp.entrante()) return this.sp.esMiSaliente() ? 'saliente' : 'timbrando';
    if (this.sp.estado() === 'registrado') return 'conectado';
    if (this.sp.estado() === 'conectando') return 'conectando';
    return 'caido';
  });

  readonly rotuloSituacion = computed(
    () =>
      ({
        'en-llamada': 'En llamada',
        timbrando: 'Entra una llamada',
        saliente: 'Marcando',
        conectado: 'Disponible',
        conectando: 'Conectando',
        caido: 'Sin teléfono',
      })[this.situacion()],
  );

  // ── Las dos cifras del turno ───────────────────────────────────────────────

  readonly enEspera = computed(() =>
    this.pbx
      .llamadas()
      .filter((l) => l.estado === 'sonando')
      // La que más ha esperado, primero. Es el único orden que corresponde a
      // cómo se debe atender una cola de emergencias.
      .sort((a, b) => +new Date(a.creadoEn) - +new Date(b.creadoEn)),
  );

  /**
   * Cuántas atendió ESTE operador hoy.
   *
   * Se cuenta sobre la cola que ya tiene cargada el navegador. Se dice
   * «atendidas hoy» y no «del turno» a propósito: un turno que cruza la
   * medianoche contaría mal, y prometer menos es mejor que contar mal.
   */
  readonly atendidasHoy = computed(() => {
    const yo = this.auth.sesion()?.usuario;
    if (!yo) return 0;
    const hoy = new Date().toDateString();
    return this.pbx.llamadas().filter(
      (l) =>
        l.atendidaPor === yo &&
        !!l.atendidaEn &&
        new Date(l.atendidaEn).toDateString() === hoy,
    ).length;
  });

  // ── Los relojes ────────────────────────────────────────────────────────────

  /** Cuánto lleva esta llamada esperando en la cola, en mm:ss. */
  espera(l: Llamada): string {
    return reloj(this.ahora() - +new Date(l.creadoEn));
  }

  /**
   * Cuánto lleva la conversación.
   *
   * Se cuenta desde que el audio se estableció en ESTE navegador y no desde
   * `atendidaEn`, que es cuando FALCON registró la llamada: si el operador
   * recarga la página a mitad de llamada, lo honesto es volver a contar desde
   * lo que de verdad se sabe en vez de inventar un número.
   */
  readonly duracion = computed(() => {
    const d = this.sp.enCursoDesde();
    return d ? reloj(this.ahora() - d) : '';
  });

  /** ¿Se puede marcar este identificador, o es un JID de WhatsApp? */
  marcable(numero: string): boolean {
    return PbxService.esNumeroMarcable(numero);
  }

  iconoOrigen(l: Llamada): NombreIcono {
    return l.origen === 'whatsapp_llamada' || l.origen === 'whatsapp_chat'
      ? 'chat'
      : 'telefono';
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  tomarDeLaCola(l: Llamada): void {
    this.tomar.emit(l);
  }

  alternarTeclado(): void {
    this.tecleando.update((v) => !v);
    this.avisoMarcado.set('');
  }

  alternarTransferir(): void {
    this.eligiendoDestino.update((v) => !v);
  }

  /**
   * Una tecla: tono si hay llamada, dígito si no.
   *
   * El mismo teclado hace las dos cosas porque son la misma acción para quien
   * lo usa —«marcar»— y tener dos teclados separados para eso sería obligarse
   * a elegir cuál antes de saber qué se quiere.
   */
  tecla(t: string): void {
    if (this.sp.enCurso()) {
      this.sp.tono(t);
      return;
    }
    this.marcado.update((v) => (v + t).slice(0, 20));
  }

  borrarUna(): void {
    this.marcado.update((v) => v.slice(0, -1));
  }

  /** Pide a la central que llame al número del teclado. */
  llamarAlMarcado(): void {
    const n = this.marcado().trim();
    if (!n) return;
    this.avisoMarcado.set('Pidiendo la llamada…');
    this.pbx.marcar(n).subscribe({
      next: (r) => {
        this.avisoMarcado.set(r.mensaje);
        if (r.ok) this.marcado.set('');
      },
      error: (e) =>
        this.avisoMarcado.set(
          e?.error?.message ?? 'No se pudo pedir la llamada a la central.',
        ),
    });
  }

  pasarA(extension: string): void {
    this.eligiendoDestino.set(false);
    void this.sp.transferir(extension);
  }
}

/** Milisegundos a `mm:ss`, o `h:mm:ss` cuando se pasa de la hora. */
function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const dos = (n: number) => String(n).padStart(2, '0');
  return hh ? `${hh}:${dos(mm)}:${dos(ss)}` : `${dos(mm)}:${dos(ss)}`;
}
