import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolEntity } from './rol.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

/**
 * RBAC dinámico: roles a medida por tenant + matriz de permisos. Usa el repo de
 * usuarios (solo conteo) para impedir borrar un rol en uso.
 */
@Module({
  imports: [
    AuditoriaModule,TypeOrmModule.forFeature([RolEntity, UsuarioEntity])],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
