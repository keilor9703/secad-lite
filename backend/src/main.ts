import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { origenPermitido } from './common/cors';
import { RedisIoAdapter } from './common/redis-io.adapter';

async function bootstrap() {
  // rawBody: la verificación de firma del webhook de WhatsApp necesita los
  // bytes exactos que envió Meta, no el JSON ya reinterpretado.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Cabeceras de seguridad estándar (X-Content-Type-Options, HSTS, etc.).
  app.use(helmet());
  // Detrás del balanceador del hospedaje, la IP real del cliente viaja en
  // X-Forwarded-For: sin esto, el tope de intentos de login contaría todos
  // los usuarios como una sola IP (la del proxy).
  app.set('trust proxy', 1);

  // Prefijo común para toda la API.
  app.setGlobalPrefix('api');

  // Validación estructural de la entrada: los bodies tipados como clase DTO
  // se comprueban (tipos, longitudes, valores permitidos) y se les quita lo
  // que no esté declarado, ANTES de llegar al servicio. Un body malformado
  // responde 400 con el detalle, en vez de reventar en 500 en un .trim().
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Quién puede llamar a la API desde un navegador. Sin CORS_ORIGINS no se
  // restringe nada (desarrollo); con la variable, solo los orígenes listados.
  app.enableCors({ origin: origenPermitido, credentials: true });

  // Con más de una instancia detrás del balanceador, el aviso en vivo (PBX,
  // chat) necesita un canal compartido para que un operador conectado a OTRA
  // instancia también se entere. Sin REDIS_URL sigue funcionando igual que
  // siempre (memoria local), correcto para una sola instancia.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(app.get(ConfigService));
  app.useWebSocketAdapter(redisIoAdapter);

  // El puerto lo impone el hospedaje (Render, Railway, etc.); 3000 en local.
  // Hay que escuchar en 0.0.0.0 y no en localhost, o el balanceador del
  // proveedor no alcanza el proceso y el despliegue queda "colgado".
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `FALCON CAD API escuchando en el puerto ${port} (prefijo /api)`,
  );
}
bootstrap();
