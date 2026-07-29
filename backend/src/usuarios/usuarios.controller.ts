import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarUsuarioDto, CrearUsuarioDto, UsuariosService } from './usuarios.service';
import { Roles } from '../auth/roles.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';

// Gestión de usuarios: admin (su secad) y superadmin (todos).
@Roles('admin', 'superadmin')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar(@Usuario() actor: JwtPayload) {
    return this.usuarios.listar(actor);
  }

  @Post()
  crear(@Usuario() actor: JwtPayload, @Body() dto: CrearUsuarioDto) {
    return this.usuarios.crear(actor, dto);
  }

  @Patch(':id')
  actualizar(@Usuario() actor: JwtPayload, @Param('id') id: string, @Body() dto: ActualizarUsuarioDto) {
    return this.usuarios.actualizar(actor, id, dto);
  }
}
