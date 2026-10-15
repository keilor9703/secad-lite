import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { AvisosPbxService } from '../avisos.service';
import { PeticionWebhook } from '../webhook-log.service';
import { CuerpoAviso } from '../proveedores/aviso';

/**
 * La puerta de Zadarma. Lo único que tiene de propio es el saludo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA LLAVE VA EN LA URL Y NO EN UN ENCABEZADO
 *
 * El webhook genérico (`/api/pbx/webhook`) se autentica con `x-api-key`. En el
 * panel de Zadarma se configura UNA dirección y no hay dónde poner un
 * encabezado, así que la instancia tiene que viajar en la ruta:
 *
 *     https://falconcad.com.co/api/pbx/zadarma/<API_KEY_DE_LA_INSTANCIA>
 *
 * Una llave en una URL es peor que en un encabezado —queda en registros de
 * servidores intermedios— y por eso aquí **no es la autenticación**: solo
 * elige de qué instancia se habla. Lo que autentica es la **firma** del
 * encabezado `Signature`, calculada con el secreto que solo conocen Zadarma y
 * esta instancia. Una llave filtrada sin el secreto no permite inyectar ni una
 * llamada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA VALIDACIÓN `zd_echo`, QUE ES DONDE TODO EL MUNDO SE ATASCA
 *
 * Al guardar la dirección, Zadarma le manda una cadena al azar en `zd_echo` y
 * exige que se la devuelva **tal cual**: sin comillas, sin JSON, sin espacios,
 * sin salto de línea y sin BOM. Cualquier adorno y el panel dice que la URL no
 * es válida, sin explicar más.
 *
 * Por eso esta ruta responde el eco ANTES que nada: antes de resolver la
 * instancia y antes de mirar la firma (esa petición no trae ninguna). Y
 * responde igual por GET y por POST, porque el panel ha usado las dos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ ESTE ARCHIVO ES TAN CORTO
 *
 * Porque todo lo demás —resolver la instancia, comprobar que usa este
 * proveedor y que está encendido, verificar la firma, traducir, aplicar a la
 * cola y anotar en la bitácora— es igual para cualquier planta y vive en
 * `AvisosPbxService`. Un proveedor nuevo aporta su ruta, su saludo y las dos
 * funciones de su descriptor; nada de esto se vuelve a escribir.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Controller('pbx/zadarma')
export class ZadarmaController {
  constructor(private readonly avisos: AvisosPbxService) {}

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
  @Post(':clave')
  async webhook(
    @Req() req: PeticionWebhook,
    @Param('clave') clave: string,
    @Body() cuerpo: CuerpoAviso,
    @Headers('signature') firma?: string,
  ): Promise<unknown> {
    // El eco, primero que todo: esa petición no trae firma ni evento, y
    // tampoco es tráfico de llamadas que valga la pena anotar.
    const eco = cuerpo?.zd_echo;
    if (eco) return String(eco);

    return this.avisos.recibir({ proveedor: 'ZADARMA', clave, cuerpo, firma, req });
  }
}
