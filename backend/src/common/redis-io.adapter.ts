import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/**
 * Con una sola instancia del backend, Socket.IO reparte el aviso en vivo (PBX,
 * chat) en memoria, y le basta. En cuanto hay más de una instancia detrás del
 * balanceador (para redundancia y despliegues sin downtime), un operador
 * conectado a la instancia A no se entera de un evento emitido desde la
 * instancia B — hace falta un canal compartido entre instancias.
 *
 * Con REDIS_URL configurado, este adaptador conecta las instancias por Redis
 * pub/sub. Sin la variable (desarrollo, o una sola instancia en producción),
 * se comporta exactamente igual que el adaptador de Socket.IO por defecto —
 * Redis no es obligatorio para arrancar el sistema.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(config: ConfigService): Promise<void> {
    const url = config.get<string>('REDIS_URL')?.trim();
    if (!url) return;
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    pubClient.on('error', (e) =>
      this.logger.error(`Redis (pub) para Socket.IO: ${e.message}`),
    );
    subClient.on('error', (e) =>
      this.logger.error(`Redis (sub) para Socket.IO: ${e.message}`),
    );
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(
      'Socket.IO conectado a Redis: el aviso en vivo se reparte entre instancias.',
    );
  }

  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
