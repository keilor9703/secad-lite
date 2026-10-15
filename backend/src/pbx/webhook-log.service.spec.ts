import { PbxWebhookLogService } from './webhook-log.service';

/**
 * La bitácora del webhook.
 *
 * Lo que se protege aquí es que la tabla sirva para contestar la pregunta por
 * la que existe: «la central dice que lo mandó, ¿llegó, y qué se hizo?».
 * Mientras leyó solo `evento` del body, TODA petición de Zadarma —que manda
 * `event`— quedó con esa columna en null, y una llamada que no se colgaba era
 * indistinguible de una firma rechazada.
 */
describe('PbxWebhookLogService', () => {
  let repo: { create: jest.Mock; save: jest.Mock };
  let bitacora: PbxWebhookLogService;

  const peticion = (body: unknown) => ({
    body, ip: '203.0.113.7', headers: {}, socket: { remoteAddress: '203.0.113.7' },
  });

  const guardado = () => repo.save.mock.calls[0][0] as Record<string, unknown>;

  beforeEach(() => {
    repo = { create: jest.fn((v) => v), save: jest.fn().mockResolvedValue(undefined) };
    bitacora = new PbxWebhookLogService(repo as never);
  });

  it('anota el `evento` del webhook genérico', () => {
    bitacora.registrar(peticion({ evento: 'colgada', callId: 'c1' }), { exitoso: true, estadoHttp: 201 });
    expect(guardado().evento).toBe('colgada');
  });

  it('y el `event` de Zadarma, que es el que se perdía', () => {
    bitacora.registrar(peticion({ event: 'NOTIFY_OUT_END', pbx_call_id: 'in-1' }), { exitoso: true, estadoHttp: 201 });
    expect(guardado().evento).toBe('NOTIFY_OUT_END');
  });

  it('un nombre de evento más largo que la columna no tumba el registro', () => {
    // La columna admite 20 caracteres. Un evento nuevo de Zadarma más largo
    // haría fallar el INSERT entero, y se perdería la fila completa — que es
    // justo la que haría falta para entender el evento nuevo.
    bitacora.registrar(peticion({ event: 'SPEECH_RECOGNITION_V2_LARGO' }), { exitoso: true, estadoHttp: 201 });
    expect(String(guardado().evento).length).toBeLessThanOrEqual(20);
  });

  it('el motivo es lo que se hizo, no solo lo que falló', () => {
    bitacora.registrar(peticion({ event: 'NOTIFY_END' }), {
      exitoso: true, estadoHttp: 201, motivo: 'Colgada (answered, 94 s)', llamadaId: 'll-1', tenant: 'itagui',
    });
    expect(guardado()).toMatchObject({
      exitoso: true, motivo: 'Colgada (answered, 94 s)', llamadaId: 'll-1', tenant: 'itagui',
    });
  });

  it('guarda el cuerpo recortado, nunca entero', () => {
    bitacora.registrar(peticion({ event: 'NOTIFY_END', basura: 'x'.repeat(5000) }), { exitoso: true, estadoHttp: 201 });
    expect(String(guardado().cuerpo).length).toBe(2000);
  });

  it('sin cuerpo no inventa nada', () => {
    bitacora.registrar(peticion(undefined), { exitoso: false, estadoHttp: 201, motivo: 'firma mala' });
    expect(guardado()).toMatchObject({ cuerpo: null, evento: null });
  });

  it('si la base no responde, el registro se pierde pero la llamada no', () => {
    // Antes que perder una llamada por no poder anotarla, se pierde la nota.
    repo.save.mockRejectedValue(new Error('la base no responde'));
    expect(() => bitacora.registrar(peticion({ event: 'NOTIFY_START' }), { exitoso: true, estadoHttp: 201 }))
      .not.toThrow();
  });
});
