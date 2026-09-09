import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { CatalogosModule } from '../catalogos/catalogos.module';

@Module({
  imports: [
    // UsuarioEntity directo (no UsuariosModule) a propósito: evita el
    // circular de módulos, igual que se hizo con AuditoriaModule — aquí
    // solo hace falta un COUNT(*) agrupado por tenant, no el servicio entero.
    AuditoriaModule, TypeOrmModule.forFeature([TenantEntity, UsuarioEntity]), CatalogosModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
