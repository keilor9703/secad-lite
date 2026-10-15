import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AvisosPbxService } from './avisos.service';
import { PbxService, WebhookLlamadaDto } from './pbx.service';
import { TenantsService } from '../tenants/tenants.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { PbxWebhookLogService } from './webhook-log.service';
import { ConfigPbxEntity } from './config-pbx.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { LlamadaEntity } from './llamada.entity';
import { cadenaFirmada, firmar } from './zadarma/zadarma.firma';

/**
 * EL CAMINO DE UN AVISO, DE CUALQUIER PLANTA.
 *
 * Esta prueba nació de un rato largo a ciegas: colgar la llamada en el
 * softphone no la colgaba en FALCON, y la bitácora del webhook —que existe
 * exactamente para eso— decía «exitoso» de todo, sin motivo, sin instancia,
 * sin el nombre del evento y sin la llamada.
 *
 * Así que lo que se protege aquí no es solo que el camino decida bien: es que
 * DEJE DICHO qué decidió. Una integración que no se puede auditar desde la
 * base se depura con Postman y conjeturas, y eso ya pasó.
 *
 * Se ejercita con Zadarma porque es el proveedor que hay, pero nada de lo que
 * se comprueba es suyo: son las reglas del puerto.
 */
describe('AvisosPbxService', () => {
  const SECRETO = 'secreto-de-prueba';
  const TENANT = { codigo: 'itagui', nombre: 'Itagüí' } as TenantEntity;

  let svc: AvisosPbxService;
  let anotaciones: Array<Record<string, unknown>>;
  let enviados: WebhookLlamadaDto[];
  /** Las llamadas que «existen» en la base, por callId. */
  let enBase: Map<string, { id: string; estado: string }>;
  let cerradas: Set<string>;
  let fila: Partial<ConfigPbxEntity> | null;
  let tenant: TenantEntity | null;
  let vigente: () => void;

  const peticion = { body: {}, ip: '1.2.3.4', headers: {}, socket: { remoteAddress: '1.2.3.4' } };

  beforeEach(() => {
    anotaciones = [];
    enviados = [];
    enBase = new Map();
    cerradas = new Set();
    tenant = TENANT;
    fila = { tenant: 'itagui', proveedor: 'ZADARMA', activo: true };
    vigente = () => undefined;

    const pbx = {
      webhook: async (_t: TenantEntity, dto: WebhookLlamadaDto) => {
        enviados.push(dto);
        const ll = enBase.get(dto.callId ?? '') ?? { id: `ll-${enviados.length}`, estado: 'sonando' };
        if (dto.callId) enBase.set(dto.callId, ll);
        return ll as LlamadaEntity;
      },
      // Como el de verdad: null cuando no hay nada que cerrar, y la fila SIGUE
      // existiendo después de cerrada (`cambio: false`). Un doble que la
      // borraba hizo pasar una prueba que la realidad desmintió.
      cerrarSiEstaEnCola: async (_t: TenantEntity, dto: WebhookLlamadaDto) => {
        enviados.push(dto);
        const ll = enBase.get(dto.callId ?? '');
        if (!ll) return null;
        const cambio = !cerradas.has(dto.callId ?? '');
        if (cambio) ll.estado = dto.atendidaEnPlanta ? 'finalizada' : 'perdida';
        cerradas.add(dto.callId ?? '');
        return { llamada: ll as LlamadaEntity, cambio };
      },
    } as unknown as PbxService;

    const tenants = {
      porApiKey: async () => tenant,
      asegurarVigente: () => vigente(),
    } as unknown as TenantsService;

    const cred = {
      configDe: async () => fila as ConfigPbxEntity | null,
      claveProveedor: () => fila?.proveedor ?? 'YACO',
      enClaro: () => ({ secreto: SECRETO }),
    } as unknown as PbxCredencialesService;

    const bitacora = {
      registrar: (_r: unknown, d: Record<string, unknown>) => anotaciones.push(d),
    } as unknown as PbxWebhookLogService;

    svc = new AvisosPbxService(pbx, tenants, cred, bitacora);
  });

  /** Un aviso con su firma bien calculada (cada evento firma campos distintos). */
  function aviso(cuerpo: Record<string, string>) {
    return svc.recibir({
      proveedor: 'ZADARMA',
      clave: 'llave',
      cuerpo,
      firma: firmar(cadenaFirmada(cuerpo) ?? '', SECRETO),
      req: { ...peticion, body: cuerpo },
    });
  }

  const INTERNA = {
    caller_id: '101', called_did: '102', call_start: '2026-10-15 15:50:00',
    pbx_call_id: 'in-1', internal: '102',
  };
  const FIN_SALIENTE = {
    event: 'NOTIFY_OUT_END', internal: '101', destination: '102',
    call_start: '2026-10-15 15:50:00', pbx_call_id: 'in-1',
    disposition: 'answered', duration: '37',
  };

  describe('lo que se rechaza queda dicho, y con 200 para que no se reintente', () => {
    it('un proveedor que no está en el registro', async () => {
      const r = await svc.recibir({ proveedor: 'TWILIO', clave: 'x', cuerpo: {}, req: peticion });
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('no reconocido');
    });

    it('llave de instancia desconocida', async () => {
      tenant = null;
      const r = await aviso({ event: 'NOTIFY_START', ...INTERNA });
      expect(r).toMatchObject({ ok: false });
      expect(anotaciones[0]).toMatchObject({ exitoso: false, tenant: null });
      expect(String(anotaciones[0].motivo)).toContain('Llave de instancia desconocida');
    });

    it('instancia sin la integración vigente — y el motivo del guard se conserva', async () => {
      vigente = () => { throw new ForbiddenException('La integración de pbx no está habilitada.'); };
      const r = await aviso({ event: 'NOTIFY_START', ...INTERNA });
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('no está habilitada');
      expect(anotaciones[0]).toMatchObject({ tenant: 'itagui' });
    });

    it('la instancia usa OTRA planta: el aviso no es suyo', async () => {
      fila = { tenant: 'itagui', proveedor: 'YACO', activo: true };
      await aviso({ event: 'NOTIFY_START', ...INTERNA });
      expect(String(anotaciones[0].motivo)).toContain('no tiene Zadarma');
    });

    it('la planta está apagada: se responde «ignorado», y la bitácora lo dice', async () => {
      // Es el estado más confuso para quien configura: la central manda,
      // FALCON contesta 200 y no pasa nada. Tiene que quedar escrito.
      fila = { tenant: 'itagui', proveedor: 'ZADARMA', activo: false };
      const r = await aviso({ event: 'NOTIFY_START', ...INTERNA });
      expect(r).toMatchObject({ ok: true, ignorado: expect.stringContaining('apagada') });
      expect(anotaciones[0]).toMatchObject({ exitoso: false });
    });

    it('firma que no cuadra, y nada llega a la cola', async () => {
      const r = await svc.recibir({
        proveedor: 'ZADARMA', clave: 'llave', firma: 'inventada',
        cuerpo: { event: 'NOTIFY_START', ...INTERNA }, req: peticion,
      });
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('firma');
      expect(enviados).toEqual([]);
    });

    it('sin encabezado de firma, tampoco', async () => {
      const r = await svc.recibir({
        proveedor: 'ZADARMA', clave: 'llave',
        cuerpo: { event: 'NOTIFY_START', ...INTERNA }, req: peticion,
      });
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('Signature');
    });
  });

  describe('una llamada entre extensiones, de principio a fin', () => {
    it('entra a la cola, se asigna y se cierra con el fin de la SALIENTE', async () => {
      // El bug que originó todo esto: el fin llegaba como saliente y se
      // ignoraba, así que la llamada seguía timbrando para siempre.
      await aviso({ event: 'NOTIFY_INTERNAL', ...INTERNA });
      await aviso({ event: 'NOTIFY_ANSWER', caller_id: '101', destination: '102', call_start: INTERNA.call_start, pbx_call_id: 'in-1', internal: '102' });
      await aviso(FIN_SALIENTE);

      expect(enviados.map((d) => d.evento)).toEqual(['entrante', 'entrante', 'colgada']);
      expect(enBase.get('in-1')).toMatchObject({ estado: 'finalizada' });
      expect(String(anotaciones[2].motivo)).toContain('Colgada');
      expect(anotaciones[2]).toMatchObject({ exitoso: true, llamadaId: 'll-1' });
    });

    it('el fin repetido lo dice, en vez de anotar la llamada colgada dos veces', async () => {
      // La central cuenta el final dos veces (la pata interna y la saliente).
      // Dos «Colgada» seguidas por la misma llamada se leen como dos cosas que
      // pasaron, y mandan a buscar un problema que no existe.
      await aviso({ event: 'NOTIFY_INTERNAL', ...INTERNA });
      await aviso(FIN_SALIENTE);
      await aviso({ event: 'NOTIFY_INTERNAL_END', ...INTERNA, disposition: 'answered', duration: '37' });

      expect(String(anotaciones[1].motivo)).toContain('Colgada (');
      expect(String(anotaciones[2].motivo)).toContain('Ya estaba cerrada');
    });

    it('una saliente de VERDAD no cierra nada, y lo dice', async () => {
      // Nunca creó fila, así que no hay nada que cerrar. Tratarlo como un
      // `colgada` cualquiera respondería 404, y las centrales reintentan 404.
      const r = await aviso({
        event: 'NOTIFY_OUT_END', internal: '101', destination: '573009999999',
        call_start: '2026-10-15 16:00:00', pbx_call_id: 'out-9', disposition: 'answered', duration: '12',
      });

      expect(r).toEqual({ ok: true });
      expect(anotaciones[0]).toMatchObject({ exitoso: true, llamadaId: null });
      expect(String(anotaciones[0].motivo)).toContain('nada que cerrar');
    });

    it('un fin de una llamada que FALCON nunca vio nombra el id que buscó', async () => {
      await aviso({ event: 'NOTIFY_END', ...INTERNA, pbx_call_id: 'fantasma', disposition: 'no answer', duration: '0' });
      expect(String(anotaciones[0].motivo)).toContain('fantasma');
    });

    it('una entrante sin contestar queda perdida', async () => {
      await aviso({ event: 'NOTIFY_START', caller_id: '573001234567', called_did: '576012345678', call_start: 'x', pbx_call_id: 'in-2' });
      await aviso({ event: 'NOTIFY_END', caller_id: '573001234567', called_did: '576012345678', call_start: 'x', pbx_call_id: 'in-2', disposition: 'no answer', duration: '0' });

      expect(enBase.get('in-2')).toMatchObject({ estado: 'perdida' });
    });
  });

  describe('los errores al procesar', () => {
    /** El mismo camino, pero con una base que falla al aplicar. */
    function conBaseQueFalla(e: Error): AvisosPbxService {
      const pbx = {
        webhook: () => Promise.reject(e),
        cerrarSiEstaEnCola: () => Promise.reject(e),
      } as unknown as PbxService;
      return new AvisosPbxService(
        pbx,
        { porApiKey: async () => TENANT, asegurarVigente: () => undefined } as unknown as TenantsService,
        {
          configDe: async () => fila as ConfigPbxEntity,
          claveProveedor: () => 'ZADARMA',
          enClaro: () => ({ secreto: SECRETO }),
        } as unknown as PbxCredencialesService,
        { registrar: (_r: unknown, d: Record<string, unknown>) => anotaciones.push(d) } as unknown as PbxWebhookLogService,
      );
    }

    const enviarA = (s: AvisosPbxService, cuerpo: Record<string, string>) => s.recibir({
      proveedor: 'ZADARMA', clave: 'llave', cuerpo,
      firma: firmar(cadenaFirmada(cuerpo) ?? '', SECRETO),
      req: { ...peticion, body: cuerpo },
    });

    it('un 4xx es permanente: se anota y se responde 200, sin reintentos eternos', async () => {
      const r = await enviarA(conBaseQueFalla(new NotFoundException('Llamada no encontrada.')), FIN_SALIENTE);

      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('Llamada no encontrada');
    });

    it('un error inesperado SÍ sube: ahí el reintento es lo que hace falta', async () => {
      // Esconder un 500 con un 200 es perder la llamada en silencio.
      await expect(enviarA(conBaseQueFalla(new Error('la base no responde')), FIN_SALIENTE))
        .rejects.toThrow('la base no responde');
      expect(anotaciones[0]).toMatchObject({ exitoso: false, estadoHttp: 500 });
    });
  });
});
