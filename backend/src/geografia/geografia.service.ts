import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartamentoEntity } from './departamento.entity';
import { MunicipioEntity } from './municipio.entity';

export interface DepartamentoDto {
  codigoDane: string;
  nombre: string;
}

export interface MunicipioDto {
  codigoDane: string;
  departamentoCodigo: string;
  nombre: string;
  subregion?: string | null;
}

/**
 * Catálogo de referencia de Colombia (departamentos y municipios DIVIPOLA/
 * DANE). Compartido por toda la plataforma — no es tenant-scoped, se siembra
 * una sola vez por migración (ver `SembrarDivipola`).
 */
@Injectable()
export class GeografiaService {
  private readonly logger = new Logger(GeografiaService.name);

  constructor(
    @InjectRepository(DepartamentoEntity) private readonly departamentos: Repository<DepartamentoEntity>,
    @InjectRepository(MunicipioEntity) private readonly municipios: Repository<MunicipioEntity>,
  ) {}

  listarDepartamentos(): Promise<DepartamentoDto[]> {
    return this.departamentos.find({ order: { nombre: 'ASC' } });
  }

  municipiosDe(departamentoCodigo: string): Promise<MunicipioDto[]> {
    return this.municipios.find({ where: { departamentoCodigo }, order: { nombre: 'ASC' } });
  }

  municipioPorCodigo(codigoDane: string): Promise<MunicipioEntity | null> {
    if (!codigoDane) return Promise.resolve(null);
    return this.municipios.findOne({ where: { codigoDane } });
  }

  departamentoPorCodigo(codigoDane: string): Promise<DepartamentoEntity | null> {
    if (!codigoDane) return Promise.resolve(null);
    return this.departamentos.findOne({ where: { codigoDane } });
  }

  /**
   * Centroide del municipio, para centrar el mapa de Recepción. Se
   * geocodifica UNA sola vez (Nominatim) y queda cacheado en el catálogo
   * compartido — cualquier tenant de ese municipio reaprovecha el resultado,
   * no se repite la consulta externa.
   */
  async centroideDe(codigoDane: string): Promise<{ lat: number; lng: number } | null> {
    const municipio = await this.municipioPorCodigo(codigoDane);
    if (!municipio) return null;
    if (municipio.lat != null && municipio.lng != null) return { lat: municipio.lat, lng: municipio.lng };

    const departamento = await this.departamentos.findOne({ where: { codigoDane: municipio.departamentoCodigo } });
    const q = encodeURIComponent(`${municipio.nombre}, ${departamento?.nombre ?? ''}, Colombia`);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'es', 'User-Agent': 'FalconCAD/1.0' },
      });
      const datos = (await r.json()) as Array<{ lat: string; lon: string }>;
      const primero = datos?.[0];
      if (!primero) return null;
      const lat = Number(primero.lat);
      const lng = Number(primero.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      municipio.lat = lat;
      municipio.lng = lng;
      await this.municipios.save(municipio);
      return { lat, lng };
    } catch (e) {
      this.logger.warn(`No fue posible geocodificar "${municipio.nombre}": ${(e as Error).message}`);
      return null;
    }
  }

  /** El municipio con su punto ya resuelto, para acotar una búsqueda de dirección. */
  async municipioConPunto(codigoDane: string): Promise<{ nombre: string; lat: number; lng: number } | null> {
    const m = await this.municipioPorCodigo(codigoDane);
    if (!m) return null;
    const centro = await this.centroideDe(codigoDane);
    if (!centro) return null;
    return { nombre: m.nombre, lat: centro.lat, lng: centro.lng };
  }
}
