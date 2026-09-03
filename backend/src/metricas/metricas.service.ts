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

export interface Resumen {
  total: number;
  porEstado: Record<string, number>;
  porCanal: Record<string, number>;
  porAgencia: Array<{ agencia: string; total: number }>;
  /** Un centro de despacho se mide en tiempos, no en conteos. */
  tiempos: { porPrioridad: TiemposPrioridad[]; global: TiemposPrioridad | null };
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

  async resumen(tenant: string): Promise<Resumen> {
    return this.rls.conTenant(tenant, async (manager) => {
      const [total, porEstado, porCanal, porAgencia, tiempos] = await Promise.all([
        manager.getRepository(CasoEntity).count({ where: { tenant } }),
        this.agrupar(manager, tenant, 'estado'),
        this.agrupar(manager, tenant, 'canal'),
        this.agrupar(manager, tenant, 'agencia'),
        this.tiempos(manager, tenant),
      ]);

      return {
        total,
        porEstado: this.completar(porEstado, ESTADOS),
        porCanal: this.completar(porCanal, CANALES),
        porAgencia: Object.entries(porAgencia)
          .map(([agencia, t]) => ({ agencia, total: t }))
          .sort((a, b) => b.total - a.total),
        tiempos,
      };
    });
  }

  /**
   * Reporte de la planta telefónica: cuántas llamadas entraron en cada
   * estado y cuánto se demora en promedio contestar una — últimos 30 días,
   * el mismo período que usan los tiempos de respuesta de casos.
   */
  async llamadas(tenant: string): Promise<ResumenLlamadas> {
    return this.rls.conTenant(tenant, async (manager) => {
      const [porEstado, prom] = await Promise.all([
        manager
          .getRepository(LlamadaEntity)
          .createQueryBuilder('l')
          .select('l.estado', 'clave')
          .addSelect('COUNT(*)', 'total')
          .where('l.tenant = :tenant', { tenant })
          .andWhere('l."creadoEn" >= NOW() - INTERVAL \'30 days\'')
          .groupBy('l.estado')
          .getRawMany<{ clave: string; total: string }>(),
        manager.query(
          `SELECT AVG(EXTRACT(EPOCH FROM ("atendidaEn" - "creadoEn")) / 60) AS prom
             FROM llamadas
            WHERE tenant = $1 AND "atendidaEn" IS NOT NULL AND "creadoEn" >= NOW() - INTERVAL '30 days'`,
          [tenant],
        ),
      ]);
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
   * Tiempos de respuesta de los últimos 30 días, desde la bitácora: cuánto
   * tarda un caso en ser tomado (primer paso a 'en_gestion'), en recibir su
   * primer recurso (primer evento de despacho) y en cerrarse. Es la medida
   * real de un 123 — los conteos dicen cuánto entró; esto dice qué tan
   * rápido se atendió.
   */
  private async tiempos(manager: EntityManager, tenant: string): Promise<Resumen['tiempos']> {
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
       WHERE c.tenant = $1 AND c."creadoEn" >= NOW() - INTERVAL '30 days'
       GROUP BY c.prioridad
      `,
      [tenant],
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
       WHERE c.tenant = $1 AND c."creadoEn" >= NOW() - INTERVAL '30 days'
      `,
      [tenant],
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

    const [puntos, porDia, porHora, topCodigos, sinUbicacion] = await this.rls.conTenant(tenant, (manager) => Promise.all([
      manager.query(
        `SELECT c.id, c.lat, c.lng, c."codigoCaso" AS "codigoCaso", c.prioridad, c.titulo, c."creadoEn" AS "creadoEn"
           FROM casos c WHERE ${where} AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          ORDER BY c."creadoEn" DESC LIMIT 5000`,
        params,
      ),
      // Hora local de Colombia (UTC-5, sin horario de verano): "creadoEn" se
      // guarda en UTC, así que extraer DOW/HOUR directo daría el día/hora de
      // Greenwich, no el de cuando realmente ocurrió el caso.
      manager.query(
        `SELECT EXTRACT(DOW FROM (c."creadoEn" AT TIME ZONE 'America/Bogota'))::int AS dia, COUNT(*)::int AS total
           FROM casos c WHERE ${where} GROUP BY dia`,
        params,
      ),
      manager.query(
        `SELECT EXTRACT(HOUR FROM (c."creadoEn" AT TIME ZONE 'America/Bogota'))::int AS hora, COUNT(*)::int AS total
           FROM casos c WHERE ${where} GROUP BY hora`,
        params,
      ),
      manager.query(
        `SELECT c."codigoCaso" AS codigo, k.descripcion, COUNT(*)::int AS total
           FROM casos c LEFT JOIN codigos_caso k ON k.tenant = c.tenant AND k.codigo = c."codigoCaso"
          WHERE ${where} AND c."codigoCaso" IS NOT NULL
          GROUP BY c."codigoCaso", k.descripcion
          ORDER BY total DESC LIMIT 5`,
        params,
      ),
      manager.query(
        `SELECT COUNT(*)::int AS total FROM casos c WHERE ${where} AND (c.lat IS NULL OR c.lng IS NULL)`,
        params,
      ),
    ]));

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

  private async agrupar(manager: EntityManager, tenant: string, campo: 'estado' | 'canal' | 'agencia'): Promise<Record<string, number>> {
    const filas = await manager
      .getRepository(CasoEntity)
      .createQueryBuilder('c')
      .select(`c.${campo}`, 'clave')
      .addSelect('COUNT(*)', 'total')
      .where('c.tenant = :tenant', { tenant })
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
