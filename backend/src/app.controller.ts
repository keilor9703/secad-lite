import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET /api/health — verificación simple de que la API está viva (público). */
  @Public()
  @Get('health')
  health() {
    return this.appService.health();
  }
}
