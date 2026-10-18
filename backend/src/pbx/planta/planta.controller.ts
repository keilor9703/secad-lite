import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../auth/roles.decorator';
import { Usuario } from '../../common/usuario.decorator';
import { JwtPayload } from '../../auth/auth.service';
import { AuditoriaAdminService } from '../../auditoria/auditoria-admin.service';
import {
  ActualizarPlantaDto,
  ConfiguracionPlanta,
  CrearPlantaDto,
  GuardarNumeroDto,
  GuardarTroncalDto,
  PlantaService,
  VistaNumero,
  VistaPlanta,
  VistaTroncal,
} from './planta.service';

/**
 * NUESTRAS CENTRALITAS — dar de alta la planta de un municipio sin SSH.
 *
 * Reservado al superadmin, igual que `config_pbx` y por un motivo más fuerte:
 * desde aquí se reparten puertos de un servidor compartido y se generan las
 * credenciales de la línea del 123 de un municipio. No es algo que administre
 * el municipio desde su propia pantalla.
 *
 * A propósito NO cuelga de `PbxController` —que lleva
 * `@RequiereIntegracion('pbx')`—: habría que tener la telefonía habilitada
 * para poder montarla, que es justo al revés.
 */
@Roles('superadmin')
@Controller('plataforma/planta')
export class PlantaController {
  constructor(
    private readonly planta: PlantaService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  /** GET /api/plataforma/planta — todas las plantas, con lo que le falta a cada una. */
  @Get()
  listar(): Promise<VistaPlanta[]> {
    return this.planta.listar();
  }

  @Get(':tenant')
  ver(@Param('tenant') tenant: string): Promise<VistaPlanta> {
    return this.planta.ver(tenant);
  }

  /**
   * GET /api/plataforma/planta/:tenant/previa — los archivos como van a
   * quedar, con los secretos sustituidos.
   *
   * No rota nada: una vista previa que invalidara la API key de la instancia
   * sería una trampa para quien solo quería mirar.
   */
  @Get(':tenant/previa')
  previa(@Param('tenant') tenant: string): Promise<ConfiguracionPlanta> {
    return this.planta.previa(tenant);
  }

  @Post()
  async crear(
    @Usuario() actor: JwtPayload,
    @Body() dto: CrearPlantaDto,
  ): Promise<VistaPlanta> {
    const quien = actor?.sub ?? 'desconocido';
    const v = await this.planta.crear(dto ?? {}, quien);
    await this.auditoria.registrar(
      v.tenant,
      quien,
      'pbx.planta.crear',
      `Planta propia en ${v.servidor}: SIP ${v.puertoSip}, RTP ${v.rtpDesde}-${v.rtpHasta}, ` +
        `HTTP ${v.puertoHttp}, nombre ${v.dominioSip}`,
    );
    return v;
  }

  @Post(':tenant')
  async actualizar(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
    @Body() dto: ActualizarPlantaDto,
  ): Promise<VistaPlanta> {
    const quien = actor?.sub ?? 'desconocido';
    const v = await this.planta.actualizar(tenant, dto ?? {}, quien);
    await this.auditoria.registrar(
      v.tenant,
      quien,
      'pbx.planta.editar',
      `Planta en ${v.servidor} (${v.estado}): SIP ${v.puertoSip}, RTP ${v.rtpDesde}-${v.rtpHasta}, ` +
        `HTTP ${v.puertoHttp}, nombre ${v.dominioSip}`,
    );
    return v;
  }

  @Delete(':tenant')
  async eliminar(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
  ): Promise<{ tenant: string }> {
    const quien = actor?.sub ?? 'desconocido';
    const r = await this.planta.eliminar(tenant, quien);
    await this.auditoria.registrar(
      r.tenant,
      quien,
      'pbx.planta.eliminar',
      'Planta en borrador eliminada',
    );
    return r;
  }

  /**
   * POST /api/plataforma/planta/:tenant/aplicar — los archivos de verdad.
   *
   * Cambia estado: genera las claves que falten y ROTA la API key de la
   * instancia, porque FALCON solo guarda su digest. Lo que hay que saber
   * antes de instalar viene en `advertencias`.
   */
  @Post(':tenant/aplicar')
  async aplicar(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
  ): Promise<ConfiguracionPlanta> {
    const quien = actor?.sub ?? 'desconocido';
    const r = await this.planta.aplicar(tenant, quien);
    await this.auditoria.registrar(
      tenant,
      quien,
      'pbx.planta.aplicar',
      `Configuración generada (${r.archivos.length} archivos) y API key renovada`,
    );
    return r;
  }

  @Post(':tenant/troncal')
  async guardarTroncal(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
    @Body() dto: GuardarTroncalDto,
  ): Promise<VistaTroncal> {
    const quien = actor?.sub ?? 'desconocido';
    const t = await this.planta.guardarTroncal(tenant, dto ?? {}, quien);
    await this.auditoria.registrar(
      tenant,
      quien,
      'pbx.troncal',
      `Troncal «${t.nombre}» (${t.proveedor}) → ${t.servidor}:${t.puerto}, ${t.autenticacion}, ` +
        `${t.canales} canales, ${t.activa ? 'activa' : 'apagada'}` +
        (t.redes.length ? ` · redes ${t.redes.join(' ')}` : ' · sin redes'),
    );
    return t;
  }

  @Delete(':tenant/troncal/:id')
  async eliminarTroncal(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
    @Param('id') id: string,
  ): Promise<{ id: string }> {
    const quien = actor?.sub ?? 'desconocido';
    const r = await this.planta.eliminarTroncal(tenant, id, quien);
    await this.auditoria.registrar(
      tenant,
      quien,
      'pbx.troncal.eliminar',
      'Troncal eliminada',
    );
    return r;
  }

  @Post(':tenant/numero')
  async guardarNumero(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
    @Body() dto: GuardarNumeroDto,
  ): Promise<VistaNumero> {
    const quien = actor?.sub ?? 'desconocido';
    const n = await this.planta.guardarNumero(tenant, dto ?? {}, quien);
    await this.auditoria.registrar(
      tenant,
      quien,
      'pbx.numero',
      `Número ${n.numero} (${n.tipo}) → ${n.destino}, ${n.activo ? 'activo' : 'apagado'}`,
    );
    return n;
  }

  @Delete(':tenant/numero/:id')
  async eliminarNumero(
    @Usuario() actor: JwtPayload,
    @Param('tenant') tenant: string,
    @Param('id') id: string,
  ): Promise<{ id: string }> {
    const quien = actor?.sub ?? 'desconocido';
    const r = await this.planta.eliminarNumero(tenant, id, quien);
    await this.auditoria.registrar(
      tenant,
      quien,
      'pbx.numero.eliminar',
      'Número eliminado',
    );
    return r;
  }
}
