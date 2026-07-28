import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantMiddleware } from './common/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CasosModule } from './casos/casos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Skeleton: TypeORM crea/actualiza el esquema al arrancar. En producción
        // se desactiva y se usan migraciones versionadas.
        synchronize: true,
      }),
    }),
    AuthModule,
    CasosModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JWT obligatorio en todas las rutas salvo las marcadas con @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
