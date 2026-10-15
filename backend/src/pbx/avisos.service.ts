import { HttpException, Injectable } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { PbxService, WebhookLlamadaDto } from './pbx.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { PbxWebhookLogService, PeticionWebhook } from './webhook-log.service';
import { CuerpoAviso, DatosLlamada } from './proveedores/aviso';
import { ProveedorPbx } from './proveedores/proveedor';
import { proveedor as proveedorPorClave } from './proveedores/registro';

/**
 * RECIBIR UN AVISO DE CUALQUIER PLANTA TELEFÓNICA
 *
 * Todo lo que hay entre «llegó un POST» y «la llamada está en la cola» es
 * igual para cualquier proveedor, y vive aquí:
 *
 *  1. de qué instancia se habla (la API key de la ruta);
 *  2. si esa instancia tiene contratada la telefonía y con qué proveedor;
 *  3. si la planta está encendida;
 *  4. si el aviso es auténtico — lo verifica el proveedor, que es el único que
 *     sabe cómo firma la suya;
 *  5. qué significa — lo traduce el proveedor al modelo de FALCON;
 *  6. aplicarlo a la cola, y dejar escrito en la bitácora qué se hizo.
 *
 * Lo único que un proveedor nuevo pone de su parte es el controlador con su
 * ruta y su saludo —cada panel admite UNA dirección y valida a su manera— y
 * las dos funciones de su descriptor. El resto no se vuelve a escribir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO SE RESPONDE CON 200, INCLUSO UN RECHAZO
 *
 * Las centrales reintentan lo que no recibe un 2xx, y reintentar no arregla
 * una llave mal escrita ni una firma que no cuadra: solo multiplica el ruido.
 * El rechazo va en el cuerpo y, sobre todo, en `pbx_webhook_log` con su
 * motivo, que es donde se mira cuando «la central dice que lo mandó».
 *
 * La excepción es un error inesperado (un 500): ese SÍ sube, porque ahí el
 * reintento es justo lo que hace falta y un 500 no se puede esconder.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AvisosPbxService {
  constructor(
    private readonly pbx: PbxService,
    private readonly tenants: TenantsService,
    private readonly cred: PbxCredencialesService,
    private readonly bitacora: PbxWebhookLogService,
  ) {}

  /**
   * El camino completo de un aviso. Devuelve lo que hay que responderle al
   * proveedor.
   */
  async recibir(entrada: {
    /** Clave del proveedor dueño de esta ruta (`'ZADARMA'`). */
    proveedor: string;
    /** La API key de la instancia, tal como viene en la ruta. */
    clave: string;
    cuerpo: CuerpoAviso;
    firma?: string;
    req: PeticionWebhook;
  }): Promise<unknown> {
    const { req, cuerpo } = entrada;
    const impl = proveedorPorClave(entrada.proveedor);
    if (!impl) return this.rechazo(req, null, `Proveedor no reconocido: ${entrada.proveedor}.`);

    // 1. De qué instancia hablamos.
    const tenant = await this.tenants.porApiKey(entrada.clave);
    if (!tenant) return this.rechazo(req, null, 'Llave de instancia desconocida.');
    try {
      this.tenants.asegurarVigente(tenant, 'pbx');
    } catch (e) {
      return this.rechazo(req, tenant.codigo, mensajeDe(e));
    }

    // 2. ¿Esta instancia usa ESTE proveedor?
    const fila = await this.cred.configDe(tenant.codigo);
    if (this.cred.claveProveedor(fila) !== impl.descriptor.clave) {
      return this.rechazo(
        req, tenant.codigo,
        `Esta instancia no tiene ${impl.descriptor.nombre} como planta telefónica.`,
      );
    }

    // 3. ¿Encendida?
    if (fila && !fila.activo) {
      // Apagado a propósito. Queda anotado, y se responde «ignorado» para que
      // la central no reintente eternamente algo que es una decisión nuestra.
      const motivo = `La integración de ${impl.descriptor.nombre} está apagada para esta instancia.`;
      return this.rechazo(req, tenant.codigo, motivo, { ok: true, ignorado: motivo });
    }

    // 4. La firma: esto es lo que de verdad autentica un webhook público.
    if (impl.verificar) {
      const veredicto = impl.verificar(cuerpo, entrada.firma, this.cred.enClaro(fila));
      if (!veredicto.ok) return this.rechazo(req, tenant.codigo, veredicto.motivo);
    }

    // 5 y 6. Traducir, aplicar y anotar.
    try {
      const r = await this.aplicar(tenant, impl, cuerpo);
      this.bitacora.registrar(req, {
        tenant: tenant.codigo, exitoso: true, estadoHttp: 201,
        // El resumen, no un null: «qué hizo FALCON con esto» es la pregunta
        // que se le hace a esta tabla.
        motivo: r.resumen, llamadaId: r.llamadaId ?? null,
      });
      return r.cuerpo;
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() < 500) {
        return this.rechazo(req, tenant.codigo, `Rechazado al procesar: ${mensajeDe(e)}`);
      }
      this.bitacora.registrar(req, {
        tenant: tenant.codigo, exitoso: false, estadoHttp: 500,
        motivo: `Error inesperado: ${(e as Error)?.message ?? e}`,
      });
      throw e;
    }
  }

  /**
   * Traduce y aplica un aviso ya autenticado.
   *
   * El traductor del proveedor dice QUÉ pasó; aquí se hace y se redacta el
   * resultado — porque el resultado depende de lo que haya en la base, y eso
   * el traductor no lo puede saber: «se cerró» no es lo mismo que «ya estaba
   * cerrada», ni que «no había nada que cerrar».
   */
  async aplicar(
    tenant: Parameters<PbxService['webhook']>[0], impl: ProveedorPbx, cuerpo: CuerpoAviso,
  ): Promise<{ cuerpo: unknown; resumen: string; llamadaId?: string | null }> {
    if (!impl.traducir) {
      return { cuerpo: { ok: true }, resumen: `${impl.descriptor.nombre} no entrega avisos por esta ruta` };
    }
    const t = impl.traducir(cuerpo);

    if (t.accion === 'nada') return { cuerpo: { ok: true }, resumen: t.resumen };

    if (t.accion === 'entrante') {
      const llamada = await this.pbx.webhook(tenant, dtoDe('entrante', t.llamada));
      return { cuerpo: { ok: true }, resumen: t.resumen, llamadaId: llamada?.id ?? null };
    }

    const cierre = await this.pbx.cerrarSiEstaEnCola(tenant, dtoDe('colgada', t.llamada));
    if (cierre?.cambio) {
      return { cuerpo: { ok: true }, resumen: `Colgada (${t.detalle})`, llamadaId: cierre.llamada.id };
    }
    if (cierre) {
      return {
        cuerpo: { ok: true },
        resumen: `Ya estaba cerrada (${cierre.llamada.estado}); este aviso de fin no cambió nada`,
        llamadaId: cierre.llamada.id,
      };
    }
    return {
      cuerpo: { ok: true },
      resumen: t.esSaliente
        ? `Saliente terminada (${t.detalle}); no estaba en la cola, nada que cerrar`
        : `Fin de llamada (${t.detalle}) sin nada que cerrar: `
          + `ninguna llamada con el id ${t.llamada.callId || '(sin id)'}`,
    };
  }

  private rechazo(
    req: PeticionWebhook, tenant: string | null, motivo: string, cuerpo?: unknown,
  ): unknown {
    this.bitacora.registrar(req, { tenant, exitoso: false, estadoHttp: 201, motivo });
    return cuerpo ?? { ok: false, motivo };
  }
}

/** Los hechos del proveedor, en el DTO que valida y entiende `PbxService`. */
function dtoDe(evento: 'entrante' | 'colgada', d: DatosLlamada): WebhookLlamadaDto {
  const dto = new WebhookLlamadaDto();
  dto.evento = evento;
  if (d.callId) dto.callId = d.callId;
  if (d.numero) dto.numero = d.numero;
  if (d.numeroDestino) dto.numeroDestino = d.numeroDestino;
  if (d.extension) dto.extension = d.extension;
  if (d.agente) dto.agente = d.agente;
  if (d.fechaHora) dto.fechaHora = d.fechaHora;
  dto.origen = d.origen ?? 'telefono';
  if (d.atendidaEnPlanta !== undefined) dto.atendidaEnPlanta = d.atendidaEnPlanta;
  return dto;
}

/** El texto de una excepción de Nest, sin el envoltorio. */
function mensajeDe(e: unknown): string {
  if (e instanceof HttpException) {
    const cuerpo = e.getResponse();
    const mensaje = typeof cuerpo === 'string' ? cuerpo : (cuerpo as { message?: unknown })?.message;
    if (Array.isArray(mensaje)) return mensaje.join(' | ');
    if (typeof mensaje === 'string') return mensaje;
  }
  return (e as Error)?.message ?? String(e);
}
