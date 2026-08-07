import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Dónde quedó referenciado un registro del catálogo, y cuántas veces. */
export interface Referencia {
  /** Texto para el operador: «3 casos», «2 funcionarios»… */
  descripcion: string;
  cantidad: number;
}

/**
 * Averigua si un registro del catálogo está en uso antes de borrarlo.
 *
 * Se consulta por SQL y no por los repositorios de cada módulo a propósito:
 * `CasosModule` ya importa `CatalogosModule`, así que inyectar aquí el servicio
 * de casos crearía una dependencia circular. Además, dos de las referencias
 * (los canales de un caso y los de un funcionario) viven en columnas
 * `simple-array` —texto separado por comas—, que no se pueden consultar con el
 * buscador de entidades.
 */
@Injectable()
export class ReferenciasService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Conteo de una consulta que devuelve una sola columna `n`. */
  private async contar(sql: string, params: unknown[]): Promise<number> {
    const filas = await this.ds.query(sql, params);
    return Number(filas?.[0]?.n ?? 0);
  }

  /**
   * Une los conteos con etiqueta, descartando los que están en cero. Un arreglo
   * vacío significa que el registro se puede borrar sin dejar huérfanos.
   */
  private async reunir(pares: Array<[string, Promise<number>]>): Promise<Referencia[]> {
    const salida: Referencia[] = [];
    for (const [etiqueta, promesa] of pares) {
      const cantidad = await promesa;
      if (cantidad > 0) salida.push({ descripcion: `${cantidad} ${etiqueta}`, cantidad });
    }
    return salida;
  }

  /** Casos, canales, códigos, funcionarios y recursos que apuntan a la agencia. */
  async deAgencia(tenant: string, id: string): Promise<Referencia[]> {
    return this.reunir([
      ['casos', this.contar(
        `SELECT COUNT(*)::int AS n FROM casos
          WHERE tenant = $1 AND ($2 IN ("agenciaResponsableId"::text, "agenciaOrigenId"::text))`,
        [tenant, id],
      )],
      ['canales de atención', this.contar(
        `SELECT COUNT(*)::int AS n FROM canales WHERE tenant = $1 AND "agenciaId" = $2`, [tenant, id],
      )],
      ['códigos de caso', this.contar(
        `SELECT COUNT(*)::int AS n FROM codigos_caso WHERE tenant = $1 AND "agenciaSugeridaId" = $2`, [tenant, id],
      )],
      ['funcionarios', this.contar(
        `SELECT COUNT(*)::int AS n FROM usuarios WHERE tenant = $1 AND "agenciaId" = $2`, [tenant, id],
      )],
      ['recursos', this.contar(
        `SELECT COUNT(*)::int AS n FROM recursos WHERE tenant = $1 AND "agenciaId" = $2`, [tenant, id],
      )],
    ]);
  }

  /**
   * Casos y funcionarios adscritos al canal. Ambas columnas son `simple-array`,
   * así que se comparan contra la lista partida por comas.
   */
  async deCanal(tenant: string, id: string): Promise<Referencia[]> {
    return this.reunir([
      ['casos', this.contar(
        `SELECT COUNT(*)::int AS n FROM casos
          WHERE tenant = $1 AND canales IS NOT NULL AND $2 = ANY(string_to_array(canales, ','))`,
        [tenant, id],
      )],
      ['funcionarios adscritos', this.contar(
        `SELECT COUNT(*)::int AS n FROM usuarios
          WHERE tenant = $1 AND canales IS NOT NULL AND $2 = ANY(string_to_array(canales, ','))`,
        [tenant, id],
      )],
    ]);
  }

  /** Casos tipificados con ese código (se guarda el texto del código, no el id). */
  async deCodigoCaso(tenant: string, codigo: string): Promise<Referencia[]> {
    return this.reunir([
      ['casos tipificados', this.contar(
        `SELECT COUNT(*)::int AS n FROM casos WHERE tenant = $1 AND "codigoCaso" = $2`, [tenant, codigo],
      )],
    ]);
  }

  /** Casos cerrados con ese desenlace. */
  async deCodigoCierre(tenant: string, codigo: string): Promise<Referencia[]> {
    return this.reunir([
      ['casos cerrados', this.contar(
        `SELECT COUNT(*)::int AS n FROM casos WHERE tenant = $1 AND "codigoCierre" = $2`, [tenant, codigo],
      )],
    ]);
  }

  /** Despachos en los que participó el recurso. */
  async deRecurso(tenant: string, id: string): Promise<Referencia[]> {
    return this.reunir([
      ['despachos registrados', this.contar(
        `SELECT COUNT(*)::int AS n FROM asignaciones WHERE tenant = $1 AND "recursoId" = $2`, [tenant, id],
      )],
    ]);
  }

  /** Frase para el mensaje de error: «3 casos y 2 funcionarios adscritos». */
  static resumir(refs: Referencia[]): string {
    const partes = refs.map((r) => r.descripcion);
    if (partes.length <= 1) return partes[0] ?? '';
    return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  }
}
