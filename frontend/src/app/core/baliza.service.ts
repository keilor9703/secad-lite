import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CasosWsService } from './casos-ws.service';
import { PbxService } from './pbx.service';
import { Caso } from './models';

/** Por qué está encendida la baliza. Decide el texto que se le lee a un lector de pantalla. */
export type MotivoBaliza = 'llamada' | 'caso' | 'ambos';

/**
 * Qué está esperando atención AHORA, mire el usuario la pantalla que mire.
 *
 * El problema que resuelve: cada módulo avisaba de lo suyo pero solo mientras
 * se estaba dentro. El despachador que estaba consultando un histórico no se
 * enteraba de que le había entrado un caso, y quien recepciona no veía la
 * llamada si tenía abierto el mapa. El aviso tiene que vivir en la barra
 * superior, que es lo único que está en todas las pantallas.
 *
 * Dos fuentes, una por oficio:
 *
 * - **Llamadas timbrando sin tomar** (`PbxService.sonando`), para quien
 *   recepciona. Ya existía como señal; aquí solo se mira.
 * - **Casos que llegaron a mi bandeja y nadie ha tomado**, para quien despacha.
 *   Se siguen por el socket de casos: entra con `caso:nuevo` y sale en cuanto
 *   su estado EN MI CANAL deja de ser «nuevo» —o sea, en cuanto alguien lo
 *   toma—, que es literalmente «hasta que sea tomado o gestionado».
 *
 * Lo que deliberadamente NO hace: encenderse por el atraso que ya había al
 * entrar. La baliza anuncia que algo ACABA DE LLEGAR; si se encendiera por
 * los quince casos que llevan una hora en la cola, estaría prendida todo el
 * turno y dejaría de significar nada. El atraso lo muestra la cola de
 * Despacho, que es su sitio.
 */
@Injectable({ providedIn: 'root' })
export class BalizaService {
  private readonly auth = inject(AuthService);
  private readonly pbx = inject(PbxService);
  private readonly ws = inject(CasosWsService);

  /** Ids de casos llegados a mi bandeja que siguen sin tomar. */
  private readonly sinTomar = signal<ReadonlySet<string>>(new Set());

  /** Mi bandeja. Sin canal propio no hay a qué llegarle, y la fuente se apaga sola. */
  private readonly miCanal = computed(() => this.auth.sesion()?.canales?.[0] ?? null);

  readonly casosSinTomar = computed(() => this.sinTomar().size);
  readonly llamadasSonando = computed(() => this.pbx.sonando().length);

  /** ¿Hay algo esperando? Es lo que enciende la baliza de la barra. */
  readonly activa = computed(() => this.llamadasSonando() > 0 || this.casosSinTomar() > 0);

  readonly motivo = computed<MotivoBaliza | null>(() => {
    const ll = this.llamadasSonando() > 0;
    const cs = this.casosSinTomar() > 0;
    if (ll && cs) return 'ambos';
    if (ll) return 'llamada';
    if (cs) return 'caso';
    return null;
  });

  /**
   * Lo que oye quien usa lector de pantalla. La baliza es una señal visual, y
   * sin esto no existiría para quien no la ve.
   */
  readonly anuncio = computed(() => {
    const ll = this.llamadasSonando();
    const cs = this.casosSinTomar();
    const partes: string[] = [];
    if (ll) partes.push(ll === 1 ? 'una llamada en espera' : `${ll} llamadas en espera`);
    if (cs) partes.push(cs === 1 ? 'un caso nuevo sin tomar' : `${cs} casos nuevos sin tomar`);
    return partes.length ? `Atención: ${partes.join(' y ')}.` : '';
  });

  private iniciado = false;

  /**
   * Empieza a escuchar. Lo llama el armazón una vez por sesión; repetirlo no
   * hace nada, y `CasosWsService.conectar()` ya es idempotente (el tablero de
   * Despacho abre el mismo socket cuando se entra en él).
   */
  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;
    // Sin bandeja propia no puede llegarle un caso a nadie: no se abre el
    // socket. Un administrador que solo gestiona catálogos no tiene por qué
    // mantener una conexión en vivo toda la jornada. La parte de llamadas no
    // depende de esto —se lee de `PbxService`, que tiene sus propias reglas—.
    if (!this.miCanal()) return;
    this.ws.conectar();
    this.ws.eventos.subscribe(({ tipo, caso }) => this.aplicar(tipo, caso));
  }

  /** Al cambiar de instancia o cerrar sesión no se arrastra lo de la anterior. */
  limpiar(): void {
    this.sinTomar.set(new Set());
  }

  /**
   * El estado que cuenta es el de MI canal, no el del caso.
   *
   * El socket emite a toda la instancia —hay una sola sala por inquilino— así
   * que cada pantalla filtra lo suyo. Y un caso puede ir muy por delante en
   * otra entidad y seguir sin tomar en la mía: si se mirara `caso.estado` la
   * baliza se apagaría porque la Policía ya despachó, dejando a Bomberos sin
   * aviso. Mismo criterio que usa el tablero de Despacho.
   */
  private aplicar(tipo: 'nuevo' | 'actualizado', caso: Caso): void {
    const canal = this.miCanal();
    if (!canal) return;

    const mio = caso.canalesEstado?.find((e) => e.canalId === canal);
    // Sin estados por canal (caso sin bandejas) vale el del propio caso.
    const estado = mio?.estado ?? (caso.canalesEstado ? null : caso.estado);

    const sigueEsperando = estado === 'nuevo';
    this.sinTomar.update((previo) => {
      const estaba = previo.has(caso.id);
      // `caso:actualizado` de algo que nunca anunciamos no enciende nada: la
      // baliza es para lo que LLEGA, no para lo que ya estaba cuando entramos.
      if (sigueEsperando && (tipo === 'nuevo' || estaba)) {
        if (estaba) return previo;
        const s = new Set(previo); s.add(caso.id); return s;
      }
      if (!estaba) return previo;
      const s = new Set(previo); s.delete(caso.id); return s;
    });
  }
}
