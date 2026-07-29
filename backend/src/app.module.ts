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
import { CasosModule } from './casos/casos.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ChatModule } from './chat/chat.module';
import { MetricasModule } from './metricas/metricas.module';

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
          // Skeleton: TypeORM crea/actualiza el esquema al arrancar. En producción
          // se desactiva y se usan migraciones versionadas.
          synchronize: true,
        };
      },
    }),
    UsuariosModule,
    AuthModule,
    CasosModule,
    ChatModule,
    MetricasModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JWT obligatorio en todas las rutas salvo las marcadas con @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Luego, restricción por rol donde haya @Roles().
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
