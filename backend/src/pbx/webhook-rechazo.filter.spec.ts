import { ArgumentsHost, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PbxWebhookRechazoFilter } from './webhook-rechazo.filter';
import { PeticionPbx } from './pbx-api-key.guard';

/** El guardado pasa por un `await` sin bloquear la respuesta; deja correr los microtasks pendientes. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('PbxWebhookRechazoFilter', () => {
  let repo: { create: jest.Mock; save: jest.Mock };
  let filter: PbxWebhookRechazoFilter;
  let res: { status: jest.Mock; json: jest.Mock };

  function host(body: unknown, opciones?: { ip?: string; pbxTenant?: { codigo: string } }): ArgumentsHost {
    const ip = opciones?.ip ?? '203.0.113.7';
    const req: PeticionPbx = { body, ip, headers: {}, socket: { remoteAddress: ip }, pbxTenant: opciones?.pbxTenant as any } as any;
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    repo = { create: jest.fn((v) => v), save: jest.fn().mockResolvedValue(undefined) };
    filter = new PbxWebhookRechazoFilter(repo as any);
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

  it('usa el tenant que PbxApiKeyGuard ya dejó resuelto en req.pbxTenant, cuando lo hay', async () => {
    const exc = new BadRequestException(['numero es obligatorio cuando evento es "entrante".']);
    filter.catch(exc, host({ evento: 'entrante', extension: '103' }, { pbxTenant: { codigo: 'demo' } }));
    await flush();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'demo' }));
  });

  it('si la API key falló, nunca hubo tenant que resolver: el registro queda con tenant null', async () => {
    const exc = new UnauthorizedException('API key inválida.');
    filter.catch(exc, host({ evento: 'entrante' }));
    await flush();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant: null }));
  });

  it('une los mensajes del ValidationPipe (array) en un solo motivo legible', async () => {
    const exc = new BadRequestException(['origen debe ser uno de: telefono, whatsapp_chat, whatsapp_llamada.']);
    filter.catch(exc, host({ evento: 'entrante', numero: '300', origen: 'telegram' }, { pbxTenant: { codigo: 'demo' } }));
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
