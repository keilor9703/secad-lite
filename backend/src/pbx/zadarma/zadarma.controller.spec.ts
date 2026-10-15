import { ZadarmaController } from './zadarma.controller';
import { AvisosPbxService } from '../avisos.service';

/**
 * La puerta de Zadarma: solo su saludo.
 *
 * Todo lo demás —instancia, encendido, firma, traducción, cola, bitácora— es
 * de `AvisosPbxService` y se prueba allí. Aquí se protege lo único que es de
 * Zadarma y que no se puede equivocar: el eco del panel.
 */
describe('ZadarmaController', () => {
  let recibidos: Array<Record<string, unknown>>;
  let ctrl: ZadarmaController;
  const peticion = { body: {}, ip: '1.2.3.4', headers: {}, socket: { remoteAddress: '1.2.3.4' } };

  beforeEach(() => {
    recibidos = [];
    const avisos = {
      recibir: async (e: Record<string, unknown>) => { recibidos.push(e); return { ok: true }; },
    } as unknown as AvisosPbxService;
    ctrl = new ZadarmaController(avisos);
  });

  describe('la validación del panel', () => {
    it('devuelve el eco tal cual por GET', () => {
      // Cualquier comilla, JSON o salto de línea y el panel dice que la URL no
      // es válida, sin explicar por qué.
      expect(ctrl.verificarUrl('aBc123')).toBe('aBc123');
    });

    it('y también por POST, porque el panel ha usado las dos', async () => {
      const r = await ctrl.webhook(peticion, 'llave', { zd_echo: 'aBc123' });
      expect(r).toBe('aBc123');
    });

    it('el eco no se procesa como aviso: no trae firma ni evento', async () => {
      await ctrl.webhook(peticion, 'llave', { zd_echo: 'aBc123' });
      expect(recibidos).toEqual([]);
    });

    it('sin eco, una señal de vida que no revela si la llave es correcta', () => {
      expect(ctrl.verificarUrl()).toContain('FALCON');
    });
  });

  it('un evento se entrega al camino común, diciendo de qué proveedor es', async () => {
    const cuerpo = { event: 'NOTIFY_START', caller_id: '300' };
    await ctrl.webhook(peticion, 'LLAVE-X', cuerpo, 'firma-x');

    expect(recibidos[0]).toMatchObject({
      proveedor: 'ZADARMA', clave: 'LLAVE-X', cuerpo, firma: 'firma-x',
    });
  });
});
