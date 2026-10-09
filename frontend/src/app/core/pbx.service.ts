import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Llamada, PbxConfig } from './models';

/**
 * Qué se escribe en el campo «Abonado» al tomar una llamada, y qué se le
 * advierte al operador.
 *
 * Lo que manda la central SIEMPRE se escribe, aunque no sea un número: para los
 * contactos de WhatsApp manda un identificador de sesión
 * (`+CO.4552575428314811`), y ese identificador es el único rastro de quién
 * llamó. Dejar el campo vacío lo perdía: el caso quedaba sin nada que lo ate al
 * contacto, ni para devolver la llamada ni para cruzarlo con la central.
 *
 * Lo que sí cambia es que no se presenta como si fuera un teléfono: va con la
 * advertencia de que la central no mandó el número y de que hay que pedírselo
 * al ciudadano. El operador lo sobrescribe en cuanto lo tenga.
 *
 * Función aparte y pura a propósito: es una decisión pequeña con consecuencias
 * —lo que quede ahí se guarda en el caso como el teléfono del ciudadano— y así
 * se puede probar sin montar media pantalla.
 */
export function abonadoDeLlamada(numero: string): { abonado: string; aviso: string } {
  if (PbxService.esNumeroMarcable(numero)) return { abonado: numero, aviso: '' };
  return {
    abonado: numero,
    aviso: `La central no envió el número del ciudadano (envió «${numero}»). Pregúnteselo y escríbalo aquí.`,
  };
}

/**
 * Cliente de la integración con la planta telefónica (PBX). Mantiene la cola de
 * llamadas en vivo (REST inicial + Socket.IO namespace /pbx) para el screen-pop,
 * y expone la configuración (API key + webhook) para administración.
 */
@Injectable({ providedIn: 'root' })
export class PbxService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private socket?: Socket;

  /** Cola de llamadas (recientes primero). */
  readonly llamadas = signal<Llamada[]>([]);
  /**
   * Solo las que están timbrando Y le corresponden a esta sesión: una llamada
   * que otro operador ya tomó (o que el ACD dirigió a otro) desaparece de la
   * cola en cuanto llega su aviso — es la misma regla que aplica el servidor
   * al listar, repetida aquí porque los avisos en vivo van a todo el tenant.
   * Un supervisor (casos.ver_todos) las ve todas, con la pista de para quién.
   */
  readonly sonando = computed(() => this.llamadas().filter((l) => l.estado === 'sonando' && this.meCorresponde(l)));
  /** Última llamada entrante no atendida, para avisos globales. */
  readonly ultimaEntrante = signal<Llamada | null>(null);

  /**
   * ¿El canal en vivo está arriba ahora mismo?
   *
   * En una sala de despacho, una cola vacía es ambigua: puede querer decir «no
   * hay llamadas» o «dejé de enterarme». El operador tiene que poder
   * distinguirlas sin refrescar para averiguarlo.
   */
  readonly enVivo = signal(false);

  /**
   * ¿Se espera que exista canal en vivo?
   *
   * Falso mientras nadie haya llamado a `conectar()`, que es lo que pasa
   * cuando la instancia no tiene contratada la planta telefónica: el shell ni
   * lo intenta. Sin esto, `enVivo` en falso se interpretaba como «se cayó», y
   * Recepción anunciaba «reconectando» de forma permanente a centrales que
   * nunca tuvieron canal — un aviso de avería donde no hay avería.
   */
  readonly canalEsperado = signal(false);

  /**
   * Reintentos tras un cierre DEL SERVIDOR. Acotados: si el servidor rechaza el
   * saludo porque la sesión ya no vale, insistir para siempre no la revive y
   * solo gasta red. Al agotarlos, `enVivo` queda en falso y la pantalla lo dice.
   */
  private reintentos = 0;
  private static readonly MAX_REINTENTOS = 5;
  /** El canal se apagó a propósito (cambio de instancia, salida): no se reabre solo. */
  private apagadoAProposito = false;

  /**
   * ¿Ese identificador se puede marcar?
   *
   * Misma regla que `PbxService.esNumeroMarcable` del backend (E.164 admite 15
   * dígitos; menos de 7 no es un abonado), repetida aquí porque la pantalla
   * tiene que decidir sin preguntar. Hace falta porque la central no siempre
   * manda un número: para los contactos de WhatsApp manda un identificador de
   * sesión (`+CO.1744934636794102`), y eso no se marca ni se escribe en el
   * campo Abonado como si lo fuera.
   */
  static esNumeroMarcable(valor: string | null | undefined): boolean {
    const digitos = (valor ?? '').replace(/\D/g, '');
    return digitos.length >= 7 && digitos.length <= 15;
  }

  /** Timbre encendido/apagado; la elección se recuerda en el puesto de trabajo. */
  readonly sonidoActivo = signal(localStorage.getItem('falconcad_pbx_sonido') !== 'off');

  alternarSonido(): void {
    this.sonidoActivo.update((v) => !v);
    try { localStorage.setItem('falconcad_pbx_sonido', this.sonidoActivo() ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
  }

  /**
   * ¿A esta sesión le toca ver/oír esta llamada? Una que otro operador ya tomó
   * (o que el ACD dirigió a otro) no es suya — es la misma regla que aplica el
   * servidor al listar, repetida aquí porque los avisos en vivo van a todo el
   * tenant. Un supervisor (casos.ver_todos) las VE todas —para poder auxiliar
   * un puesto vacío—, pero solo le SUENAN las suyas: ver y sonar no son lo
   * mismo (ver `esMia`).
   */
  private meCorresponde(l: Llamada): boolean {
    const s = this.auth.sesion();
    const supervisor = s?.rol === 'superadmin' || (s?.permisos ?? []).includes('casos.ver_todos');
    return supervisor || this.esMia(l);
  }

  /**
   * ¿Esta llamada es MÍA? Sin excepción para la supervisión, a diferencia de
   * `meCorresponde`.
   *
   * Ver y sonar no son lo mismo. La supervisión ve toda la cola para poder
   * auxiliar un puesto vacío; que además le TIMBRE cada llamada de la ciudad
   * convierte el aviso en ruido, y un aviso que suena siempre deja de avisar.
   * Suena solo lo que es de uno, o lo que no tiene dueño.
   */
  esMia(l: Llamada): boolean {
    const s = this.auth.sesion();
    return !l.destinatario || l.destinatario === s?.usuario;
  }

  private readonly base = environment.apiBaseUrl;
  /**
   * Origen del canal en vivo. `wsBaseUrl` explícito cuando la API vive en otro
   * dominio que el frontend (p. ej. Vercel + Render); vacío cuando los sirve
   * el MISMO origen (nginx, un solo servidor) — ahí basta una ruta relativa
   * (`/pbx`), exactamente como ya hace `CasosWsService` con `/casos` y
   * `VideollamadaService` con `/video`. ANTES había además una condición
   * `hayCanalVivo` que apagaba el socket entero cuando `wsBaseUrl` venía vacío
   * — copiada de cuando el frontend se publicaba en Vercel (ESA reescritura sí
   * era incapaz de reenviar websockets). Nginx sirviendo API y frontend del
   * mismo origen sí los reenvía bien —si no, el tablero en vivo de Despacho y
   * el chat interno tampoco funcionarían, y si funcionan—, así que esa
   * condición solo apagaba el aviso de llamada entrante sin ninguna razón
   * real: el operador tenía que refrescar la página a mano para enterarse de
   * que había una llamada esperando.
   */
  private get wsBase(): string {
    const explicito = (environment as { wsBaseUrl?: string }).wsBaseUrl;
    if (explicito) return explicito;
    return environment.apiBaseUrl.replace(/\/api\/?$/, '');
  }

  /**
   * Abre el socket. Método aparte para poder sustituirlo en las pruebas por un
   * doble: sin esta costura, lo único comprobable sería que el servicio no
   * revienta, y lo que hay que comprobar es que al reconectar vuelve a pedir la
   * cola.
   */
  protected crearSocket(): Socket {
    return io(`${this.wsBase}/pbx`, {
      // El superadmin no tiene tenant propio: indica cuál escucha.
      auth: { token: this.auth.token, tenant: this.auth.tenantActivo() },
      transports: ['websocket', 'polling'],
    });
  }

  /** Carga la cola y abre el canal en vivo (idempotente). */
  conectar(): void {
    this.apagadoAProposito = false;
    this.canalEsperado.set(true);
    this.recargar();
    if (this.socket?.connected) return;
    this.socket = this.crearSocket();

    // CADA vez que el canal se (re)establece, se vuelve a pedir la cola.
    //
    // Socket.IO se reconecta solo, pero NO reenvía lo que emitió mientras el
    // cliente estuvo caído: una llamada que entró durante ese hueco se pierde
    // para siempre y la pantalla se queda vieja hasta que alguien oprima F5.
    // Y el hueco no es raro: basta una caída de red, la pantalla suspendida, o
    // un despliegue —que reinicia las tres réplicas una por una y desconecta a
    // todos los operadores—.
    //
    // El socket sirve para enterarse rápido; la verdad está en el servidor y se
    // vuelve a preguntar en cuanto hay por dónde.
    this.socket.on('connect', () => {
      this.reintentos = 0;
      this.enVivo.set(true);
      this.recargar();
    });

    // Un cierre ordenado DEL SERVIDOR es un callejón sin salida: cuando el
    // servidor cierra la conexión —el saludo no pasó: token vencido, instancia
    // reiniciando a mitad del saludo— socket.io NO vuelve a intentarlo solo.
    // Sin esto, ese operador se queda sin aviso en vivo el resto de su jornada
    // y tiene que descubrirlo oprimiendo F5. Se reabre con el token VIGENTE,
    // que es la diferencia: el socket viejo lleva pegado el de hace horas.
    this.socket.on('disconnect', (motivo: string) => {
      this.enVivo.set(false);
      if (motivo !== 'io server disconnect' || this.apagadoAProposito) return;
      if (this.reintentos >= PbxService.MAX_REINTENTOS) return;
      this.reintentos++;
      this.reabrirMasTarde(1000 * this.reintentos, () => this.reabrirAhora());
    });

    this.socket.on('llamada:entrante', (l: Llamada) => {
      this.upsert(l);
      this.ultimaEntrante.set(l);
      // El aviso suena en el momento del timbrazo, no cuando alguien la
      // convierte en caso: antes no había NINGÚN sonido atado al evento real
      // de "está timbrando", así que el operador dependía de mirar la
      // pantalla de Recepción para enterarse.
      if (this.sonidoActivo() && this.esMia(l)) this.timbre();
    });
    this.socket.on('llamada:cambio', (l: Llamada) => this.upsert(l));
  }

  /**
   * Dos tonos por WebAudio, distintos del aviso de "caso nuevo" del tablero.
   *
   * Un AudioContext nace SUSPENDIDO si la pestaña todavía no tuvo ninguna
   * interacción del usuario (política de autoplay del navegador): sin el
   * resume(), el timbre "suena" en el código pero no se oye nada — es la
   * causa más probable de que el aviso pareciera funcionar a veces sí, a
   * veces no.
   */
  private timbre(): void {
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const tono = (inicio: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + inicio + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + inicio);
        osc.stop(ctx.currentTime + inicio + 0.24);
      };
      tono(0, 1046);
      tono(0.26, 1046);
      setTimeout(() => ctx.close(), 800);
    } catch { /* sin audio disponible */ }
  }

  /**
   * CUÁNDO se reabre. Separado solo para eso: las pruebas lo sustituyen para
   * adelantar el reloj sin esperar en tiempo real. El QUÉ se hace vive en
   * `reabrirAhora`, que no se sustituye — así la prueba ejercita la lógica de
   * verdad y no una copia suya.
   */
  protected reabrirMasTarde(ms: number, reabrir: () => void): void {
    setTimeout(reabrir, ms);
  }

  private reabrirAhora(): void {
    if (this.apagadoAProposito) return;
    this.socket = undefined;
    this.conectar();
  }

  desconectar(): void {
    this.apagadoAProposito = true;
    this.socket?.disconnect();
    this.socket = undefined;
    this.enVivo.set(false);
    // Un apagado a propósito —cerrar sesión, cambiar a una instancia sin
    // planta telefónica— no es una avería: deja de esperarse canal, y por
    // tanto no hay nada que anunciar como caído.
    this.canalEsperado.set(false);
  }

  recargar(): void {
    this.http.get<Llamada[]>(`${this.base}/pbx/llamadas`).subscribe({
      next: (ls) => this.llamadas.set(ls),
      error: () => {},
    });
  }

  atender(id: string): Observable<{ llamada: Llamada; casoId: string }> {
    return this.http.post<{ llamada: Llamada; casoId: string }>(`${this.base}/pbx/llamadas/${id}/atender`, {});
  }

  /** Toma la llamada para completarla en el formulario de Recepción. */
  reclamar(id: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/pbx/llamadas/${id}/reclamar`, {});
  }

  /** Suelta una llamada tomada sin guardar caso: vuelve a la cola compartida. */
  soltar(id: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/pbx/llamadas/${id}/soltar`, {});
  }

  /** Enlaza la llamada con el caso que el formulario acaba de guardar. */
  vincular(id: string, casoId: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/pbx/llamadas/${id}/vincular`, { casoId });
  }

  config(): Observable<PbxConfig> {
    return this.http.get<PbxConfig>(`${this.base}/pbx/config`);
  }

  rotarKey(): Observable<PbxConfig> {
    return this.http.post<PbxConfig>(`${this.base}/pbx/config/rotar`, {});
  }

  /** URL completa del webhook para pegar en la configuración de la PBX. */
  webhookUrl(path: string): string {
    const origin = this.base.replace(/\/api\/?$/, '');
    return `${origin}${path}`;
  }

  private upsert(l: Llamada): void {
    this.llamadas.update((arr) => {
      const i = arr.findIndex((x) => x.id === l.id);
      if (i === -1) return [l, ...arr];
      const copia = arr.slice();
      copia[i] = l;
      return copia;
    });
    if (l.estado !== 'sonando' && this.ultimaEntrante()?.id === l.id) this.ultimaEntrante.set(null);
  }
}
