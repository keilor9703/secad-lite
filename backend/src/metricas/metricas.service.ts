import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { CANALES, ESTADOS } from '../casos/caso.model';

export interface Resumen {
  total: number;
  porEstado: Record<string, number>;
  porCanal: Record<string, number>;
  porAgencia: Array<{ agencia: string; total: number }>;
}

/** Métricas de gestión, siempre acotadas por tenant (GROUP BY en PostgreSQL). */
@Injectable()
export class MetricasService {
  constructor(
    @InjectRepository(CasoEntity)
    private readonly repo: Repository<CasoEntity>,
  ) {}

  async resumen(tenant: string): Promise<Resumen> {
    const [total, porEstado, porCanal, porAgencia] = await Promise.all([
      this.repo.count({ where: { tenant } }),
      this.agrupar(tenant, 'estado'),
      this.agrupar(tenant, 'canal'),
      this.agrupar(tenant, 'agencia'),
    ]);

    return {
      total,
      porEstado: this.completar(porEstado, ESTADOS),
      porCanal: this.completar(porCanal, CANALES),
      porAgencia: Object.entries(porAgencia)
        .map(([agencia, t]) => ({ agencia, total: t }))
        .sort((a, b) => b.total - a.total),
    };
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
