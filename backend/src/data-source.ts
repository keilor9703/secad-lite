import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { CasoEntity } from './casos/caso.entity';
import { EventoCasoEntity } from './casos/evento.entity';
import { UsuarioEntity } from './usuarios/usuario.entity';
import { MensajeChatEntity } from './chat/mensaje.entity';
import { TenantEntity } from './tenants/tenant.entity';
import { RecursoEntity } from './despacho/recurso.entity';
import { AsignacionEntity } from './despacho/asignacion.entity';
import { LlamadaEntity } from './pbx/llamada.entity';
import { RolEntity } from './roles/rol.entity';
import { EntidadEntity } from './integracion/entidad.entity';
import { AgenciaEntity } from './catalogos/agencia.entity';
import { CanalEntity } from './catalogos/canal.entity';
import { CodigoCasoEntity } from './catalogos/codigo-caso.entity';

config();

/**
 * DataSource para el CLI de TypeORM (generar/correr/revertir migraciones).
 * La app en runtime usa la configuración de app.module; este archivo es solo
 * para las herramientas de migración.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [CasoEntity, EventoCasoEntity, UsuarioEntity, MensajeChatEntity, TenantEntity, RecursoEntity, AsignacionEntity, LlamadaEntity, RolEntity, EntidadEntity, AgenciaEntity, CanalEntity, CodigoCasoEntity],
  migrations: ['src/migrations/*.ts'],
});
