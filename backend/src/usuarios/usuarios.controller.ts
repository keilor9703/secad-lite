import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ActualizarUsuarioDto, CrearUsuarioDto, UsuariosService } from './usuarios.service';
import { Permisos } from '../auth/permisos.decorator';
import { Usuario } from '../common/usuario.decorator';
import { Tenant } from '../common/tenant.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';

// Gestión de usuarios: requiere el permiso usuarios.gestionar (superadmin siempre).
@Permisos('usuarios.gestionar')
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  /**
   * Usuarios DEL TENANT EN GESTIÓN (el que el superadmin eligió en la barra
   * superior) — igual que roles, agencias, canales y demás recursos de
   * Administración. `@Tenant()` ya resuelve esto (y exige que el superadmin
   * haya elegido uno); antes se ignoraba y siempre se listaba todo.
   */
  @Get()
  listar(@Tenant() tenant: string) {
    return this.usuarios.listar(tenant);
  }

  /**
   * Validación en vivo del formulario de alta: si el username ya existe (en
   * cualquier tenant), lo dice ANTES de intentar crear la cuenta. No revela
   * en qué tenant está tomado — solo si está disponible o no.
   */
  @Get('disponible')
  async disponible(@Query('username') username: string) {
    return { disponible: !(await this.usuarios.existeUsername(username)) };
  }

  @Post()
  async crear(@Usuario() actor: JwtPayload, @Body() dto: CrearUsuarioDto) {
    const u = await this.usuarios.crear(actor, dto);
    await this.auditoria.registrar(
      u.tenant ?? 'plataforma', actor.sub, 'usuario.crear',
      `Creó la cuenta «${u.username}» con rol ${u.rol}.`,
    );
    return u;
  }

  /**
   * POST /api/usuarios/:id/mfa/restablecer
   *
   * Exige `usuarios.gestionar` Y `usuarios.mfa_restablecer`: el permiso propio
   * no es por el riesgo —quien puede restablecer una contraseña ya se puede
   * apoderar de la cuenta, y eso lo da `usuarios.gestionar`— sino para que la
   * capacidad se conceda a conciencia y quede separada en la bitácora.
   */
  @Permisos('usuarios.gestionar', 'usuarios.mfa_restablecer')
  @Post(':id/mfa/restablecer')
  async restablecerMfa(@Usuario() actor: JwtPayload, @Param('id') id: string) {
    const r = await this.usuarios.restablecerMfa(actor, id);
    await this.auditoria.registrar(
      r.tenant ?? 'plataforma', actor.sub, 'usuario.mfa_restablecer',
      `Restableció el doble factor de «${r.username}»`
        + (r.teniaMfa ? '.' : ' (que no lo tenía configurado).'),
    );
    return {
      ok: true,
      mensaje: r.teniaMfa
        ? `${r.username} deberá vincular su aplicación de autenticación al entrar.`
        : `${r.username} no tenía doble factor configurado; no había nada que restablecer.`,
    };
  }

  @Patch(':id')
  async actualizar(@Usuario() actor: JwtPayload, @Param('id') id: string, @Body() dto: ActualizarUsuarioDto) {
    const u = await this.usuarios.actualizar(actor, id, dto);
    // Qué se tocó, sin exponer jamás valores sensibles.
    const campos = Object.keys(dto ?? {})
      .map((c) => (c === 'contrasena' ? 'contraseña restablecida' : c))
      .join(', ') || 'sin cambios';
    await this.auditoria.registrar(
      u.tenant ?? 'plataforma', actor.sub, 'usuario.actualizar',
      `Actualizó la cuenta «${u.username}» (${campos}).`,
    );
    return u;
  }
}
