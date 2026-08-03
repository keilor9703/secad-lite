import { Injectable, computed, effect, signal } from '@angular/core';

/** Preferencia de apariencia del usuario. */
export type Tema = 'sistema' | 'claro' | 'oscuro';

const STORAGE_KEY = 'falconcad_tema';

/**
 * Tema claro / oscuro. La preferencia se guarda en el navegador y se aplica
 * como `data-tema` en <html>, que es lo que consumen las variables de color
 * (ver styles.scss). Con 'sistema' se retira el atributo y manda la
 * configuración del sistema operativo, incluso si cambia con la sesión abierta.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly _preferencia = signal<Tema>(this.leer());
  private readonly sistemaOscuro = signal(this.consultarSistema());

  readonly preferencia = this._preferencia.asReadonly();
  /** Tema realmente aplicado ('sistema' ya resuelto). */
  readonly efectivo = computed<'claro' | 'oscuro'>(() => {
    const p = this._preferencia();
    if (p !== 'sistema') return p;
    return this.sistemaOscuro() ? 'oscuro' : 'claro';
  });

  constructor() {
    this.mq()?.addEventListener('change', (e) => this.sistemaOscuro.set(e.matches));
    effect(() => this.aplicar(this._preferencia()));
  }

  elegir(tema: Tema): void {
    this._preferencia.set(tema);
    try {
      localStorage.setItem(STORAGE_KEY, tema);
    } catch { /* almacenamiento no disponible */ }
  }

  // ---------------------------------------------------------------------------
  private aplicar(tema: Tema): void {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    if (tema === 'sistema') delete html.dataset['tema'];
    else html.dataset['tema'] = tema;
  }

  private mq(): MediaQueryList | null {
    return typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  }

  private consultarSistema(): boolean {
    return this.mq()?.matches ?? false;
  }

  private leer(): Tema {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'claro' || v === 'oscuro' || v === 'sistema' ? v : 'sistema';
    } catch {
      return 'sistema';
    }
  }
}
