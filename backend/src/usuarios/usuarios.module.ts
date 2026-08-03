import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioEntity } from './usuario.entity';
import { UsuariosService } from './usuarios.service';
import { UsuariosController } from './usuarios.controller';
import { RolesModule } from '../roles/roles.module';
import { CatalogosModule } from '../catalogos/catalogos.module';

@Module({
  imports: [TypeOrmModule.forFeature([UsuarioEntity]), RolesModule, CatalogosModule],
  controllers: [UsuariosController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}
