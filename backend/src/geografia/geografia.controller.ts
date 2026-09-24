import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeografiaService } from './geografia.service';
import { DireccionesService } from './direcciones.service';

/**
 * Catálogo de Colombia (departamentos/municipios): lectura abierta a
 * cualquier usuario autenticado (staff de cualquier tenant, o el
 * superadmin) — es información pública, la misma para todos, sin nada que
 * acotar por tenant.
 */
@Controller('geografia')
export class GeografiaController {
  constructor(
    private readonly geografia: GeografiaService,
    private readonly direcciones: DireccionesService,
    private readonly config: ConfigService,
  ) {}

  @Get('departamentos')
  departamentos() {
    return this.geografia.listarDepartamentos();
  }

  /**
   * GET /api/geografia/mapas-config — la clave de navegador de Google Maps,
   * para que Recepción cargue el buscador de direcciones (Places + Geocoding)
   * sin tenerla escrita en el bundle del frontend. `null` si no está
   * configurada: el formulario cae a dirección manual, sin romperse.
   *
   * No es un secreto de servidor (viaja al navegador de todas formas), así
   * que basta la sesión normal para protegerla — pero DEBE estar restringida
   * por referente HTTP y por API en Google Cloud Console (ver .env.example).
   */
  @Get('mapas-config')
  mapasConfig() {
    return { googleMapsApiKey: this.config.get<string>('GOOGLE_MAPS_API_KEY') || null };
  }

  @Get('municipios')
  municipios(@Query('departamento') departamento: string) {
    if (!departamento?.trim()) throw new BadRequestException('Indique el código del departamento.');
    return this.geografia.municipiosDe(departamento.trim());
  }

  /**
   * Centroide del municipio, para centrar el mapa de Recepción. `null` si no
   * se pudo geocodificar (municipio inexistente, o Nominatim sin respuesta) —
   * el frontend cae al centro por defecto en ese caso, no es un error.
   */
  @Get('municipios/:codigoDane/centroide')
  centroide(@Param('codigoDane') codigoDane: string) {
    return this.geografia.centroideDe(codigoDane);
  }

  /**
   * GET /api/geografia/geocodificar — dirección colombiana a coordenadas.
   *
   * Se resuelve por la ESQUINA de las dos vías y se avanzan los metros de la
   * placa, que es lo que la nomenclatura colombiana significa de verdad.
   * Preguntarle el texto completo a Nominatim, como se hacía antes, devolvía
   * un punto cualquiera de la vía —medido en Bogotá, 4,75 km de error—.
   * `codigoDane` acota la búsqueda al municipio; sin él se busca en el país.
   */
  @Get('geocodificar')
  async geocodificar(
    @Query('direccion') direccion: string,
    @Query('codigoDane') codigoDane?: string,
    @Query('municipio') municipio?: string,
  ) {
    if (!direccion?.trim()) throw new BadRequestException('Escriba la dirección a buscar.');
    // El código DANE es lo preferible (trae el punto ya cacheado en el
    // catálogo), pero ese catálogo llega por migración y puede no estar
    // sembrado. El nombre del municipio sirve de respaldo: sin ninguno de los
    // dos, la búsqueda se iría a una vía homónima de otra ciudad.
    const lugar =
      (codigoDane?.trim() ? await this.geografia.municipioConPunto(codigoDane.trim()) : null)
      ?? (municipio?.trim() ? await this.direcciones.municipioPorNombre(municipio.trim()) : null);
    return this.direcciones.geocodificar(direccion.trim(), lugar);
  }

  /**
   * GET /api/geografia/direccion — coordenadas a dirección con numeración.
   * Devuelve «Calle 53 # 52-35» y no solo «Calle 53»: la unidad que va en
   * camino necesita la cuadra y el costado, no el nombre de la vía.
   */
  @Get('direccion')
  direccion(@Query('lat') lat: string, @Query('lng') lng: string) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      throw new BadRequestException('Coordenadas inválidas.');
    }
    return this.direcciones.direccionDe(la, ln);
  }
}
