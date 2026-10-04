import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartamentoEntity } from './departamento.entity';
import { MunicipioEntity } from './municipio.entity';
import { Lugar } from './direcciones.service';

export interface DepartamentoDto {
  codigoDane: string;
  nombre: string;
}

/**
 * Dónde está un municipio: su punto y, cuando se conoce, su extensión real.
 *
 * El recuadro es lo que permite acotar de verdad la búsqueda de direcciones.
 * Es nulo mientras Nominatim no lo haya entregado para ese municipio; quien lo
 * use tiene que seguir funcionando sin él.
 */
export interface UbicacionMunicipio {
  lat: number;
  lng: number;
  recuadro: { sur: number; norte: number; oeste: number; este: number } | null;
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
  async centroideDe(codigoDane: string): Promise<UbicacionMunicipio | null> {
    const municipio = await this.municipioPorCodigo(codigoDane);
    if (!municipio) return null;
    // Se vuelve a consultar si falta el RECUADRO, aunque el punto ya esté
    // cacheado: los municipios que se resolvieron antes de que existiera este
    // campo tienen lat/lng y ninguna extensión, y sin esto no la tendrían
    // nunca — se quedarían para siempre en el modo degradado.
    const yaCompleto = municipio.lat != null && municipio.lng != null && municipio.latSur != null;
    if (yaCompleto) return GeografiaService.ubicacionDe(municipio);

    const departamento = await this.departamentos.findOne({ where: { codigoDane: municipio.departamentoCodigo } });
    const q = encodeURIComponent(`${municipio.nombre}, ${departamento?.nombre ?? ''}, Colombia`);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'es', 'User-Agent': 'FalconCAD/1.0' },
      });
      const datos = (await r.json()) as Array<{ lat: string; lon: string; boundingbox?: string[] }>;
      const primero = datos?.[0];
      // Sin respuesta de Nominatim, pero con el punto ya cacheado de antes: se
      // devuelve lo que hay en vez de nada. Perder el recuadro degrada la
      // búsqueda; perder el centro deja el mapa sin dónde abrirse.
      if (!primero) return GeografiaService.ubicacionDe(municipio);
      const lat = Number(primero.lat);
      const lng = Number(primero.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      municipio.lat = lat;
      municipio.lng = lng;

      // El recuadro venía en la misma respuesta y se estaba tirando. Es lo que
      // permite ACOTAR la búsqueda de direcciones al municipio en vez de
      // sesgarla con un círculo, y verificar después que el punto cayó dentro.
      const bb = primero.boundingbox?.map(Number);
      if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
        [municipio.latSur, municipio.latNorte, municipio.lngOeste, municipio.lngEste] = bb;
      }
      await this.municipios.save(municipio);
      return GeografiaService.ubicacionDe(municipio);
    } catch (e) {
      this.logger.warn(`No fue posible geocodificar "${municipio.nombre}": ${(e as Error).message}`);
      return null;
    }
  }

  /** El punto y, si se conoce, el recuadro — en la forma que espera el frontend. */
  private static ubicacionDe(m: MunicipioEntity): UbicacionMunicipio | null {
    if (m.lat == null || m.lng == null) return null;
    const tieneCaja = m.latSur != null && m.latNorte != null && m.lngOeste != null && m.lngEste != null;
    return {
      lat: m.lat,
      lng: m.lng,
      recuadro: tieneCaja
        ? { sur: m.latSur!, norte: m.latNorte!, oeste: m.lngOeste!, este: m.lngEste! }
        : null,
    };
  }

  /** El municipio con su punto ya resuelto, para acotar una búsqueda de dirección. */
  async municipioConPunto(codigoDane: string): Promise<Lugar | null> {
    const m = await this.municipioPorCodigo(codigoDane);
    if (!m) return null;
    const centro = await this.centroideDe(codigoDane);
    if (!centro) return null;
    const r = centro.recuadro;
    return {
      nombre: m.nombre,
      lat: centro.lat,
      lng: centro.lng,
      // El motor de direcciones acota con el recuadro real cuando lo hay, en
      // vez de con ±0,3° fijos alrededor del centro (unos 33 km en cada eje).
      bbox: r ? [r.sur, r.norte, r.oeste, r.este] : undefined,
    };
  }
}
