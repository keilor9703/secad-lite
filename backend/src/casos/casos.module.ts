import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasosController } from './casos.controller';
import { CasosService } from './casos.service';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity } from './evento.entity';
import { DespachoModule } from '../despacho/despacho.module';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthModule } from '../auth/auth.module';
import { CasosGateway } from './casos.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity, EventoCasoEntity]), DespachoModule, CatalogosModule, UsuariosModule, TenantsModule, AuthModule],
  controllers: [CasosController],
  providers: [CasosService, CasosGateway],
  exports: [CasosService, CasosGateway],
})
export class CasosModule {}
