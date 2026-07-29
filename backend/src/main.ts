import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefijo común para toda la API.
  app.setGlobalPrefix('api');

  // CORS abierto para el frontend en desarrollo. En producción se restringe
  // al dominio del SaaS.
  app.enableCors({ origin: true, credentials: true });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`FALCON CAD API escuchando en http://localhost:${port}/api`);
}
bootstrap();
