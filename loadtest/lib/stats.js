/** Acumulador simple de muestras (ms) con percentiles, para reportar al final. */
class Muestreador {
  constructor(nombre) {
    this.nombre = nombre;
    this.valores = [];
    this.errores = 0;
    this.total = 0;
  }

  registrar(ms) {
    this.total++;
    this.valores.push(ms);
  }

  registrarError() {
    this.total++;
    this.errores++;
  }

  percentil(p) {
    if (this.valores.length === 0) return null;
    const ordenado = [...this.valores].sort((a, b) => a - b);
    const idx = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
    return ordenado[idx];
  }

  resumen() {
    const ok = this.valores.length;
    const avg = ok ? this.valores.reduce((a, b) => a + b, 0) / ok : null;
    return {
      nombre: this.nombre,
      total: this.total,
      ok,
      errores: this.errores,
      tasaError: this.total ? (this.errores / this.total) * 100 : 0,
      promedioMs: avg,
      p50Ms: this.percentil(50),
      p95Ms: this.percentil(95),
      p99Ms: this.percentil(99),
      maxMs: ok ? Math.max(...this.valores) : null,
    };
  }
}

function imprimirResumen(m) {
  const r = m.resumen();
  const fmt = (n) => (n === null ? '—' : n.toFixed(0));
  console.log(
    `  ${r.nombre.padEnd(28)} total=${String(r.total).padEnd(6)} ` +
      `errores=${String(r.errores).padEnd(4)} (${r.tasaError.toFixed(1)}%)  ` +
      `avg=${fmt(r.promedioMs)}ms  p50=${fmt(r.p50Ms)}ms  p95=${fmt(r.p95Ms)}ms  p99=${fmt(r.p99Ms)}ms  max=${fmt(r.maxMs)}ms`,
  );
}

module.exports = { Muestreador, imprimirResumen };
