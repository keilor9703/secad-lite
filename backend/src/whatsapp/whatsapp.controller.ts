import {
  Body, Controller, ForbiddenException, Get, Logger, Param, Post, Put, Query, RawBodyRequest, Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsappService } from './whatsapp.service';
import { TenantsService } from '../tenants/tenants.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

@RequiereIntegracion('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly wa: WhatsappService,
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
  ) {}

  private get verifyToken(): string {
    return this.config.get<string>('WHATSAPP_VERIFY_TOKEN', 'falcon-cad');
  }

  /**
   * GET /api/whatsapp/webhook — verificación del webhook de Meta.
   * Devuelve el `hub.challenge` si el `hub.verify_token` coincide.
   */
  @Public()
  @Get('webhook')
  verificar(@Query() q: Record<string, string>): string {
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === this.verifyToken) {
      return q['hub.challenge'];
    }
    throw new ForbiddenException('Verificación fallida.');
  }

  /**
   * POST /api/whatsapp/webhook — mensajes entrantes de Meta.
   *
   * Meta firma cada entrega con HMAC-SHA256 del cuerpo crudo usando el app
   * secret (header `X-Hub-Signature-256`). Sin verificarla, cualquiera que
   * conozca la URL y un phone_number_id podría inyectar casos y mensajes
   * falsos a la bandeja. Con `WHATSAPP_APP_SECRET` configurado se exige la
   * firma; sin configurar, en producción se rechaza todo (mejor caído que
   * falsificable) y en desarrollo se acepta con una advertencia en el log.
   */
  @Public()
  @Post('webhook')
  async recibir(@Req() req: RawBodyRequest<Request>, @Body() payload: any) {
    this.verificarFirma(req);
    await this.wa.recibir(payload);
    return { received: true };
  }

  private static avisoSinSecreto = false;

  private verificarFirma(req: RawBodyRequest<Request>): void {
    const secreto = this.config.get<string>('WHATSAPP_APP_SECRET')?.trim();
    if (!secreto) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException('Webhook de WhatsApp deshabilitado: falta WHATSAPP_APP_SECRET.');
      }
      if (!WhatsappController.avisoSinSecreto) {
        WhatsappController.avisoSinSecreto = true;
        new Logger(WhatsappController.name).warn(
          'WHATSAPP_APP_SECRET no está configurado: el webhook acepta payloads SIN verificar la firma (solo desarrollo).',
        );
      }
      return;
    }
    const firma = req.header('x-hub-signature-256') ?? '';
    const cuerpo = req.rawBody;
    if (!firma.startsWith('sha256=') || !cuerpo) {
      throw new ForbiddenException('Firma del webhook ausente o mal formada.');
    }
    const esperada = createHmac('sha256', secreto).update(cuerpo).digest('hex');
    const recibida = firma.slice('sha256='.length);
    const a = Buffer.from(esperada, 'utf8');
    const b = Buffer.from(recibida, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Firma del webhook inválida.');
    }
  }

  /** GET /api/whatsapp/config — estado de la integración. */
  @Permisos('whatsapp.configurar')
  @Get('config')
  async getConfig(@Tenant() tenant: string) {
    const cfg = await this.tenants.getWaConfig(tenant);
    return { ...cfg, verifyToken: this.verifyToken, webhookPath: '/api/whatsapp/webhook' };
  }

  /**
   * PUT /api/whatsapp/config — phone_number_id, token, y a qué agencia/canales
   * se envían los casos que entren por este canal (sin esto, solo los ve un
   * supervisor).
   */
  @Permisos('whatsapp.configurar')
  @Put('config')
  async setConfig(
    @Tenant() tenant: string,
    @Body() dto: { phoneNumberId?: string; accessToken?: string; agenciaResponsableId?: string | null; canales?: string[] },
  ) {
    const cfg = await this.tenants.setWaConfig(
      tenant, dto?.phoneNumberId, dto?.accessToken, dto?.agenciaResponsableId, dto?.canales,
    );
    return { ...cfg, verifyToken: this.verifyToken, webhookPath: '/api/whatsapp/webhook' };
  }

  /** GET /api/whatsapp/casos/:id/mensajes — conversación del caso. */
  @Permisos('whatsapp.responder')
  @Get('casos/:id/mensajes')
  mensajes(@Tenant() tenant: string, @Param('id') id: string) {
    return this.wa.historial(tenant, id);
  }

  /** POST /api/whatsapp/casos/:id/responder — el operador responde al ciudadano. */
  @Permisos('whatsapp.responder')
  @Post('casos/:id/responder')
  responder(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Param('id') id: string, @Body() dto: { texto: string }) {
    return this.wa.responder(tenant, id, dto?.texto, usuario?.sub ?? 'operador');
  }
}
