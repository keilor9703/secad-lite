import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { origenPermitido } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefijo común para toda la API.
  app.setGlobalPrefix('api');

  // Quién puede llamar a la API desde un navegador. Sin CORS_ORIGINS no se
  // restringe nada (desarrollo); con la variable, solo los orígenes listados.
  app.enableCors({ origin: origenPermitido, credentials: true });

  // El puerto lo impone el hospedaje (Render, Railway, etc.); 3000 en local.
  // Hay que escuchar en 0.0.0.0 y no en localhost, o el balanceador del
  // proveedor no alcanza el proceso y el despliegue queda "colgado".
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`FALCON CAD API escuchando en el puerto ${port} (prefijo /api)`);
}
bootstrap();
