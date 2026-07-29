import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return { ok: true, servicio: 'falcon-cad-api', hora: new Date().toISOString() };
  }
}
