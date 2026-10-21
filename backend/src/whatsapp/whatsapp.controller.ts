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
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

@RequiereIntegracion('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly wa: WhatsappService,
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaAdminService,
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

  /**
   * POST /api/whatsapp/infobip — mensajes entrantes por Infobip.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ UNA RUTA APARTE Y NO LA MISMA
   *
   * Porque lo que llega es otra cosa. Infobip entrega en SU formato y se
   * autentica de otra manera. Meterlo en la misma ruta obligaría a adivinar
   * de quién viene cada cuerpo antes de poder validarlo, que es exactamente
   * el orden equivocado: primero se autentica, después se interpreta.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * LA AUTENTICACIÓN ES UN SECRETO COMPARTIDO EN UNA CABECERA
   *
   * Infobip ofrece Básico, HMAC y OAuth, y además cabeceras propias. Se eligió
   * la cabecera con un secreto por una razón práctica: HMAC obligaría a
   * reimplementar EXACTAMENTE su esquema de firma —qué cadena firman, con qué
   * algoritmo, en qué cabecera— sin poder comprobarlo contra su servidor, y un
   * error en cualquiera de los tres deja el endpoint rechazando todo sin
   * poder distinguir un ataque de un error nuestro. El contenido ya va
   * cifrado: el perfil obliga TLS 1.2/1.3.
   *
   * Lo que esto impide es lo que hay que impedir: que alguien que descubra la
   * URL inyecte emergencias falsas. Una emergencia falsa en una línea del 123
   * despacha una patrulla a una dirección inventada.
   *
   * Sin `INFOBIP_WEBHOOK_TOKEN` configurado, en producción se rechaza todo:
   * mejor caído que falsificable, igual que el webhook de Meta.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * SIEMPRE 200, SALVO QUE NO ESTÉ AUTENTICADO
   *
   * Un cuerpo que no entendemos NO se contesta con error: Infobip lo
   * reintentaría, y reintentar algo que no sabemos leer no lo vuelve legible;
   * solo multiplica el ruido. Se cuenta y se avisa en el log, y la respuesta
   * dice cuántos quedaron sin reconocer para poder verlo desde fuera.
   */
  @Public()
  @Post('infobip')
  async recibirDeInfobip(@Req() req: Request, @Body() payload: unknown) {
    this.verificarToken(req);
    const r = await this.wa.recibirDeInfobip(payload);
    return { received: true, ...r };
  }

  private static avisoSinToken = false;

  private verificarToken(req: Request): void {
    const esperado = this.config.get<string>('INFOBIP_WEBHOOK_TOKEN')?.trim();
    if (!esperado) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException(
          'Webhook de Infobip deshabilitado: falta INFOBIP_WEBHOOK_TOKEN.',
        );
      }
      if (!WhatsappController.avisoSinToken) {
        WhatsappController.avisoSinToken = true;
        new Logger(WhatsappController.name).warn(
          'INFOBIP_WEBHOOK_TOKEN no está configurado: el webhook de Infobip acepta ' +
            'cuerpos SIN autenticar (solo desarrollo).',
        );
      }
      return;
    }
    const recibido = req.header('x-infobip-token') ?? '';
    // Comparación de tiempo constante: una comparación normal revela el
    // secreto carácter por carácter a quien mida cuánto tarda en fallar.
    const a = Buffer.from(esperado, 'utf8');
    const b = Buffer.from(recibido, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Token del webhook de Infobip inválido.');
    }
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
    @Usuario() u: JwtPayload,
    @Body() dto: { phoneNumberId?: string; accessToken?: string; agenciaResponsableId?: string | null; canales?: string[]; numero?: string },
  ) {
    const cfg = await this.tenants.setWaConfig(
      tenant, dto?.phoneNumberId, dto?.accessToken, dto?.agenciaResponsableId, dto?.canales, dto?.numero,
    );
    const conToken = dto?.accessToken?.trim() ? ', token renovado' : '';
    await this.auditoria.registrar(tenant, u?.sub ?? 'desconocido', 'whatsapp.config',
      `Actualizó la configuración de WhatsApp (número: ${cfg.numero ?? '—'}, `
      + `phone_number_id: ${cfg.phoneNumberId ?? '—'}${conToken}).`);
    return { ...cfg, verifyToken: this.verifyToken, webhookPath: '/api/whatsapp/webhook' };
  }

  /** GET /api/whatsapp/casos/:id/mensajes — conversación del caso. */
  /**
   * GET /api/whatsapp/estado — qué le falta a esta línea, y cuánto se mueve.
   *
   * La pantalla de configuración no decía nada: si faltaba algo, los mensajes
   * simplemente no llegaban. Averiguar por qué costaba entrar al servidor a
   * leer `docker logs`, que es asumible una vez y no con un municipio nuevo
   * cada mes.
   */
  @Permisos('whatsapp.configurar')
  @Get('estado')
  estado(@Tenant() tenant: string) {
    return this.wa.estado(tenant);
  }

  /**
   * POST /api/whatsapp/probar — manda un mensaje de prueba a un número.
   *
   * No cambia nada: solo intenta enviar y devuelve qué contestó el proveedor.
   * Queda en la bitácora porque manda un mensaje real a un teléfono real, y
   * porque saber quién probó y cuándo es la mitad de un diagnóstico.
   */
  @Permisos('whatsapp.configurar')
  @Post('probar')
  async probar(
    @Tenant() tenant: string,
    @Usuario() u: JwtPayload,
    @Body() dto: { a?: string },
  ) {
    const r = await this.wa.probar(tenant, dto?.a ?? '');
    // Solo los cuatro últimos dígitos: el teléfono completo de un ciudadano
    // no tiene por qué quedar en la bitácora administrativa, que es inmutable.
    const cola = (dto?.a ?? '').replace(/\D/g, '').slice(-4);
    await this.auditoria.registrar(
      tenant, u.sub, 'whatsapp.probar',
      `Prueba de la línea hacia ···${cola}: ${r.ok ? 'enviada' : 'no salió'}`,
    );
    return r;
  }

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
