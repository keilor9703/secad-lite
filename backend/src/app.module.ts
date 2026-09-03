import { MiddlewareConsumer, Module, NestModule, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantMiddleware } from './common/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermisosGuard } from './auth/permisos.guard';
import { SuscripcionGuard } from './tenants/suscripcion.guard';
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
import { CtiModule } from './cti/cti.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuditoriaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    // Tope de intentos para las rutas que lo declaren (@UseGuards(ThrottlerGuard)):
    // hoy, el login. 5 por minuto por IP frena la fuerza bruta de contraseñas
    // sin estorbar el uso normal (un humano que se equivoca teclea menos que eso).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL')?.trim();
        return {
          throttlers: [{ ttl: 60_000, limit: 5 }],
          // Sin REDIS_URL (desarrollo, o una sola instancia) el conteo vive en
          // memoria, como siempre. Con más de una instancia detrás del
          // balanceador eso deja de ser confiable —cada instancia cuenta por
          // su cuenta, así que el tope real termina siendo (5 × instancias)—
          // y hace falta un conteo compartido.
          storage: redisUrl
            ? new ThrottlerStorageRedisService(redisUrl)
            : undefined,
        };
      },
    }),
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
        // Las bases gestionadas (Supabase, Neon, RDS…) exigen TLS. Con la CA
        // del proveedor en DB_SSL_CA (el PEM completo) la cadena se valida de
        // verdad; sin ella, DB_SSL=true cifra sin validar — sirve para una
        // demostración, no para producción.
        const ca = config.get<string>('DB_SSL_CA')?.trim();
        const ssl =
          config.get<string>('DB_SSL', 'false') === 'true'
            ? ca
              ? { rejectUnauthorized: true, ca }
              : { rejectUnauthorized: false }
            : undefined;
            
        if (config.get<string>('DB_SSL', 'false') === 'true' && !ca && process.env.NODE_ENV === 'production') {
          new Logger('Database').warn(
            'DB_SSL=true sin DB_SSL_CA: la conexión está cifrada pero el certificado del servidor ' +
            'NO se valida. Para producción real, configure DB_SSL_CA con el PEM del proveedor.',
          );
        }
        return {
          type: 'postgres' as const,
          url,
          ssl,
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
    CtiModule,
    IntegracionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JWT obligatorio en todas las rutas salvo las marcadas con @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Después, la puerta del servicio: suscripción vigente e integración habilitada.
    { provide: APP_GUARD, useClass: SuscripcionGuard },
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
