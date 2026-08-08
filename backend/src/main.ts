import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { origenPermitido } from './common/cors';

async function bootstrap() {
  // rawBody: la verificación de firma del webhook de WhatsApp necesita los
  // bytes exactos que envió Meta, no el JSON ya reinterpretado.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Cabeceras de seguridad estándar (X-Content-Type-Options, HSTS, etc.).
  app.use(helmet());
  // Detrás del balanceador del hospedaje, la IP real del cliente viaja en
  // X-Forwarded-For: sin esto, el tope de intentos de login contaría todos
  // los usuarios como una sola IP (la del proxy).
  app.set('trust proxy', 1);

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
