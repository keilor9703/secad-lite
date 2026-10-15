import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ZadarmaController } from './zadarma.controller';
import { ZadarmaService } from './zadarma.service';
import { TenantsService } from '../../tenants/tenants.service';
import { PbxWebhookLogService } from '../webhook-log.service';
import { ConfigPbxEntity } from '../config-pbx.entity';
import { TenantEntity } from '../../tenants/tenant.entity';
import { cadenaFirmada, firmar } from './zadarma.firma';

/**
 * El webhook de Zadarma, visto desde la puerta.
 *
 * Esta prueba nació de un rato largo a ciegas: colgar la llamada en el
 * softphone no la colgaba en FALCON, y la bitácora del webhook —que existe
 * exactamente para eso— decía «exitoso» de todo, sin motivo, sin tenant, sin
 * el nombre del evento y sin la llamada. La razón: esta ruta responde 200
 * incluso cuando rechaza (Zadarma reintenta lo que no es 200), así que el
 * interceptor de éxito veía el `{ ok: false, motivo }` como un éxito y el
 * filtro de rechazos nunca se enteraba.
 *
 * Así que lo que se protege aquí no es solo que la ruta decida bien: es que
 * DEJE DICHO qué decidió. Una integración que no se puede auditar desde la
 * base se depura con Postman y conjeturas, y eso ya pasó.
 */
describe('ZadarmaController', () => {
  const SECRETO = 'secreto-de-prueba';
  const TENANT = { codigo: 'itagui', nombre: 'Itagüí' } as TenantEntity;

  let ctrl: ZadarmaController;
  let anotaciones: Array<Record<string, unknown>>;
  let procesar: jest.Mock;
  let cfg: Partial<ConfigPbxEntity> | null;
  let tenant: TenantEntity | null;
  let vigente: () => void;

  const peticion = { body: {}, ip: '1.2.3.4', headers: {}, socket: { remoteAddress: '1.2.3.4' } };

  /**
   * Un cuerpo de evento con su firma bien calculada.
   *
   * Cada evento firma campos distintos —los salientes firman
   * `internal + destination + call_start`, no `caller_id + called_did`—, y por
   * eso se usa `cadenaFirmada`, el mismo código que verifica: una firma
   * calculada a mano «como debería ser» ya hizo fallar esta prueba por el
   * motivo equivocado.
   */
  function evento(cuerpo: Record<string, string>) {
    return { cuerpo, firma: firmar(cadenaFirmada(cuerpo) ?? '', SECRETO) };
  }

  beforeEach(() => {
    anotaciones = [];
    tenant = TENANT;
    cfg = { tenant: 'itagui', proveedor: 'ZADARMA', activo: true };
    vigente = () => undefined;
    procesar = jest.fn().mockResolvedValue({
      cuerpo: { ok: true }, resumen: 'Colgada (answered, 94 s)', llamadaId: 'll-7',
    });

    const zadarma = {
      configDe: async () => cfg as ConfigPbxEntity | null,
      secretoDe: () => SECRETO,
      procesar,
    } as unknown as ZadarmaService;
    const tenants = {
      porApiKey: async () => tenant,
      asegurarVigente: () => vigente(),
    } as unknown as TenantsService;
    const bitacora = {
      registrar: (_req: unknown, datos: Record<string, unknown>) => anotaciones.push(datos),
    } as unknown as PbxWebhookLogService;

    ctrl = new ZadarmaController(zadarma, tenants, bitacora);
  });

  const llamar = (e: { cuerpo: Record<string, string>; firma?: string }) =>
    ctrl.webhook({ ...peticion, body: e.cuerpo }, 'llave', e.cuerpo, e.firma);

  describe('el eco del panel', () => {
    it('se devuelve tal cual, sin adornos y sin tocar nada más', async () => {
      // Cualquier comilla, JSON o salto de línea y el panel dice que la URL no
      // es válida, sin explicar por qué.
      const r = await ctrl.webhook(peticion, 'llave', { zd_echo: 'aBc123' });
      expect(r).toBe('aBc123');
      expect(procesar).not.toHaveBeenCalled();
    });

    it('no ensucia la bitácora: no es tráfico de llamadas', async () => {
      await ctrl.webhook(peticion, 'llave', { zd_echo: 'aBc123' });
      expect(anotaciones).toEqual([]);
    });
  });

  describe('lo que se rechaza queda dicho, y con 200 para que no se reintente', () => {
    it('llave desconocida', async () => {
      tenant = null;
      const r = await llamar(evento({ event: 'NOTIFY_START', caller_id: '300', called_did: '601', call_start: 'x' }));
      expect(r).toMatchObject({ ok: false });
      expect(anotaciones[0]).toMatchObject({ exitoso: false, tenant: null });
      expect(String(anotaciones[0].motivo)).toContain('Llave de instancia desconocida');
    });

    it('instancia sin la integración vigente — y el motivo del guard se conserva', async () => {
      vigente = () => { throw new ForbiddenException('La integración de pbx no está habilitada.'); };
      const r = await llamar(evento({ event: 'NOTIFY_START', caller_id: '300', called_did: '601', call_start: 'x' }));
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('no está habilitada');
      expect(anotaciones[0]).toMatchObject({ tenant: 'itagui' });
    });

    it('la instancia no tiene Zadarma', async () => {
      cfg = { tenant: 'itagui', proveedor: 'YACO', activo: true };
      await llamar(evento({ event: 'NOTIFY_START', caller_id: '300', called_did: '601', call_start: 'x' }));
      expect(String(anotaciones[0].motivo)).toContain('no tiene Zadarma');
    });

    it('la planta está apagada: se responde «ignorado», y la bitácora lo dice', async () => {
      // Es el estado más confuso de todos para quien configura: la central
      // manda, FALCON contesta 200 y no pasa nada. Tiene que quedar escrito.
      cfg = { tenant: 'itagui', proveedor: 'ZADARMA', activo: false };
      const r = await llamar(evento({ event: 'NOTIFY_START', caller_id: '300', called_did: '601', call_start: 'x' }));
      expect(r).toMatchObject({ ok: true, ignorado: expect.stringContaining('apagada') });
      expect(anotaciones[0]).toMatchObject({ exitoso: false });
      expect(String(anotaciones[0].motivo)).toContain('apagada');
    });

    it('firma que no cuadra', async () => {
      const r = await llamar({ cuerpo: { event: 'NOTIFY_START', caller_id: '300' }, firma: 'inventada' });
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('firma');
      expect(procesar).not.toHaveBeenCalled();
    });

    it('sin encabezado Signature', async () => {
      const r = await llamar({ cuerpo: { event: 'NOTIFY_START', caller_id: '300' } });
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('Signature');
    });
  });

  describe('lo que se acepta deja escrito QUÉ se hizo', () => {
    it('el resumen y la llamada quedan en la bitácora', async () => {
      // Sin esto, «exitoso = true» no distinguía una llamada encolada de un
      // evento ignorado, y había que adivinar leyendo el cuerpo crudo.
      const r = await llamar(evento({
        event: 'NOTIFY_END', caller_id: '101', called_did: '102', call_start: '2026-10-15 09:12:33',
      }));
      expect(r).toEqual({ ok: true });
      expect(anotaciones[0]).toMatchObject({
        exitoso: true, tenant: 'itagui', motivo: 'Colgada (answered, 94 s)', llamadaId: 'll-7',
      });
    });

    it('un evento que no cambió nada también se anota, con su por qué', async () => {
      procesar.mockResolvedValue({
        cuerpo: { ok: true },
        resumen: 'Saliente 101 → 102 terminada (answered, 12 s); no estaba en la cola, nada que cerrar',
      });
      await llamar(evento({ event: 'NOTIFY_OUT_END', caller_id: '101', called_did: '102', call_start: 'x' }));
      expect(anotaciones[0]).toMatchObject({ exitoso: true, llamadaId: null });
      expect(String(anotaciones[0].motivo)).toContain('nada que cerrar');
    });
  });

  describe('los errores al procesar', () => {
    it('un 4xx es permanente: se anota y se responde 200, sin reintentos eternos', async () => {
      procesar.mockRejectedValue(new NotFoundException('Llamada no encontrada.'));
      const r = await llamar(evento({ event: 'NOTIFY_END', caller_id: '101', called_did: '102', call_start: 'x' }));
      expect(r).toMatchObject({ ok: false });
      expect(String(anotaciones[0].motivo)).toContain('Llamada no encontrada');
    });

    it('un error inesperado SÍ sube: ahí el reintento de Zadarma es lo que hace falta', async () => {
      // Esconder un 500 con un 200 es perder la llamada en silencio.
      procesar.mockRejectedValue(new Error('la base no responde'));
      await expect(llamar(evento({ event: 'NOTIFY_END', caller_id: '101', called_did: '102', call_start: 'x' })))
        .rejects.toThrow('la base no responde');
      expect(anotaciones[0]).toMatchObject({ exitoso: false, estadoHttp: 500 });
    });
  });
});
