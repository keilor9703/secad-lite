import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlataformaController } from './plataforma.controller';
import { PlataformaService } from './plataforma.service';
import { InfraestructuraService } from './infraestructura.service';
import { TenantEntity } from '../tenants/tenant.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { BitacoraAdminEntity } from '../auditoria/bitacora-admin.entity';
import { CtiEventoEntity } from '../cti/cti-evento.entity';

/**
 * Solo lectura y sin dependencias hacia otros módulos de negocio: las entidades
 * se registran directo con `forFeature` (mismo criterio que AuditoriaModule)
 * para no arrastrar servicios ajenos ni arriesgar ciclos. `TenantRlsService`
 * llega por CommonModule, que es global.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity, UsuarioEntity, BitacoraAdminEntity, CtiEventoEntity]),
  ],
  controllers: [PlataformaController],
  providers: [PlataformaService, InfraestructuraService],
})
export class PlataformaModule {}
