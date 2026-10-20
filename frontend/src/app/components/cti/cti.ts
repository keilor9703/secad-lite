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
 * Lo que se admite al teclear un número.
 *
 * El «+» está aquí y NO entre las teclas del teclado, y la razón es técnica:
 * el «+» no es un tono DTMF. Marcarlo como tecla significaría ofrecer, en
 * mitad de una llamada, un botón que no manda nada. Pertenece a componer el
 * número —es el prefijo internacional— no a hablar con la central.
 */
const ADMITIDOS = /[0-9*#+]/;

/** Un número de teléfono no pasa de aquí. E.164 admite 15 dígitos. */
const LARGO_MAXIMO = 20;

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


  /** Se repinta cada segundo: relojes de llamada y de espera. */
  private readonly ahora = signal(Date.now());
  private readonly reloj = setInterval(() => this.ahora.set(Date.now()), TIC_MS);


  readonly teclas = TECLAS;
  readonly tecleando = signal(false);
  readonly marcado = signal('');
  /** Los tonos que se han mandado en esta llamada, para poder verlos. */
  readonly tonosEnviados = signal('');
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

  // ── Recibir o no recibir llamadas ────────────────────────────────────────

  readonly pausado = computed(() => !!this.sp.pausadoDesde());

  /** Cuánto lleva este puesto sin recibir llamadas. */
  readonly tiempoEnPausa = computed(() => {
    const d = this.sp.pausadoDesde();
    return d ? reloj(this.ahora() - d) : '';
  });

  /**
   * Pausar con una llamada en curso la cortaría: dar de baja el registro
   * cierra el transporte. Quien se vaya, cuelga primero.
   */
  readonly puedeCambiarPausa = computed(() => !this.sp.enCurso());

  alternarPausa(): void {
    if (!this.puedeCambiarPausa()) return;
    void (this.pausado() ? this.sp.reanudar() : this.sp.pausar());
  }

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


  // ── Acciones ───────────────────────────────────────────────────────────────


  alternarTeclado(): void {
    this.tecleando.update((v) => !v);
    this.avisoMarcado.set('');
  }

  /**
   * Lo que el operador escribe con SU teclado.
   *
   * Marcar un número de diez dígitos pulsando uno por uno con el ratón es
   * lento justo cuando no se puede ir lento. Se filtra en vez de confiar en
   * el `inputmode`: un pegado trae paréntesis, espacios y guiones, y el
   * campo tiene que quedar con un número marcable.
   */
  escribir(e: Event): void {
    const crudo = (e.target as HTMLInputElement)?.value ?? '';
    const limpio = [...crudo]
      .filter((c) => ADMITIDOS.test(c))
      .join('')
      .slice(0, LARGO_MAXIMO);
    this.marcado.set(limpio);
    // El campo se reescribe con lo filtrado: si no, lo que se ve y lo que se
    // va a marcar dejan de ser lo mismo.
    (e.target as HTMLInputElement).value = limpio;
  }

  /**
   * Teclas físicas DURANTE una llamada: cada una manda su tono.
   *
   * Va atado a su propio campo y no al documento a propósito. En Recepción,
   * durante una llamada, el operador está escribiendo el caso: un oyente
   * global mandaría un tono por cada letra que teclee.
   */
  tonoFisico(e: KeyboardEvent): void {
    if (e.key === 'Backspace' || e.key === 'Tab' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    // El «+» no es un tono: no se manda ni se apunta.
    if (e.key.length !== 1 || !/[0-9*#]/.test(e.key)) return;
    this.sp.tono(e.key);
    this.tonosEnviados.update((v) => (v + e.key).slice(-LARGO_MAXIMO));
  }

  /** El prefijo internacional. Solo al componer: no es un tono. */
  ponerMas(): void {
    if (this.sp.enCurso()) return;
    this.marcado.update((v) => (v + '+').slice(0, LARGO_MAXIMO));
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
      this.tonosEnviados.update((v) => (v + t).slice(-LARGO_MAXIMO));
      return;
    }
    this.marcado.update((v) => (v + t).slice(0, LARGO_MAXIMO));
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
