/**
 * EL TIMBRE DEL TELÉFONO
 *
 * Un teléfono que no suena no es un teléfono. En una sala de despacho el
 * operador está mirando el mapa, el tablero o el formulario — no la esquina
 * donde vive la barra. Si la llamada solo se anuncia con un cambio de color,
 * se pierde.
 *
 * Se genera con WebAudio y no con un archivo: no hay que servir ni cachear
 * nada, suena igual sin conexión, y el patrón se puede afinar sin volver a
 * grabar. Son dos tonos cortos (el doble timbrazo de siempre) repetidos cada
 * tres segundos mientras la llamada siga entrando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DETALLE QUE LO DEJA MUDO
 *
 * Un `AudioContext` nace SUSPENDIDO si la pestaña todavía no tuvo ninguna
 * interacción del usuario (política de reproducción automática). Por eso se
 * crea al ENCENDER el teléfono —que es un clic— y no cuando entra la primera
 * llamada, que es justo cuando no hay ningún gesto que lo autorice. Esa es la
 * diferencia entre «suena» y «suena a veces».
 * ────────────────────────────────────────────────────────────────────────────
 */
export class Timbre {
  private ctx?: AudioContext;
  private reloj?: ReturnType<typeof setInterval>;

  /** ¿Está sonando ahora mismo? */
  sonando(): boolean {
    return !!this.reloj;
  }

  /**
   * Prepara el audio. Se llama desde un clic del operador (encender el
   * teléfono), que es lo que desbloquea la reproducción en el navegador.
   */
  preparar(): void {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* sin audio en este navegador */ }
  }

  /** Empieza a sonar, y sigue hasta que se le diga. Llamarlo dos veces no suma. */
  arrancar(): void {
    if (this.reloj) return;
    this.preparar();
    this.repique();
    this.reloj = setInterval(() => this.repique(), 3000);
  }

  parar(): void {
    clearInterval(this.reloj);
    this.reloj = undefined;
  }

  /** Suelta el audio del todo: al apagar el teléfono o al salir. */
  soltar(): void {
    this.parar();
    try { void this.ctx?.close(); } catch { /* ya estaba cerrado */ }
    this.ctx = undefined;
  }

  /** Un doble timbrazo. */
  private repique(): void {
    this.tono(0);
    this.tono(0.42);
  }

  private tono(enSegundos: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      // Dos frecuencias a la vez sonarían a timbre de verdad, pero una sola
      // onda senoidal se distingue mejor del ruido de una sala y no satura en
      // los altavoces baratos de un puesto de trabajo.
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t = ctx.currentTime + enSegundos;
      // Rampas en vez de cortes: un arranque seco suena a chasquido.
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(vol).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    } catch { /* el contexto se cerró entre medias */ }
  }
}
