import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PbxService, WebhookLlamadaDto } from './pbx.service';
import { LlamadaEntity } from './llamada.entity';
import { CasosService } from '../casos/casos.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { TenantRlsService } from '../common/tenant-rls.service';

/**
 * El bug real que motivó estas pruebas: WebhookLlamadaDto era una
 * `interface`, así que el ValidationPipe global (que solo valida contra
 * clases con decoradores) la trataba como `Object` y dejaba pasar el body
 * TAL CUAL, sin validar nada — un JSON mal formado (o un Content-Type que no
 * fuera application/json, el error típico al probar desde Postman) llegaba
 * vacío y el único aviso era "Evento de PBX no reconocido", sin decir por
 * qué. Se verifica aquí que, ya como clase, el pipe SÍ detecta cada caso.
 */
describe('WebhookLlamadaDto — validación', () => {
  async function validar(payload: Record<string, unknown>) {
    const dto = plainToInstance(WebhookLlamadaDto, payload);
    return validate(dto);
  }

  it('rechaza un body vacío (el síntoma exacto de un Content-Type mal puesto en Postman)', async () => {
    const errores = await validar({});
    expect(errores.some((e) => e.property === 'evento')).toBe(true);
  });

  it('rechaza un evento que no sea "entrante" ni "colgada"', async () => {
    const errores = await validar({ evento: 'timbrando', numero: '3001234567' });
    expect(errores.some((e) => e.property === 'evento')).toBe(true);
  });

  it('exige "numero" cuando el evento es "entrante"', async () => {
    const errores = await validar({ evento: 'entrante' });
    expect(errores.some((e) => e.property === 'numero')).toBe(true);
  });

  it('NO exige "numero" cuando el evento es "colgada"', async () => {
    const errores = await validar({ evento: 'colgada', callId: 'abc' });
    expect(errores.some((e) => e.property === 'numero')).toBe(false);
  });

  it('acepta un payload completo, incluido el nuevo campo "agente"', async () => {
    const errores = await validar({
      evento: 'entrante', numero: '3001234567', callId: 'c1',
      numeroDestino: '6011234', extension: '105', agente: 'Juan Pérez',
    });
    expect(errores).toHaveLength(0);
  });
});

describe('PbxService.webhook()', () => {
  let service: PbxService;
  let tenants: { porApiKey: jest.Mock; asegurarVigente: jest.Mock };
  let usuarios: { buscarPorExtension: jest.Mock };
  let llamadasRepo: {
    findOne: jest.Mock; save: jest.Mock; create: jest.Mock; find: jest.Mock;
  };

  const tenantDemo = { codigo: 'demo', integraciones: ['pbx'] } as any;

  beforeEach(async () => {
    llamadasRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((v) => Promise.resolve({ id: 'llamada-1', ...v })),
      create: jest.fn((v) => v),
      find: jest.fn(),
    };
    tenants = {
      porApiKey: jest.fn().mockResolvedValue(tenantDemo),
      asegurarVigente: jest.fn(),
    };
    usuarios = { buscarPorExtension: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PbxService,
        { provide: CasosService, useValue: {} },
        { provide: TenantsService, useValue: tenants },
        { provide: UsuariosService, useValue: usuarios },
        {
          provide: TenantRlsService,
          useValue: {
            conTenant: jest.fn((_tenant: string, fn: (m: any) => unknown) =>
              fn({ getRepository: () => llamadasRepo, query: jest.fn() }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<PbxService>(PbxService);
  });

  it('lanza UnauthorizedException si la API key no resuelve a ningún tenant', async () => {
    tenants.porApiKey.mockResolvedValue(null);
    await expect(service.webhook('clave-invalida', { evento: 'entrante', numero: '300' } as WebhookLlamadaDto))
      .rejects.toThrow(UnauthorizedException);
  });

  it('lanza ForbiddenException si el tenant no tiene la integración pbx vigente', async () => {
    tenants.asegurarVigente.mockImplementation(() => { throw new ForbiddenException('El módulo de pbx no está habilitado para esta instancia.'); });
    await expect(service.webhook('clave-ok', { evento: 'entrante', numero: '300' } as WebhookLlamadaDto))
      .rejects.toThrow(ForbiddenException);
  });

  it('lanza BadRequestException si el evento no es entrante ni colgada (defensa adicional, además del DTO)', async () => {
    await expect(service.webhook('clave-ok', { evento: 'otro' } as unknown as WebhookLlamadaDto))
      .rejects.toThrow(BadRequestException);
  });

  it('registra la llamada entrante y guarda agentePbx cuando la central lo manda', async () => {
    const dto: WebhookLlamadaDto = {
      evento: 'entrante', numero: '3001234567', callId: 'call-1', agente: 'Ana Torres',
    } as WebhookLlamadaDto;
    const llamada = await service.webhook('clave-ok', dto);
    expect(llamadasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ numero: '3001234567', agentePbx: 'Ana Torres', estado: 'sonando' }),
    );
    expect(llamada).toMatchObject({ agentePbx: 'Ana Torres' });
  });

  it('no duplica una llamada entrante repetida con el mismo callId todavía sonando (idempotencia)', async () => {
    const existente = { id: 'ya-existe', callId: 'call-1', estado: 'sonando' } as LlamadaEntity;
    llamadasRepo.findOne.mockResolvedValue(existente);
    const resultado = await service.webhook('clave-ok', { evento: 'entrante', numero: '300', callId: 'call-1' } as WebhookLlamadaDto);
    expect(resultado).toBe(existente);
    expect(llamadasRepo.save).not.toHaveBeenCalled();
  });

  it('en "colgada", actualiza agentePbx si la central lo reporta solo al final de la llamada', async () => {
    const enCurso = { id: 'llamada-1', callId: 'call-2', estado: 'sonando', agentePbx: null } as LlamadaEntity;
    llamadasRepo.findOne.mockResolvedValue(enCurso);
    await service.webhook('clave-ok', { evento: 'colgada', callId: 'call-2', agente: 'Carlos Ruiz' } as WebhookLlamadaDto);
    expect(llamadasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ agentePbx: 'Carlos Ruiz', estado: 'perdida' }),
    );
  });
});
