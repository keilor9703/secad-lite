import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { PbxWebhookExitoInterceptor } from './webhook-exito.interceptor';
import { LlamadaEntity } from './llamada.entity';

describe('PbxWebhookExitoInterceptor', () => {
  let repo: { create: jest.Mock; save: jest.Mock };
  let interceptor: PbxWebhookExitoInterceptor;

  function contextoCon(body: unknown, ip = '203.0.113.7'): ExecutionContext {
    const req = { body, ip, headers: {}, socket: { remoteAddress: ip } };
    return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  }

  function handlerQueDevuelve(llamada: Partial<LlamadaEntity>): CallHandler {
    return { handle: () => of(llamada) };
  }

  beforeEach(() => {
    repo = { create: jest.fn((v) => v), save: jest.fn().mockResolvedValue(undefined) };
    interceptor = new PbxWebhookExitoInterceptor(repo as any);
  });

  it('deja pasar la respuesta del controlador sin tocarla', (done) => {
    const llamada = { id: 'llamada-1', tenant: 'demo' } as LlamadaEntity;
    interceptor
      .intercept(contextoCon({ evento: 'entrante', numero: '300' }), handlerQueDevuelve(llamada))
      .subscribe((resultado) => {
        expect(resultado).toBe(llamada);
        done();
      });
  });

  it('registra la petición como exitosa, con el tenant y la llamada resultante', (done) => {
    const llamada = { id: 'llamada-1', tenant: 'demo' } as LlamadaEntity;
    interceptor
      .intercept(contextoCon({ evento: 'entrante', numero: '3001234567' }), handlerQueDevuelve(llamada))
      .subscribe(() => {
        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            exitoso: true,
            estadoHttp: 201,
            evento: 'entrante',
            motivo: null,
            tenant: 'demo',
            llamadaId: 'llamada-1',
            ip: '203.0.113.7',
            cuerpo: JSON.stringify({ evento: 'entrante', numero: '3001234567' }),
          }),
        );
        done();
      });
  });

  it('nunca revienta la respuesta si falla el guardado del registro', (done) => {
    repo.save.mockRejectedValue(new Error('la base no responde'));
    const llamada = { id: 'llamada-1', tenant: 'demo' } as LlamadaEntity;
    interceptor
      .intercept(contextoCon({ evento: 'colgada' }), handlerQueDevuelve(llamada))
      .subscribe((resultado) => {
        expect(resultado).toBe(llamada);
        done();
      });
  });
});
