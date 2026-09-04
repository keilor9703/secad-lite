import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { MetricasService, Resumen, Cumplimiento, Hallazgos, Ranking } from './metricas.service';

const COLOR_INK = '#102639';
const COLOR_MUTED = '#6a7d90';
const COLOR_ACCENT = '#0a6273';
const COLOR_BORDE = '#dce5ee';
const COLOR_OK = '#1c7a44';
const COLOR_WARN = '#a5620a';
const COLOR_DANGER = '#b4342a';

const PRIORIDAD_LABEL: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const ESTADO_LABEL: Record<string, string> = {
  nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado',
};

/**
 * Informe de gestión en PDF: la misma lectura del Panel (KPIs, hallazgos,
 * cumplimiento, tiempos, canal/agencia, ranking) para imprimir o adjuntar a
 * un correo — pdfkit genera el documento en memoria, sin depender de un
 * navegador headless ni de LibreOffice, así que corre dentro de la imagen
 * Alpine del backend sin nada adicional.
 */
@Injectable()
export class InformePdfService {
  constructor(private readonly metricas: MetricasService) {}

  async generar(tenant: string, opts?: { desde?: string; hasta?: string }): Promise<PDFKit.PDFDocument> {
    const [resumen, cumplimiento, hallazgos, ranking] = await Promise.all([
      this.metricas.resumen(tenant, opts),
      this.metricas.cumplimiento(tenant, opts),
      this.metricas.hallazgos(tenant, opts),
      this.metricas.ranking(tenant, opts),
    ]);

    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    doc.font('Helvetica');

    this.encabezado(doc, tenant, resumen);
    this.seccionKpis(doc, resumen);
    this.seccionHallazgos(doc, hallazgos);
    this.seccionCumplimiento(doc, cumplimiento);
    this.seccionTiempos(doc, resumen);
    this.seccionCanalYAgencia(doc, resumen);
    this.seccionRanking(doc, ranking);
    this.piePagina(doc);

    doc.end();
    return doc;
  }

  private encabezado(doc: PDFKit.PDFDocument, tenant: string, r: Resumen): void {
    doc.fontSize(18).fillColor(COLOR_INK).text('FALCON CAD — Informe de gestión', { continued: false });
    doc.fontSize(10).fillColor(COLOR_MUTED)
      .text(`Tenant: ${tenant}   ·   Período: ${r.periodo.desde} – ${r.periodo.hasta}   ·   Generado: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(0.8);
    this.linea(doc);
    doc.moveDown(0.6);
  }

  private seccionKpis(doc: PDFKit.PDFDocument, r: Resumen): void {
    this.titulo(doc, 'Resumen del período');
    const cols = [
      { l: 'Casos del período', v: String(r.total) },
      { l: 'Período anterior', v: String(r.periodoAnterior.total) },
      { l: 'Tiempo toma prom.', v: this.duracion(r.tiempos.global?.tomaMin ?? null) },
      { l: 'Tiempo cierre prom.', v: this.duracion(r.tiempos.global?.cierreMin ?? null) },
    ];
    const anchoCol = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / cols.length;
    const y = doc.y;
    cols.forEach((c, i) => {
      const x = doc.page.margins.left + i * anchoCol;
      doc.fontSize(14).fillColor(COLOR_ACCENT).text(c.v, x, y, { width: anchoCol - 10 });
      doc.fontSize(8).fillColor(COLOR_MUTED).text(c.l.toUpperCase(), x, doc.y, { width: anchoCol - 10 });
    });
    // .text(str, x, y) deja el cursor de pdfkit (doc.x) parado en esa columna
    // — hay que devolverlo al margen izquierdo o todo lo que siga (títulos,
    // párrafos sin x explícito) hereda ese corrimiento.
    doc.x = doc.page.margins.left;
    doc.y = y + 46;
    doc.moveDown(0.4);

    const filas = Object.entries(r.porEstado).map(([k, v]) => [ESTADO_LABEL[k] ?? k, String(v)]);
    this.tabla(doc, ['Estado', 'Casos'], filas);
    doc.moveDown(0.6);
  }

  private seccionHallazgos(doc: PDFKit.PDFDocument, h: Hallazgos): void {
    this.titulo(doc, 'Hallazgos automáticos');
    for (const item of h.items) {
      const color = item.severidad === 'critico' ? COLOR_DANGER : item.severidad === 'atencion' ? COLOR_WARN : COLOR_MUTED;
      doc.fontSize(10).fillColor(color).text(`•  ${item.titulo}`, { continued: false });
      doc.fontSize(9).fillColor(COLOR_MUTED).text(`   ${item.detalle}`);
      doc.moveDown(0.25);
    }
    doc.moveDown(0.4);
  }

  private seccionCumplimiento(doc: PDFKit.PDFDocument, c: Cumplimiento): void {
    this.titulo(doc, 'Cumplimiento de despacho por prioridad');
    const filas = c.porPrioridad.map((p) => [
      PRIORIDAD_LABEL[p.prioridad] ?? p.prioridad,
      `${p.metaMin} min`,
      p.porcentaje === null ? 'sin datos' : `${p.dentroDeMeta} / ${p.totalDespachados} (${p.porcentaje}%)`,
    ]);
    this.tabla(doc, ['Prioridad', 'Meta', 'Dentro de meta'], filas);
    doc.moveDown(0.6);
  }

  private seccionTiempos(doc: PDFKit.PDFDocument, r: Resumen): void {
    this.titulo(doc, 'Tiempos de respuesta por prioridad');
    if (!r.tiempos.porPrioridad.length) {
      doc.fontSize(9).fillColor(COLOR_MUTED).text('Sin casos en este período.');
      doc.moveDown(0.6);
      return;
    }
    const filas = r.tiempos.porPrioridad.map((f) => [
      PRIORIDAD_LABEL[f.prioridad] ?? f.prioridad,
      String(f.total),
      this.duracion(f.tomaMin),
      this.duracion(f.despachoMin),
      this.duracion(f.cierreMin),
    ]);
    this.tabla(doc, ['Prioridad', 'Casos', 'Tomado', 'Primer recurso', 'Cierre'], filas);
    doc.moveDown(0.6);
  }

  private seccionCanalYAgencia(doc: PDFKit.PDFDocument, r: Resumen): void {
    this.titulo(doc, 'Casos por agencia');
    if (!r.porAgencia.length) {
      doc.fontSize(9).fillColor(COLOR_MUTED).text('Sin datos.');
    } else {
      this.tabla(doc, ['Agencia', 'Casos'], r.porAgencia.map((a) => [a.agencia, String(a.total)]));
    }
    doc.moveDown(0.6);
  }

  private seccionRanking(doc: PDFKit.PDFDocument, rk: Ranking): void {
    this.titulo(doc, 'Operadores');
    if (!rk.operadores.length) {
      doc.fontSize(9).fillColor(COLOR_MUTED).text('Sin gestiones registradas en este período.');
      return;
    }
    this.tabla(doc, ['Operador', 'Casos tomados', 'Casos cerrados'],
      rk.operadores.map((o) => [o.autor, String(o.casosTomados), String(o.casosCerrados)]));
  }

  private piePagina(doc: PDFKit.PDFDocument): void {
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      const margenInferior = doc.page.margins.bottom;
      // pdfkit añade una página nueva sola si un .text() cae más abajo de
      // margins.bottom (lo trata como desborde de contenido) — el pie vive
      // ahí a propósito, así que hay que apagar ese margen mientras se
      // dibuja o el "pie" termina empujando una página en blanco detrás.
      doc.page.margins.bottom = 0;
      doc.fontSize(8).fillColor(COLOR_MUTED).text(
        `FALCON CAD · página ${i + 1} de ${paginas.count}`,
        doc.page.margins.left,
        doc.page.height - margenInferior + 14,
        { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right },
      );
      doc.page.margins.bottom = margenInferior;
    }
  }

  // --- utilidades de dibujo -------------------------------------------------

  private titulo(doc: PDFKit.PDFDocument, texto: string): void {
    this.saltoSiNecesario(doc, 60);
    // Defensivo: si la sección anterior dibujó columnas con x explícito, el
    // cursor pudo quedar corrido — todo título arranca sí o sí en el margen.
    doc.x = doc.page.margins.left;
    doc.fontSize(12).fillColor(COLOR_INK).text(texto);
    doc.moveDown(0.3);
  }

  private linea(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc.moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .strokeColor(COLOR_BORDE).lineWidth(1).stroke();
  }

  /** Tabla simple de ancho fijo: encabezado en negrilla, filas con línea divisoria. */
  private tabla(doc: PDFKit.PDFDocument, encabezados: string[], filas: string[][]): void {
    const anchoTotal = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const anchoCol = anchoTotal / encabezados.length;
    const alturaFila = 18;

    // Cada .text(str, x, y) dentro de las columnas deja el cursor (doc.x) en
    // esa columna — se devuelve al margen izquierdo después de cada fila para
    // que lo que siga (otro título, otro párrafo) no herede el corrimiento.
    const dibujarEncabezado = (): void => {
      const y = doc.y;
      doc.fontSize(8).fillColor(COLOR_MUTED);
      encabezados.forEach((h, i) => doc.text(h.toUpperCase(), doc.page.margins.left + i * anchoCol, y, { width: anchoCol - 6 }));
      doc.x = doc.page.margins.left;
      doc.y = y + 14;
      this.linea(doc);
      doc.moveDown(0.2);
    };

    dibujarEncabezado();
    for (const fila of filas) {
      this.saltoSiNecesario(doc, alturaFila, dibujarEncabezado);
      const y = doc.y;
      doc.fontSize(9).fillColor(COLOR_INK);
      fila.forEach((valor, i) => doc.text(valor, doc.page.margins.left + i * anchoCol, y, { width: anchoCol - 6 }));
      doc.x = doc.page.margins.left;
      doc.y = y + alturaFila;
    }
  }

  /** Nueva página si lo que sigue no cabe en lo que queda — evita cortar una fila o un título a la mitad. */
  private saltoSiNecesario(doc: PDFKit.PDFDocument, alturaNecesaria: number, alRepintar?: () => void): void {
    const limite = doc.page.height - doc.page.margins.bottom;
    if (doc.y + alturaNecesaria > limite) {
      doc.addPage();
      alRepintar?.();
    }
  }

  private duracion(min: number | null): string {
    if (min === null) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${Math.round(min % 60)} min`;
  }
}
