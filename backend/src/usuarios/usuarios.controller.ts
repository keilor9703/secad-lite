import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarUsuarioDto, CrearUsuarioDto, UsuariosService } from './usuarios.service';
import { Permisos } from '../auth/permisos.decorator';
import { Usuario } from '../common/usuario.decorator';
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

  @Get()
  listar(@Usuario() actor: JwtPayload) {
    return this.usuarios.listar(actor);
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
