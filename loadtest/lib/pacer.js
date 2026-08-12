function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Respeta un tope de "N por minuto" (ventana deslizante), para no chocar
 * contra el @Throttle(5/min) de /auth/login mientras el setup inicia sesión
 * con decenas de usuarios de prueba.
 */
class LoginPacer {
  constructor(maxPerMinute) {
    this.max = maxPerMinute;
    this.timestamps = [];
  }

  async wait() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
    if (this.timestamps.length >= this.max) {
      const oldest = this.timestamps[0];
      const waitMs = 60_000 - (now - oldest) + 250;
      await sleep(waitMs);
      return this.wait();
    }
    this.timestamps.push(Date.now());
  }
}

module.exports = { sleep, LoginPacer };
