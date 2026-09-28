import { ArgumentsHost, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PbxWebhookRechazoFilter } from './webhook-rechazo.filter';

/** El registro pasa por un `await` (puede resolver el tenant contra la base); deja correr los microtasks pendientes. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('PbxWebhookRechazoFilter', () => {
  let repo: { create: jest.Mock; save: jest.Mock };
  let tenants: { porApiKey: jest.Mock };
  let filter: PbxWebhookRechazoFilter;
  let res: { status: jest.Mock; json: jest.Mock };

  function host(body: unknown, opciones?: { ip?: string; apiKey?: string }): ArgumentsHost {
    const ip = opciones?.ip ?? '203.0.113.7';
    const headers: Record<string, string> = {};
    if (opciones?.apiKey) headers['x-api-key'] = opciones.apiKey;
    const req = { body, ip, headers, socket: { remoteAddress: ip } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    repo = { create: jest.fn((v) => v), save: jest.fn().mockResolvedValue(undefined) };
    tenants = { porApiKey: jest.fn().mockResolvedValue(null) };
    filter = new PbxWebhookRechazoFilter(repo as any, tenants as any);
  });

  it('responde exactamente el mismo cuerpo y estado que la excepción original, sin esperar al registro', () => {
    const exc = new UnauthorizedException('API key inválida.');
    filter.catch(exc, host({ evento: 'entrante', numero: '300' }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(exc.getResponse());
  });

  it('registra motivo, estado, evento, ip y el body recibido, marcado como no exitoso', async () => {
    const exc = new UnauthorizedException('API key inválida.');
    filter.catch(exc, host({ evento: 'entrante', numero: '300' }));
    await flush();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        exitoso: false,
        estadoHttp: 401,
        evento: 'entrante',
        motivo: 'API key inválida.',
        ip: '203.0.113.7',
        cuerpo: JSON.stringify({ evento: 'entrante', numero: '300' }),
        tenant: null,
      }),
    );
  });

  it('usa el tenant que PbxService dejó etiquetado en la excepción, cuando lo hay', async () => {
    const exc = new BadRequestException('Evento de PBX no reconocido.');
    (exc as BadRequestException & { tenantPbx?: string }).tenantPbx = 'demo';
    filter.catch(exc, host({ evento: 'otro' }));
    await flush();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'demo' }));
    expect(tenants.porApiKey).not.toHaveBeenCalled();
  });

  it('un body mal formado lo rechaza el ValidationPipe antes de que PbxService mire la API key: el filtro la resuelve él mismo con el header', async () => {
    const exc = new BadRequestException(['numero es obligatorio cuando evento es "entrante".']);
    tenants.porApiKey.mockResolvedValue({ codigo: 'demo' });
    filter.catch(exc, host({ evento: 'entrante', extension: '103' }, { apiKey: 'fk_valida' }));
    await flush();
    expect(tenants.porApiKey).toHaveBeenCalledWith('fk_valida');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'demo' }));
  });

  it('si la API key del header tampoco resuelve ningún tenant, el registro queda con tenant null (no revienta)', async () => {
    const exc = new BadRequestException(['numero es obligatorio cuando evento es "entrante".']);
    tenants.porApiKey.mockResolvedValue(null);
    filter.catch(exc, host({ evento: 'entrante' }, { apiKey: 'no-existe' }));
    await flush();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant: null }));
  });

  it('une los mensajes del ValidationPipe (array) en un solo motivo legible', async () => {
    const exc = new BadRequestException(['origen debe ser uno de: telefono, whatsapp_chat, whatsapp_llamada.']);
    filter.catch(exc, host({ evento: 'entrante', numero: '300', origen: 'telegram' }));
    await flush();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'origen debe ser uno de: telefono, whatsapp_chat, whatsapp_llamada.' }),
    );
  });

  it('nunca revienta la respuesta al webhook si falla el guardado del registro', () => {
    repo.save.mockRejectedValue(new Error('la base no responde'));
    const exc = new UnauthorizedException('API key inválida.');
    expect(() => filter.catch(exc, host({}))).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
