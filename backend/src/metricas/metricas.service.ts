import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { CANALES, ESTADOS } from '../casos/caso.model';
import { ESTADOS_LLAMADA, LlamadaEntity } from '../pbx/llamada.entity';
import { TenantRlsService } from '../common/tenant-rls.service';

/** Tiempos promedio (minutos) desde la recepción, últimos 30 días. */
export interface TiemposPrioridad {
  prioridad: string;
  total: number;
  /** Recepción → alguien lo toma (en gestión). */
  tomaMin: number | null;
  /** Recepción → primer recurso despachado. */
  despachoMin: number | null;
  /** Recepción → cierre. */
  cierreMin: number | null;
}

/** Mismos totales del período inmediatamente anterior (misma duración, sin solaparse) — la base para medir variación. */
export interface ResumenPeriodoAnterior {
  total: number;
  tiempoTomaProm: number | null;
}

export interface Resumen {
  /** Rango efectivamente usado (aaaa-mm-dd, ambos inclusive) — últimos 30 días si no se pide otro. */
  periodo: { desde: string; hasta: string };
  total: number;
  porEstado: Record<string, number>;
  porCanal: Record<string, number>;
  porAgencia: Array<{ agencia: string; total: number }>;
  /** Un centro de despacho se mide en tiempos, no en conteos. */
  tiempos: { porPrioridad: TiemposPrioridad[]; global: TiemposPrioridad | null };
  periodoAnterior: ResumenPeriodoAnterior;
}

export interface PuntoTendencia {
  fecha: string;
  total: number;
}

/** Serie diaria de casos del período, junto con la misma serie del período anterior para superponer en un gráfico. */
export interface Tendencia {
  periodo: { desde: string; hasta: string };
  actual: PuntoTendencia[];
  anterior: PuntoTendencia[];
}

/**
 * Meta de despacho por prioridad, en minutos desde la recepción hasta que
 * sale el primer recurso — el estándar operativo de un 123. No es
 * configurable por tenant todavía; son los valores de referencia usuales
 * para líneas de emergencia.
 */
const META_DESPACHO_MIN: Readonly<Record<string, number>> = { alta: 5, media: 15, baja: 30 };

export interface CumplimientoPrioridad {
  prioridad: string;
  metaMin: number;
  /** Casos de esa prioridad que llegaron a tener un recurso despachado en el período. */
  totalDespachados: number;
  dentroDeMeta: number;
  /** Porcentaje 0-100, null si no hubo despachos de esa prioridad en el período. */
  porcentaje: number | null;
}

/** Cumplimiento de la meta de despacho por prioridad, para el período. */
export interface Cumplimiento {
  periodo: { desde: string; hasta: string };
  porPrioridad: CumplimientoPrioridad[];
}

export interface Hallazgo {
  severidad: 'info' | 'atencion' | 'critico';
  titulo: string;
  detalle: string;
}

/** Lectura automática de resumen/cumplimiento/tendencia del período — reglas simples, no aprendizaje automático. */
export interface Hallazgos {
  periodo: { desde: string; hasta: string };
  items: Hallazgo[];
}

export interface RankingOperador {
  /** El "autor" de la bitácora — quien quedó autenticado al tomar/cerrar el caso. */
  autor: string;
  casosTomados: number;
  casosCerrados: number;
}

/** Quién gestionó qué, según la bitácora de casos_eventos del período. Ordenado por casos tomados. */
export interface Ranking {
  periodo: { desde: string; hasta: string };
  operadores: RankingOperador[];
}

/** Reporte de la planta telefónica (PBX), últimos 30 días. */
export interface ResumenLlamadas {
  total: number;
  porEstado: Record<string, number>;
  /** Minutos promedio entre que timbra y que se atiende; null sin llamadas atendidas en el período. */
  tiempoRespuestaProm: number | null;
}

/** Un caso histórico con ubicación, para pintar en el mapa (puntos/cluster/calor). */
export interface PuntoMapa {
  id: string;
  lat: number;
  lng: number;
  codigoCaso: string | null;
  prioridad: string;
  titulo: string;
  creadoEn: Date;
}

/** Análisis del delito y del fenómeno de convivencia y seguridad ciudadana. */
export interface AnalisisMapa {
  puntos: PuntoMapa[];
  totalConUbicacion: number;
  totalSinUbicacion: number;
  /** Día de la semana (0 = domingo … 6 = sábado, EXTRACT(DOW) de PostgreSQL). */
  porDiaSemana: Array<{ dia: number; total: number }>;
  /** Hora del día (0-23) en que se recibió el caso. */
  porHora: Array<{ hora: number; total: number }>;
  topCodigos: Array<{ codigo: string; descripcion: string | null; total: number }>;
}

/** Métricas de gestión, siempre acotadas por tenant (GROUP BY en PostgreSQL). */
@Injectable()
export class MetricasService {
  constructor(private readonly rls: TenantRlsService) {}

  /**
   * Resumen de casos del período (30 días hasta hoy si no se piden fechas),
   * con los mismos totales del período inmediatamente anterior —de igual
   * duración— para poder mostrar la variación en el Panel.
   */
  async resumen(tenant: string, opts?: { desde?: string; hasta?: string }): Promise<Resumen> {
    const { desde, finExclusivo } = this.periodo(opts);
    const duracionMs = finExclusivo.getTime() - desde.getTime();
    const desdeAnterior = new Date(desde.getTime() - duracionMs);

    return this.rls.conTenant(tenant, async (manager) => {
      // Secuencial a propósito: todas estas consultas comparten la MISMA
      // conexión/transacción (el manager de conTenant), y una sola conexión
      // de PostgreSQL no puede llevar varias sentencias en vuelo a la vez —
      // node-postgres solo lo tolera con una cola interna que ya avisa que
      // va a dejar de existir. Promise.all() aquí sería una carrera falsa.
      const total = await this.contar(manager, tenant, desde, finExclusivo);
      const porEstado = await this.agrupar(manager, tenant, 'estado', desde, finExclusivo);
      const porCanal = await this.agrupar(manager, tenant, 'canal', desde, finExclusivo);
      const porAgencia = await this.agrupar(manager, tenant, 'agencia', desde, finExclusivo);
      const tiempos = await this.tiempos(manager, tenant, desde, finExclusivo);
      const periodoAnterior = await this.periodoAnterior(manager, tenant, desdeAnterior, desde);

      return {
        periodo: { desde: this.aFechaCorta(desde), hasta: this.aFechaCorta(new Date(finExclusivo.getTime() - 864e5)) },
        total,
        porEstado: this.completar(porEstado, ESTADOS),
        porCanal: this.completar(porCanal, CANALES),
        porAgencia: Object.entries(porAgencia)
          .map(([agencia, t]) => ({ agencia, total: t }))
          .sort((a, b) => b.total - a.total),
        tiempos,
        periodoAnterior,
      };
    });
  }

  /**
   * Casos por día del período (30 días hasta hoy si no se piden fechas),
   * junto con la misma serie del período anterior — alineadas por posición
   * (día 1 con día 1, etc.), no por fecha, para poder superponerlas en un
   * mismo eje X en el gráfico de tendencia.
   */
  async tendencia(tenant: string, opts?: { desde?: string; hasta?: string }): Promise<Tendencia> {
    const { desde, finExclusivo } = this.periodo(opts);
    const duracionMs = finExclusivo.getTime() - desde.getTime();
    const desdeAnterior = new Date(desde.getTime() - duracionMs);

    return this.rls.conTenant(tenant, async (manager) => {
      // Secuencial: comparten conexión (ver el comentario igual en resumen()).
      const actual = await this.serieDiaria(manager, tenant, desde, finExclusivo);
      const anterior = await this.serieDiaria(manager, tenant, desdeAnterior, desde);
      return {
        periodo: { desde: this.aFechaCorta(desde), hasta: this.aFechaCorta(new Date(finExclusivo.getTime() - 864e5)) },
        actual,
        anterior,
      };
    });
  }

  private async serieDiaria(manager: EntityManager, tenant: string, desde: Date, finExclusivo: Date): Promise<PuntoTendencia[]> {
    const filas = await manager.query(
      `SELECT (c."creadoEn" AT TIME ZONE 'America/Bogota')::date AS dia, COUNT(*)::int AS total
         FROM casos c
        WHERE c.tenant = $1 AND c."creadoEn" >= $2 AND c."creadoEn" < $3
        GROUP BY dia`,
      [tenant, desde, finExclusivo],
    );
    const porDia = new Map<string, number>(
      filas.map((f: Record<string, unknown>) => [this.aFechaCorta(f['dia'] as Date), Number(f['total'])]),
    );
    const dias = Math.round((finExclusivo.getTime() - desde.getTime()) / 864e5);
    return Array.from({ length: dias }, (_, i) => {
      const fecha = this.aFechaCorta(new Date(desde.getTime() + i * 864e5));
      return { fecha, total: porDia.get(fecha) ?? 0 };
    });
  }

  /**
   * De los casos que llegaron a tener un recurso despachado en el período,
   * qué porcentaje lo tuvo dentro de la meta de su prioridad
   * (`META_DESPACHO_MIN`). Los casos sin despacho aún no entran en el
   * cálculo — no se puede juzgar el cumplimiento de algo que no ha pasado.
   */
  async cumplimiento(tenant: string, opts?: { desde?: string; hasta?: string }): Promise<Cumplimiento> {
    const { desde, finExclusivo } = this.periodo(opts);
    return this.rls.conTenant(tenant, async (manager) => {
      const filas = await manager.query(
        `SELECT c.prioridad,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (d.momento - c."creadoEn")) / 60 <= ${this.metaCaseSql()})::int AS dentro
           FROM casos c
           JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                  WHERE tenant = $1 AND tipo = 'despacho' GROUP BY "casoId") d ON d."casoId" = c.id
          WHERE c.tenant = $1 AND c."creadoEn" >= $2 AND c."creadoEn" < $3
          GROUP BY c.prioridad`,
        [tenant, desde, finExclusivo],
      );
      const porFila = new Map<string, Record<string, unknown>>(
        filas.map((f: Record<string, unknown>): [string, Record<string, unknown>] => [String(f['prioridad']), f]),
      );
      const orden: Record<string, number> = { alta: 0, media: 1, baja: 2 };
      const prioridades = Array.from(new Set([...Object.keys(META_DESPACHO_MIN), ...porFila.keys()]))
        .sort((a, b) => (orden[a] ?? 9) - (orden[b] ?? 9));

      const porPrioridad: CumplimientoPrioridad[] = prioridades.map((prioridad) => {
        const f = porFila.get(prioridad);
        const total = f ? Number(f['total']) : 0;
        const dentro = f ? Number(f['dentro']) : 0;
        return {
          prioridad,
          metaMin: META_DESPACHO_MIN[prioridad] ?? 30,
          totalDespachados: total,
          dentroDeMeta: dentro,
          porcentaje: total > 0 ? Math.round((dentro / total) * 1000) / 10 : null,
        };
      });

      return {
        periodo: { desde: this.aFechaCorta(desde), hasta: this.aFechaCorta(new Date(finExclusivo.getTime() - 864e5)) },
        porPrioridad,
      };
    });
  }

  /** CASE SQL que mapea prioridad → meta en minutos. Las claves salen de META_DESPACHO_MIN (constante interna, no de input del usuario). */
  private metaCaseSql(): string {
    const cuando = Object.entries(META_DESPACHO_MIN)
      .map(([prioridad, min]) => `WHEN '${prioridad}' THEN ${min}`)
      .join(' ');
    return `CASE c.prioridad ${cuando} ELSE 30 END`;
  }

  /**
   * Lectura automática, con reglas simples, sobre lo que ya calculan
   * resumen()/cumplimiento()/tendencia(): variación de volumen, prioridad
   * con peor cumplimiento, día pico y concentración en una agencia. No es
   * un motor de aprendizaje — son umbrales fijos pensados para que un
   * operador no tenga que leer todos los gráficos para notar lo importante.
   */
  async hallazgos(tenant: string, opts?: { desde?: string; hasta?: string }): Promise<Hallazgos> {
    const [resumen, cumplimiento, tendencia] = await Promise.all([
      this.resumen(tenant, opts),
      this.cumplimiento(tenant, opts),
      this.tendencia(tenant, opts),
    ]);

    const items: Hallazgo[] = [];

    const variacion =
      resumen.periodoAnterior.total > 0
        ? Math.round(((resumen.total - resumen.periodoAnterior.total) / resumen.periodoAnterior.total) * 1000) / 10
        : null;
    if (variacion !== null && Math.abs(variacion) >= 15) {
      items.push({
        severidad: variacion > 0 ? 'atencion' : 'info',
        titulo:
          variacion > 0
            ? `Los casos subieron ${variacion}% frente al período anterior`
            : `Los casos bajaron ${Math.abs(variacion)}% frente al período anterior`,
        detalle: `${resumen.total} casos en el período actual vs ${resumen.periodoAnterior.total} en el anterior.`,
      });
    }

    const peor = cumplimiento.porPrioridad
      .filter((p) => p.porcentaje !== null)
      .sort((a, b) => (a.porcentaje ?? 100) - (b.porcentaje ?? 100))[0];
    if (peor && peor.porcentaje !== null && peor.porcentaje < 80) {
      items.push({
        severidad: peor.porcentaje < 50 ? 'critico' : 'atencion',
        titulo: `Prioridad ${peor.prioridad}: solo ${peor.porcentaje}% de los despachos cumplió la meta de ${peor.metaMin} min`,
        detalle: `${peor.dentroDeMeta} de ${peor.totalDespachados} casos despachados a tiempo.`,
      });
    }

    const pico = tendencia.actual.reduce<PuntoTendencia | null>((max, p) => (p.total > (max?.total ?? -1) ? p : max), null);
    const promedioDiario = tendencia.actual.length
      ? tendencia.actual.reduce((s, p) => s + p.total, 0) / tendencia.actual.length
      : 0;
    if (pico && pico.total >= 3 && promedioDiario > 0 && pico.total >= promedioDiario * 2) {
      items.push({
        severidad: 'info',
        titulo: `${pico.fecha} fue el día con más casos del período (${pico.total})`,
        detalle: `Más del doble del promedio diario (${Math.round(promedioDiario * 10) / 10}).`,
      });
    }

    const totalAgencias = resumen.porAgencia.reduce((s, a) => s + a.total, 0);
    const top = resumen.porAgencia[0];
    if (top && totalAgencias > 0 && resumen.porAgencia.length > 1) {
      const parte = Math.round((top.total / totalAgencias) * 1000) / 10;
      if (parte >= 50) {
        items.push({
          severidad: 'info',
          titulo: `${top.agencia} concentra el ${parte}% de los casos del período`,
          detalle: `${top.total} de ${totalAgencias} casos con agencia asignada.`,
        });
      }
    }

    if (items.length === 0) {
      items.push({
        severidad: 'info',
        titulo: 'Sin hallazgos relevantes en este período',
        detalle: 'Los indicadores se mantienen dentro de rangos normales frente al período anterior.',
      });
    }

    return { periodo: resumen.periodo, items };
  }

  /**
   * Ranking de operadores por gestión en el período: cuántos casos tomó
   * (primer paso a 'en_gestion') y cuántos cerró, según quién quedó como
   * autor de cada evento de la bitácora. Top 20 por casos tomados.
   */
  async ranking(tenant: string, opts?: { desde?: string; hasta?: string }): Promise<Ranking> {
    const { desde, finExclusivo } = this.periodo(opts);
    return this.rls.conTenant(tenant, async (manager) => {
      const filas = await manager.query(
        `SELECT autor,
                COUNT(*) FILTER (WHERE "estadoNuevo" = 'en_gestion')::int AS tomados,
                COUNT(*) FILTER (WHERE "estadoNuevo" = 'cerrado')::int AS cerrados
           FROM casos_eventos
          WHERE tenant = $1 AND tipo = 'estado' AND "creadoEn" >= $2 AND "creadoEn" < $3
            AND "estadoNuevo" IN ('en_gestion', 'cerrado')
          GROUP BY autor
          ORDER BY tomados DESC, cerrados DESC
          LIMIT 20`,
        [tenant, desde, finExclusivo],
      );
      const operadores: RankingOperador[] = filas.map((f: Record<string, unknown>) => ({
        autor: String(f['autor']),
        casosTomados: Number(f['tomados']),
        casosCerrados: Number(f['cerrados']),
      }));
      return {
        periodo: { desde: this.aFechaCorta(desde), hasta: this.aFechaCorta(new Date(finExclusivo.getTime() - 864e5)) },
        operadores,
      };
    });
  }

  /** Resuelve el rango [desde, finExclusivo) a partir de aaaa-mm-dd opcionales: 30 días hasta hoy por defecto. */
  private periodo(opts?: { desde?: string; hasta?: string }): { desde: Date; finExclusivo: Date } {
    const hoy = this.fechaValida(new Date().toISOString().slice(0, 10))!;
    const hasta = this.fechaValida(opts?.hasta) ?? hoy;
    const finExclusivo = new Date(hasta.getTime() + 864e5);
    const desde = this.fechaValida(opts?.desde) ?? new Date(finExclusivo.getTime() - 30 * 864e5);
    return { desde, finExclusivo };
  }

  private aFechaCorta(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private async contar(manager: EntityManager, tenant: string, desde: Date, finExclusivo: Date): Promise<number> {
    return manager
      .getRepository(CasoEntity)
      .createQueryBuilder('c')
      .where('c.tenant = :tenant', { tenant })
      .andWhere('c."creadoEn" >= :desde AND c."creadoEn" < :hasta', { desde, hasta: finExclusivo })
      .getCount();
  }

  /** Solo el total y el tiempo de toma del período anterior — lo mínimo para una flecha de variación. */
  private async periodoAnterior(manager: EntityManager, tenant: string, desde: Date, finExclusivo: Date): Promise<ResumenPeriodoAnterior> {
    // Secuencial: comparten conexión (ver el comentario en resumen()).
    const total = await this.contar(manager, tenant, desde, finExclusivo);
    const filas = await manager.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (t.momento - c."creadoEn")) / 60) AS prom
         FROM casos c
         LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                     WHERE tenant = $1 AND "estadoNuevo" = 'en_gestion' GROUP BY "casoId") t ON t."casoId" = c.id
        WHERE c.tenant = $1 AND c."creadoEn" >= $2 AND c."creadoEn" < $3`,
      [tenant, desde, finExclusivo],
    );
    const prom = filas[0]?.['prom'];
    return {
      total,
      tiempoTomaProm: prom === null || prom === undefined ? null : Math.round(Number(prom) * 10) / 10,
    };
  }

  /**
   * Reporte de la planta telefónica: cuántas llamadas entraron en cada
   * estado y cuánto se demora en promedio contestar una — últimos 30 días,
   * el mismo período que usan los tiempos de respuesta de casos.
   */
  async llamadas(tenant: string): Promise<ResumenLlamadas> {
    return this.rls.conTenant(tenant, async (manager) => {
      // Secuencial: comparten conexión (ver el comentario en resumen()).
      const porEstado = await manager
        .getRepository(LlamadaEntity)
        .createQueryBuilder('l')
        .select('l.estado', 'clave')
        .addSelect('COUNT(*)', 'total')
        .where('l.tenant = :tenant', { tenant })
        .andWhere('l."creadoEn" >= NOW() - INTERVAL \'30 days\'')
        .groupBy('l.estado')
        .getRawMany<{ clave: string; total: string }>();
      const prom = await manager.query(
        `SELECT AVG(EXTRACT(EPOCH FROM ("atendidaEn" - "creadoEn")) / 60) AS prom
           FROM llamadas
          WHERE tenant = $1 AND "atendidaEn" IS NOT NULL AND "creadoEn" >= NOW() - INTERVAL '30 days'`,
        [tenant],
      );
      const porEstadoMap = Object.fromEntries(porEstado.map((f) => [f.clave, Number(f.total)]));
      const total = Object.values(porEstadoMap).reduce((a, b) => a + b, 0);
      const promedio = prom[0]?.['prom'];
      return {
        total,
        porEstado: this.completar(porEstadoMap, ESTADOS_LLAMADA),
        tiempoRespuestaProm: promedio === null || promedio === undefined ? null : Math.round(Number(promedio) * 10) / 10,
      };
    });
  }

  /**
   * Tiempos de respuesta del período, desde la bitácora: cuánto tarda un
   * caso en ser tomado (primer paso a 'en_gestion'), en recibir su primer
   * recurso (primer evento de despacho) y en cerrarse. Es la medida real de
   * un 123 — los conteos dicen cuánto entró; esto dice qué tan rápido se
   * atendió.
   */
  private async tiempos(manager: EntityManager, tenant: string, desde: Date, finExclusivo: Date): Promise<Resumen['tiempos']> {
    const filas = await manager.query(
      `
      SELECT c.prioridad,
             COUNT(*)::int AS total,
             AVG(EXTRACT(EPOCH FROM (t.momento  - c."creadoEn")) / 60) AS toma_min,
             AVG(EXTRACT(EPOCH FROM (d.momento  - c."creadoEn")) / 60) AS despacho_min,
             AVG(EXTRACT(EPOCH FROM (x.momento  - c."creadoEn")) / 60) AS cierre_min
        FROM casos c
        LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                    WHERE tenant = $1 AND "estadoNuevo" = 'en_gestion' GROUP BY "casoId") t ON t."casoId" = c.id
        LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                    WHERE tenant = $1 AND tipo = 'despacho' GROUP BY "casoId") d ON d."casoId" = c.id
        LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                    WHERE tenant = $1 AND "estadoNuevo" = 'cerrado' GROUP BY "casoId") x ON x."casoId" = c.id
       WHERE c.tenant = $1 AND c."creadoEn" >= $2 AND c."creadoEn" < $3
       GROUP BY c.prioridad
      `,
      [tenant, desde, finExclusivo],
    );
    const aFila = (f: Record<string, unknown>, prioridad: string): TiemposPrioridad => ({
      prioridad,
      total: Number(f['total'] ?? 0),
      tomaMin: f['toma_min'] === null ? null : Math.round(Number(f['toma_min']) * 10) / 10,
      despachoMin: f['despacho_min'] === null ? null : Math.round(Number(f['despacho_min']) * 10) / 10,
      cierreMin: f['cierre_min'] === null ? null : Math.round(Number(f['cierre_min']) * 10) / 10,
    });
    const orden: Record<string, number> = { alta: 0, media: 1, baja: 2 };
    const porPrioridad = filas
      .map((f: Record<string, unknown>) => aFila(f, String(f['prioridad'])))
      .sort((a: TiemposPrioridad, b: TiemposPrioridad) => (orden[a.prioridad] ?? 9) - (orden[b.prioridad] ?? 9));

    // El global sale de la MISMA consulta sin agrupar: los promedios ignoran
    // los casos sin ese hito (AVG omite nulos), que es lo correcto.
    const [g] = await manager.query(
      `
      SELECT COUNT(*)::int AS total,
             AVG(EXTRACT(EPOCH FROM (t.momento - c."creadoEn")) / 60) AS toma_min,
             AVG(EXTRACT(EPOCH FROM (d.momento - c."creadoEn")) / 60) AS despacho_min,
             AVG(EXTRACT(EPOCH FROM (x.momento - c."creadoEn")) / 60) AS cierre_min
        FROM casos c
        LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                    WHERE tenant = $1 AND "estadoNuevo" = 'en_gestion' GROUP BY "casoId") t ON t."casoId" = c.id
        LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                    WHERE tenant = $1 AND tipo = 'despacho' GROUP BY "casoId") d ON d."casoId" = c.id
        LEFT JOIN (SELECT "casoId", MIN("creadoEn") AS momento FROM casos_eventos
                    WHERE tenant = $1 AND "estadoNuevo" = 'cerrado' GROUP BY "casoId") x ON x."casoId" = c.id
       WHERE c.tenant = $1 AND c."creadoEn" >= $2 AND c."creadoEn" < $3
      `,
      [tenant, desde, finExclusivo],
    );
    const global = g && Number(g['total']) > 0 ? aFila(g, 'global') : null;
    return { porPrioridad, global };
  }

  /**
   * Mapa estadístico y de calor: ubicación de los casos históricos (para
   * puntos/cluster/calor) más el análisis del fenómeno — días y horas de
   * mayor afectación y el top 5 de códigos de caso — filtrable por rango de
   * fechas y por código. Siempre acotado al tenant del usuario logueado.
   */
  async mapa(tenant: string, opts?: { desde?: string; hasta?: string; codigo?: string }): Promise<AnalisisMapa> {
    const desde = this.fechaValida(opts?.desde);
    const hasta = this.fechaValida(opts?.hasta);
    const finExclusivo = hasta ? new Date(hasta.getTime() + 864e5) : null;
    const codigo = opts?.codigo?.trim().toUpperCase() || null;

    const params: unknown[] = [tenant];
    const cond: string[] = ['c.tenant = $1'];
    if (desde) { params.push(desde); cond.push(`c."creadoEn" >= $${params.length}`); }
    if (finExclusivo) { params.push(finExclusivo); cond.push(`c."creadoEn" < $${params.length}`); }
    if (codigo) { params.push(codigo); cond.push(`c."codigoCaso" = $${params.length}`); }
    const where = cond.join(' AND ');

    // Secuencial a propósito: las cinco comparten la MISMA conexión/transacción
    // (el manager de conTenant) — Promise.all() lanzaría varias sentencias a
    // la vez sobre un solo cliente de PostgreSQL (ver el comentario igual en
    // resumen()).
    const [puntos, porDia, porHora, topCodigos, sinUbicacion] = await this.rls.conTenant(tenant, async (manager) => {
      const puntos = await manager.query(
        `SELECT c.id, c.lat, c.lng, c."codigoCaso" AS "codigoCaso", c.prioridad, c.titulo, c."creadoEn" AS "creadoEn"
           FROM casos c WHERE ${where} AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          ORDER BY c."creadoEn" DESC LIMIT 5000`,
        params,
      );
      // Hora local de Colombia (UTC-5, sin horario de verano): "creadoEn" se
      // guarda en UTC, así que extraer DOW/HOUR directo daría el día/hora de
      // Greenwich, no el de cuando realmente ocurrió el caso.
      const porDia = await manager.query(
        `SELECT EXTRACT(DOW FROM (c."creadoEn" AT TIME ZONE 'America/Bogota'))::int AS dia, COUNT(*)::int AS total
           FROM casos c WHERE ${where} GROUP BY dia`,
        params,
      );
      const porHora = await manager.query(
        `SELECT EXTRACT(HOUR FROM (c."creadoEn" AT TIME ZONE 'America/Bogota'))::int AS hora, COUNT(*)::int AS total
           FROM casos c WHERE ${where} GROUP BY hora`,
        params,
      );
      const topCodigos = await manager.query(
        `SELECT c."codigoCaso" AS codigo, k.descripcion, COUNT(*)::int AS total
           FROM casos c LEFT JOIN codigos_caso k ON k.tenant = c.tenant AND k.codigo = c."codigoCaso"
          WHERE ${where} AND c."codigoCaso" IS NOT NULL
          GROUP BY c."codigoCaso", k.descripcion
          ORDER BY total DESC LIMIT 5`,
        params,
      );
      const sinUbicacion = await manager.query(
        `SELECT COUNT(*)::int AS total FROM casos c WHERE ${where} AND (c.lat IS NULL OR c.lng IS NULL)`,
        params,
      );
      return [puntos, porDia, porHora, topCodigos, sinUbicacion];
    });

    const diasPorNumero = new Map<number, number>(porDia.map((f: Record<string, unknown>) => [Number(f['dia']), Number(f['total'])]));
    const horasPorNumero = new Map<number, number>(porHora.map((f: Record<string, unknown>) => [Number(f['hora']), Number(f['total'])]));

    return {
      puntos: puntos.map((f: Record<string, unknown>) => ({
        id: String(f['id']),
        lat: Number(f['lat']),
        lng: Number(f['lng']),
        codigoCaso: (f['codigoCaso'] as string | null) ?? null,
        prioridad: String(f['prioridad']),
        titulo: String(f['titulo']),
        creadoEn: f['creadoEn'] as Date,
      })),
      totalConUbicacion: puntos.length,
      totalSinUbicacion: Number(sinUbicacion[0]?.['total'] ?? 0),
      porDiaSemana: Array.from({ length: 7 }, (_, dia) => ({ dia, total: diasPorNumero.get(dia) ?? 0 })),
      porHora: Array.from({ length: 24 }, (_, hora) => ({ hora, total: horasPorNumero.get(hora) ?? 0 })),
      topCodigos: topCodigos.map((f: Record<string, unknown>) => ({
        codigo: String(f['codigo']),
        descripcion: (f['descripcion'] as string | null) ?? null,
        total: Number(f['total']),
      })),
    };
  }

  /** aaaa-mm-dd → Date, o null si viene vacío o malformado. */
  private fechaValida(v?: string): Date | null {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  private async agrupar(
    manager: EntityManager,
    tenant: string,
    campo: 'estado' | 'canal' | 'agencia',
    desde: Date,
    finExclusivo: Date,
  ): Promise<Record<string, number>> {
    const filas = await manager
      .getRepository(CasoEntity)
      .createQueryBuilder('c')
      .select(`c.${campo}`, 'clave')
      .addSelect('COUNT(*)', 'total')
      .where('c.tenant = :tenant', { tenant })
      .andWhere('c."creadoEn" >= :desde AND c."creadoEn" < :hasta', { desde, hasta: finExclusivo })
      .groupBy(`c.${campo}`)
      .getRawMany<{ clave: string; total: string }>();
    return Object.fromEntries(filas.map((f) => [f.clave, Number(f.total)]));
  }

  /** Garantiza que todas las claves esperadas estén presentes (con 0 si faltan). */
  private completar(datos: Record<string, number>, claves: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of claves) out[k] = datos[k] ?? 0;
    return out;
  }

  async exportarCsv(
    tenant: string,
    opts?: { desde?: string; hasta?: string; estado?: string }
  ): Promise<string> {
    const desde = this.fechaValida(opts?.desde);
    const hasta = this.fechaValida(opts?.hasta);
    const finExclusivo = hasta ? new Date(hasta.getTime() + 864e5) : null;

    const casos = await this.rls.conTenant(tenant, (manager) => {
      const qb = manager.getRepository(CasoEntity).createQueryBuilder('caso')
        .where('caso.tenant = :tenant', { tenant });

      if (opts?.estado) {
        qb.andWhere('caso.estado = :estado', { estado: opts.estado });
      }
      if (desde && finExclusivo) {
        qb.andWhere('caso.creadoEn >= :desde AND caso.creadoEn < :hasta', { desde, hasta: finExclusivo });
      } else if (desde) {
        qb.andWhere('caso.creadoEn >= :desde', { desde });
      } else if (finExclusivo) {
        qb.andWhere('caso.creadoEn < :hasta', { hasta: finExclusivo });
      }
      return qb.orderBy('caso.creadoEn', 'DESC').getMany();
    });

    const cols = ['id', 'creadoEn', 'canal', 'titulo', 'ciudadano', 'telefono', 'agencia', 'estado', 'prioridad', 'codigoCaso', 'direccion', 'creadoPor'];
    let csv = cols.join(',') + '\n';

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    for (const c of casos) {
      csv += cols.map((col) => {
        if (col === 'creadoEn') return escapeCsv((c as any)[col]?.toISOString());
        return escapeCsv((c as any)[col]);
      }).join(',') + '\n';
    }

    return csv;
  }
}
