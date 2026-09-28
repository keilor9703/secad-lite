import { ArgumentsHost, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PbxWebhookRechazoFilter } from './webhook-rechazo.filter';

describe('PbxWebhookRechazoFilter', () => {
  let repo: { create: jest.Mock; save: jest.Mock };
  let filter: PbxWebhookRechazoFilter;
  let res: { status: jest.Mock; json: jest.Mock };

  function host(body: unknown, ip = '203.0.113.7'): ArgumentsHost {
    const req = { body, ip, headers: {}, socket: { remoteAddress: ip } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    repo = { create: jest.fn((v) => v), save: jest.fn().mockResolvedValue(undefined) };
    filter = new PbxWebhookRechazoFilter(repo as any);
  });

  it('responde exactamente el mismo cuerpo y estado que la excepción original', () => {
    const exc = new UnauthorizedException('API key inválida.');
    filter.catch(exc, host({ evento: 'entrante', numero: '300' }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(exc.getResponse());
  });

  it('registra motivo, estado, evento, ip y el body recibido, marcado como no exitoso', () => {
    const exc = new UnauthorizedException('API key inválida.');
    filter.catch(exc, host({ evento: 'entrante', numero: '300' }));
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

  it('usa el tenant que PbxService dejó etiquetado en la excepción, cuando lo hay', () => {
    const exc = new BadRequestException('Evento de PBX no reconocido.');
    (exc as BadRequestException & { tenantPbx?: string }).tenantPbx = 'demo';
    filter.catch(exc, host({ evento: 'otro' }));
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'demo' }));
  });

  it('une los mensajes del ValidationPipe (array) en un solo motivo legible', () => {
    const exc = new BadRequestException(['origen debe ser uno de: telefono, whatsapp_chat, whatsapp_llamada.']);
    filter.catch(exc, host({ evento: 'entrante', numero: '300', origen: 'telegram' }));
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
