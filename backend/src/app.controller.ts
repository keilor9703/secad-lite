import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET /api/health — verificación simple de que la API está viva. */
  @Get('health')
  health() {
    return this.appService.health();
  }
}
