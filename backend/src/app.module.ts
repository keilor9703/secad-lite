import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantMiddleware } from './common/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermisosGuard } from './auth/permisos.guard';
import { RolesModule } from './roles/roles.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { CasosModule } from './casos/casos.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ChatModule } from './chat/chat.module';
import { MetricasModule } from './metricas/metricas.module';
import { TenantsModule } from './tenants/tenants.module';
import { DespachoModule } from './despacho/despacho.module';
import { PbxModule } from './pbx/pbx.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { IntegracionModule } from './integracion/integracion.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        if (!url) {
          throw new Error(
            'Falta DATABASE_URL. Copia backend/.env.example a backend/.env ' +
              '(en Windows: "Copy-Item .env.example .env") y ajusta la cadena de ' +
              'conexión, o levanta PostgreSQL con "docker compose up -d" desde la raíz.',
          );
        }
        return {
          type: 'postgres' as const,
          url,
          autoLoadEntities: true,
          // Dev: TypeORM crea/actualiza el esquema al arrancar (DB_SYNC=true por
          // defecto). Producción: DB_SYNC=false + DB_MIGRATE=true para aplicar
          // migraciones versionadas de src/migrations al arrancar.
          synchronize: config.get<string>('DB_SYNC', 'true') === 'true',
          migrations: ['dist/migrations/*.js'],
          migrationsRun: config.get<string>('DB_MIGRATE', 'false') === 'true',
        };
      },
    }),
    UsuariosModule,
    TenantsModule,
    RolesModule,
    CatalogosModule,
    AuthModule,
    CasosModule,
    ChatModule,
    MetricasModule,
    DespachoModule,
    PbxModule,
    WhatsappModule,
    IntegracionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JWT obligatorio en todas las rutas salvo las marcadas con @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Luego, restricción por rol reservado donde haya @Roles().
    { provide: APP_GUARD, useClass: RolesGuard },
    // Y por permiso (RBAC dinámico) donde haya @Permisos().
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
