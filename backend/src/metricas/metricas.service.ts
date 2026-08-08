import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { CANALES, ESTADOS } from '../casos/caso.model';

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

/** Métricas de gestión, siempre acotadas por tenant (GROUP BY en PostgreSQL). */
@Injectable()
export class MetricasService {
  constructor(
    @InjectRepository(CasoEntity)
    private readonly repo: Repository<CasoEntity>,
  ) {}

  async resumen(tenant: string): Promise<Resumen> {
    const [total, porEstado, porCanal, porAgencia, tiempos] = await Promise.all([
      this.repo.count({ where: { tenant } }),
      this.agrupar(tenant, 'estado'),
      this.agrupar(tenant, 'canal'),
      this.agrupar(tenant, 'agencia'),
      this.tiempos(tenant),
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
  }

  /**
   * Tiempos de respuesta de los últimos 30 días, desde la bitácora: cuánto
   * tarda un caso en ser tomado (primer paso a 'en_gestion'), en recibir su
   * primer recurso (primer evento de despacho) y en cerrarse. Es la medida
   * real de un 123 — los conteos dicen cuánto entró; esto dice qué tan
   * rápido se atendió.
   */
  private async tiempos(tenant: string): Promise<Resumen['tiempos']> {
    const filas = await this.repo.query(
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
    const [g] = await this.repo.query(
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

  private async agrupar(tenant: string, campo: 'estado' | 'canal' | 'agencia'): Promise<Record<string, number>> {
    const filas = await this.repo
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
}
