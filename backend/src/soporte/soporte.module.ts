import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { SoporteController } from './soporte.controller';
import { SoporteService } from './soporte.service';
import { CorreoService } from '../correo/correo.service';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { TenantEntity } from '../tenants/tenant.entity';

/**
 * Las entidades se registran directo con `forFeature` —y no se importan
 * UsuariosModule ni TenantsModule— por el mismo criterio que PlataformaModule:
 * aquí solo se leen dos filas para armar un correo, y arrastrar esos módulos
 * traería sus servicios y el riesgo de un ciclo a cambio de nada.
 *
 * AuditoriaModule sí se importa: no tiene dependencias hacia otros módulos de
 * negocio, justamente para que cualquiera pueda dejar rastro sin ciclos.
 */
@Module({
  imports: [AuditoriaModule, TypeOrmModule.forFeature([UsuarioEntity, TenantEntity])],
  controllers: [SoporteController],
  providers: [SoporteService, CorreoService],
})
export class SoporteModule {}
