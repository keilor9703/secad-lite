import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { CasoEntity } from './casos/caso.entity';
import { EventoCasoEntity } from './casos/evento.entity';
import { UsuarioEntity } from './usuarios/usuario.entity';
import { MensajeChatEntity } from './chat/mensaje.entity';

config();

/**
 * DataSource para el CLI de TypeORM (generar/correr/revertir migraciones).
 * La app en runtime usa la configuración de app.module; este archivo es solo
 * para las herramientas de migración.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [CasoEntity, EventoCasoEntity, UsuarioEntity, MensajeChatEntity],
  migrations: ['src/migrations/*.ts'],
});
