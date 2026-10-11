import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { CasosWsService } from './casos-ws.service';
import { PbxService } from './pbx.service';
import { ErrorRegistrado, erroresRecientes, soloRuta } from './registro-errores';

/**
 * Lo que la mesa de ayuda necesita saber y el usuario no sabe contar.
 *
 * Un reporte de soporte útil responde seis preguntas antes de que nadie las
 * haga: quién, en qué instancia, con qué versión, desde qué navegador, en qué
 * pantalla, y qué se rompió hace un momento. Ninguna la puede responder bien
 * un operador en medio de un turno, y las tres últimas no las puede responder
 * de ninguna manera. Así que las responde la aplicación.
 *
 * Nada de esto se manda solo: lo arma este servicio, el diálogo de soporte lo
 * muestra COMPLETO, y el usuario decide si lo envía. Un informe de diagnóstico
 * que viaja sin que el usuario vea qué lleva es telemetría encubierta, no
 * soporte.
 */

/** De dónde sale la versión publicada; la escribe el despliegue. */
const RUTA_VERSION = '/config/version.json';

export interface InformeDiagnostico {
  generadoEn: string;
  version: { commit: string; publicado: string };
  sesion: {
    usuario: string;
    nombre: string;
    rol: string;
    tenant: string | null;
    agencia: string | null;
  } | null;
  donde: { ruta: string };
  navegador: {
    agente: string;
    idioma: string;
    zonaHoraria: string;
    ventana: string;
    pantalla: string;
    enLinea: boolean;
  };
  canales: {
    casosEnVivo: 'sin iniciar' | 'conectado' | 'caido';
    planta: 'sin contratar o sin abrir' | 'conectada' | 'caida';
  };
  errores: ErrorRegistrado[];
}

@Injectable({ providedIn: 'root' })
export class DiagnosticoService {
  private auth = inject(AuthService);
  private router = inject(Router);
  private ws = inject(CasosWsService);
  private pbx = inject(PbxService);

  /** Se pide una vez por carga de página: no cambia mientras la pestaña viva. */
  private version: { commit: string; publicado: string } | null = null;

  /**
   * Arma el informe. Es `async` solo por la versión publicada, que vive en un
   * archivo del servidor; todo lo demás ya está en memoria.
   */
  async armar(): Promise<InformeDiagnostico> {
    const s = this.auth.sesion();
    return {
      generadoEn: new Date().toISOString(),
      version: await this.leerVersion(),
      // El token NO entra. Es una credencial viva: quien recibiera el ticket
      // podría actuar como el usuario que lo reportó.
      sesion: s
        ? {
            usuario: s.usuario,
            nombre: s.nombre,
            rol: s.rol,
            tenant: this.auth.tenantActivo(),
            agencia: s.agencia ?? null,
          }
        : null,
      // Solo la ruta: el id de un caso identifica la pantalla, pero una
      // búsqueda por teléfono dejaría el teléfono del ciudadano en el ticket.
      donde: { ruta: soloRuta(this.router.url) },
      navegador: this.navegador(),
      canales: {
        casosEnVivo: this.ws.estado,
        planta: this.estadoPlanta(),
      },
      errores: erroresRecientes(),
    };
  }

  /**
   * El informe en texto plano, para pegarlo en un correo, en un ticket o en un
   * mensaje. Deliberadamente no es JSON: lo va a leer una persona en el primer
   * nivel de la mesa, y un JSON de cuarenta líneas no se lee a las tres de la
   * mañana.
   */
  comoTexto(i: InformeDiagnostico): string {
    const l: string[] = [];
    l.push('── FALCON CAD · contexto técnico ─────────────────────');
    l.push(`Generado      ${this.local(i.generadoEn)}`);
    l.push(`Versión       ${i.version.commit} (publicada ${i.version.publicado})`);
    if (i.sesion) {
      l.push(`Usuario       ${i.sesion.nombre} (${i.sesion.usuario}) · rol ${i.sesion.rol}`);
      l.push(`Instancia     ${i.sesion.tenant ?? '—'}${i.sesion.agencia ? ` · agencia ${i.sesion.agencia}` : ''}`);
    } else {
      l.push('Usuario       sin sesión abierta');
    }
    l.push(`Pantalla      ${i.donde.ruta}`);
    l.push(`Canal casos   ${i.canales.casosEnVivo}`);
    l.push(`Planta        ${i.canales.planta}`);
    l.push(`Red           ${i.navegador.enLinea ? 'en línea' : 'SIN CONEXIÓN'}`);
    l.push(`Navegador     ${i.navegador.agente}`);
    l.push(`Entorno       ventana ${i.navegador.ventana} · pantalla ${i.navegador.pantalla} · ${i.navegador.idioma} · ${i.navegador.zonaHoraria}`);
    l.push('');
    if (!i.errores.length) {
      l.push('Sin errores registrados en esta sesión.');
    } else {
      l.push(`Últimos ${i.errores.length} errores (el más reciente al final):`);
      for (const e of i.errores) {
        // `!= null`, no truthy: el estado 0 —sin respuesta— es informativo, y
        // con una comparación por verdad se perdía justo el caso más común.
        const estado = e.estado != null ? ` [${e.estado}]` : '';
        const veces = e.veces && e.veces > 1 ? ` (×${e.veces})` : '';
        l.push(`  ${this.hora(e.en)}  ${e.que}${estado}${veces}${e.detalle ? ` — ${e.detalle}` : ''}`);
      }
    }
    l.push('──────────────────────────────────────────────────────');
    return l.join('\n');
  }

  private estadoPlanta(): InformeDiagnostico['canales']['planta'] {
    // Mismo criterio que el aviso de Recepción: sin `canalEsperado` nadie
    // intentó abrir la planta, así que no está "caída" — no existe aquí.
    if (!this.pbx.canalEsperado()) return 'sin contratar o sin abrir';
    return this.pbx.enVivo() ? 'conectada' : 'caida';
  }

  private navegador(): InformeDiagnostico['navegador'] {
    const n = typeof navigator !== 'undefined' ? navigator : undefined;
    const w = typeof window !== 'undefined' ? window : undefined;
    let zona = '—';
    try {
      zona = Intl.DateTimeFormat().resolvedOptions().timeZone || '—';
    } catch { /* sin Intl utilizable */ }
    return {
      agente: n?.userAgent ?? '—',
      idioma: n?.language ?? '—',
      zonaHoraria: zona,
      ventana: w ? `${w.innerWidth}×${w.innerHeight}` : '—',
      pantalla: w?.screen ? `${w.screen.width}×${w.screen.height}` : '—',
      // `onLine` en falso es certeza de que no hay red; en verdadero no
      // garantiza que el servidor conteste. Aun así responde la pregunta que
      // más veces resulta ser la causa.
      enLinea: n?.onLine !== false,
    };
  }

  /**
   * La versión publicada. En desarrollo el archivo no existe y eso no es un
   * fallo: se informa como tal y el reporte sigue sirviendo.
   */
  private async leerVersion(): Promise<{ commit: string; publicado: string }> {
    if (this.version) return this.version;
    const desconocida = {
      commit: environment.production ? 'sin sello' : 'desarrollo',
      publicado: '—',
    };
    try {
      const res = await fetch(RUTA_VERSION, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { commit?: string; publicado?: string };
      if (!j?.commit) throw new Error('sin commit');
      this.version = { commit: String(j.commit), publicado: String(j.publicado ?? '—') };
      return this.version;
    } catch {
      // No se memoriza el fallo: si el archivo aparece (un despliegue en
      // caliente), el próximo reporte ya lo lee.
      return desconocida;
    }
  }

  private local(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  private hora(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
  }
}
