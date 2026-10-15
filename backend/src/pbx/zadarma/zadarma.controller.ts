import {
  Body, Controller, Get, Headers, Param, Post, Query, UseFilters, UseInterceptors,
} from '@nestjs/common';
import { TenantsService } from '../../tenants/tenants.service';
import { Public } from '../../auth/public.decorator';
import { PbxWebhookRechazoFilter } from '../webhook-rechazo.filter';
import { PbxWebhookExitoInterceptor } from '../webhook-exito.interceptor';
import { ZadarmaService } from './zadarma.service';
import { CuerpoZadarma, verificarFirma } from './zadarma.firma';

/**
 * El webhook de la centralita de Zadarma.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA LLAVE VA EN LA URL Y NO EN UN ENCABEZADO
 *
 * El webhook genérico (`/api/pbx/webhook`) se autentica con `x-api-key`. En el
 * panel de Zadarma se configura UNA dirección y no hay dónde poner un
 * encabezado, así que el tenant tiene que viajar en la ruta:
 *
 *     https://falconcad.com.co/api/pbx/zadarma/<API_KEY_DE_LA_INSTANCIA>
 *
 * Una llave en una URL es peor que en un encabezado —queda en registros de
 * servidores intermedios— y por eso aquí **no es la autenticación**: solo
 * elige de qué instancia se habla. Lo que autentica es la **firma** del
 * encabezado `Signature`, calculada con el secreto de Zadarma que solo
 * conocen ellos y esta instancia. Una llave filtrada sin el secreto no
 * permite inyectar ni una llamada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA VALIDACIÓN `zd_echo`, QUE ES DONDE TODO EL MUNDO SE ATASCA
 *
 * Al guardar la dirección, Zadarma le manda una cadena al azar en `zd_echo` y
 * exige que se la devuelva **tal cual**: sin comillas, sin JSON, sin espacios,
 * sin salto de línea y sin BOM. Cualquier adorno y el panel dice que la URL no
 * es válida, sin explicar más.
 *
 * Por eso esta ruta responde el eco ANTES que nada: antes de resolver el
 * tenant y antes de mirar la firma (esa petición no trae ninguna). Y responde
 * igual por GET y por POST, porque el panel ha usado las dos.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Controller('pbx/zadarma')
export class ZadarmaController {
  constructor(
    private readonly zadarma: ZadarmaService,
    private readonly tenants: TenantsService,
  ) {}

  /**
   * GET /api/pbx/zadarma/:clave — la validación del panel, y nada más.
   *
   * Sin `zd_echo` devuelve una señal de vida escueta: sirve para comprobar con
   * `curl` que la ruta existe y llega, sin revelar si la llave es correcta.
   */
  @Public()
  @Get(':clave')
  verificarUrl(@Query('zd_echo') eco?: string): string {
    return eco ? String(eco) : 'FALCON CAD · webhook de Zadarma';
  }

  /**
   * POST /api/pbx/zadarma/:clave — los eventos de la centralita.
   *
   * Zadarma manda `application/x-www-form-urlencoded`, no JSON. El
   * `ValidationPipe` global no estorba porque el parámetro no está tipado con
   * una clase: aquí la validación la hace la firma, que es más fuerte que
   * cualquier comprobación de forma.
   */
  @Public()
  @UseFilters(PbxWebhookRechazoFilter)
  @UseInterceptors(PbxWebhookExitoInterceptor)
  @Post(':clave')
  async webhook(
    @Param('clave') clave: string,
    @Body() cuerpo: CuerpoZadarma,
    @Headers('signature') firma?: string,
  ): Promise<unknown> {
    // 1. El eco, primero que todo: esa petición no trae firma ni evento.
    const eco = cuerpo?.zd_echo;
    if (eco) return String(eco);

    // 2. De qué instancia hablamos.
    const tenant = await this.tenants.porApiKey(clave);
    if (!tenant) return this.rechazo('Llave de instancia desconocida.');
    this.tenants.asegurarVigente(tenant, 'pbx');

    // 3. ¿Esta instancia tiene Zadarma, y encendido?
    const cfg = await this.zadarma.configDe(tenant.codigo);
    if (!cfg || cfg.proveedor !== 'ZADARMA') {
      return this.rechazo('Esta instancia no tiene Zadarma como planta telefónica.');
    }
    if (!cfg.activo) {
      // Apagado a propósito. Se responde 200 para que Zadarma no reintente
      // eternamente, y queda anotado en la bitácora del webhook.
      return { ok: true, ignorado: 'La integración de Zadarma está apagada para esta instancia.' };
    }

    // 4. La firma: esto es lo que de verdad autentica.
    const veredicto = verificarFirma(cuerpo, firma, this.zadarma.secretoDe(cfg));
    if (!veredicto.ok) return this.rechazo(veredicto.motivo);

    // 5. Traducir y aplicar.
    const r = await this.zadarma.procesar(tenant, cuerpo);
    return r.cuerpo;
  }

  /**
   * Un rechazo se responde con 200 y un motivo en el cuerpo, no con 4xx.
   *
   * Zadarma reintenta lo que no recibe un 200, y reintentar no arregla una
   * llave mal escrita ni una firma que no cuadra: solo multiplica el ruido.
   * El rechazo queda en `pbx_webhook_log` con su motivo, que es donde se mira
   * cuando «la central dice que lo mandó».
   */
  private rechazo(motivo: string): { ok: false; motivo: string } {
    return { ok: false, motivo };
  }
}
