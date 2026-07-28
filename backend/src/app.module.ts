import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantMiddleware } from './common/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { CasosModule } from './casos/casos.module';

@Module({
  imports: [AuthModule, CasosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // El tenant se resuelve en todas las rutas.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
