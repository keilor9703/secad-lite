import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return { ok: true, servicio: 'secad-lite-api', hora: new Date().toISOString() };
  }
}
