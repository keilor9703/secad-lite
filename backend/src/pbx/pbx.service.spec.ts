import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { PbxService, WebhookLlamadaDto } from './pbx.service';
import { LlamadaEntity } from './llamada.entity';
import { CasosService } from '../casos/casos.service';
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

  it('acepta "fechaHora" en ISO 8601 con zona horaria', async () => {
    const errores = await validar({
      evento: 'entrante', numero: '3001234567', fechaHora: '2026-09-28T14:36:26-05:00',
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza "fechaHora" cuando no es una fecha ISO 8601 válida (p. ej. "MMDDAA" + hora aparte)', async () => {
    const errores = await validar({
      evento: 'entrante', numero: '3001234567', fechaHora: '092826',
    });
    expect(errores.some((e) => e.property === 'fechaHora')).toBe(true);
  });

  it('acepta "origen" con uno de los valores válidos', async () => {
    const errores = await validar({
      evento: 'entrante', numero: '3001234567', origen: 'whatsapp_chat',
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza "origen" con un valor que no sea telefono/whatsapp_chat/whatsapp_llamada', async () => {
    const errores = await validar({
      evento: 'entrante', numero: '3001234567', origen: 'telegram',
    });
    expect(errores.some((e) => e.property === 'origen')).toBe(true);
  });
});

describe('PbxService.webhook()', () => {
  let service: PbxService;
  let usuarios: { buscarPorExtension: jest.Mock };
  let llamadasRepo: {
    findOne: jest.Mock; save: jest.Mock; create: jest.Mock; find: jest.Mock;
  };

  // La API key/tenant ya no las resuelve el servicio — las resuelve
  // `PbxApiKeyGuard` antes de llegar aquí (ver pbx-api-key.guard.spec.ts).
  const tenantDemo = { codigo: 'demo', integraciones: ['pbx'] } as any;

  beforeEach(async () => {
    llamadasRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((v) => Promise.resolve({ id: 'llamada-1', ...v })),
      create: jest.fn((v) => v),
      find: jest.fn(),
    };
    usuarios = { buscarPorExtension: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PbxService,
        { provide: CasosService, useValue: {} },
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

  it('lanza BadRequestException si el evento no es entrante ni colgada (defensa adicional, además del DTO)', async () => {
    await expect(service.webhook(tenantDemo, { evento: 'otro' } as unknown as WebhookLlamadaDto))
      .rejects.toThrow(BadRequestException);
  });

  it('registra la llamada entrante y guarda agentePbx cuando la central lo manda', async () => {
    const dto: WebhookLlamadaDto = {
      evento: 'entrante', numero: '3001234567', callId: 'call-1', agente: 'Ana Torres',
    } as WebhookLlamadaDto;
    const llamada = await service.webhook(tenantDemo, dto);
    expect(llamadasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ numero: '3001234567', agentePbx: 'Ana Torres', estado: 'sonando' }),
    );
    expect(llamada).toMatchObject({ agentePbx: 'Ana Torres' });
  });

  it('guarda fechaHoraPbx tal cual la reporta la central, sin usarla para nada más', async () => {
    const dto: WebhookLlamadaDto = {
      evento: 'entrante', numero: '3001234567', callId: 'call-1', fechaHora: '2026-09-28T14:36:26-05:00',
    } as WebhookLlamadaDto;
    const llamada = await service.webhook(tenantDemo, dto);
    expect(llamadasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ fechaHoraPbx: new Date('2026-09-28T14:36:26-05:00') }),
    );
    expect((llamada as LlamadaEntity).fechaHoraPbx).toEqual(new Date('2026-09-28T14:36:26-05:00'));
  });

  it('deja fechaHoraPbx en null si la central no la manda', async () => {
    const dto: WebhookLlamadaDto = { evento: 'entrante', numero: '3001234567' } as WebhookLlamadaDto;
    const llamada = await service.webhook(tenantDemo, dto);
    expect((llamada as LlamadaEntity).fechaHoraPbx).toBeNull();
  });

  it('asume origen "telefono" cuando la central no lo manda (retrocompatible)', async () => {
    const dto: WebhookLlamadaDto = { evento: 'entrante', numero: '3001234567' } as WebhookLlamadaDto;
    const llamada = await service.webhook(tenantDemo, dto);
    expect((llamada as LlamadaEntity).origen).toBe('telefono');
  });

  it('guarda el origen que reporta la central (whatsapp_chat / whatsapp_llamada)', async () => {
    const dto: WebhookLlamadaDto = {
      evento: 'entrante', numero: '3001234567', origen: 'whatsapp_llamada',
    } as WebhookLlamadaDto;
    const llamada = await service.webhook(tenantDemo, dto);
    expect((llamada as LlamadaEntity).origen).toBe('whatsapp_llamada');
  });

  it('no duplica una llamada entrante repetida con el mismo callId todavía sonando (idempotencia)', async () => {
    const existente = { id: 'ya-existe', callId: 'call-1', estado: 'sonando' } as LlamadaEntity;
    llamadasRepo.findOne.mockResolvedValue(existente);
    const resultado = await service.webhook(tenantDemo, { evento: 'entrante', numero: '300', callId: 'call-1' } as WebhookLlamadaDto);
    expect(resultado).toBe(existente);
    expect(llamadasRepo.save).not.toHaveBeenCalled();
  });

  it('en "colgada", actualiza agentePbx si la central lo reporta solo al final de la llamada', async () => {
    const enCurso = { id: 'llamada-1', callId: 'call-2', estado: 'sonando', agentePbx: null } as LlamadaEntity;
    llamadasRepo.findOne.mockResolvedValue(enCurso);
    await service.webhook(tenantDemo, { evento: 'colgada', callId: 'call-2', agente: 'Carlos Ruiz' } as WebhookLlamadaDto);
    expect(llamadasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ agentePbx: 'Carlos Ruiz', estado: 'perdida' }),
    );
  });
});

/**
 * El origen de la llamada (teléfono / chat de WhatsApp / llamada de
 * WhatsApp) fija automáticamente el `canal` del caso que se crea al
 * atender — es lo que hace que el operador no tenga que elegirlo a mano en
 * "Medio de comunicación".
 */
describe('PbxService.atender() — canal según el origen', () => {
  let service: PbxService;
  let casos: { crear: jest.Mock; agregarNota: jest.Mock };
  let llamadasRepo: { findOne: jest.Mock; save: jest.Mock };
  let casosRepo: { findOne: jest.Mock };

  async function atenderConOrigen(origen: string) {
    const llamada = { id: 'llamada-1', numero: '3001234567', estado: 'sonando', destinatario: null, origen } as any;
    llamadasRepo.findOne.mockResolvedValueOnce(llamada); // la propia llamada
    casosRepo.findOne.mockResolvedValueOnce(null); // sin caso abierto del mismo número: crea uno nuevo
    return service.atender('demo', 'llamada-1', { username: 'operador1', supervisor: false });
  }

  beforeEach(async () => {
    casos = {
      crear: jest.fn().mockResolvedValue({ id: 'caso-1' }),
      agregarNota: jest.fn(),
    };
    llamadasRepo = { findOne: jest.fn(), save: jest.fn((v) => Promise.resolve(v)) };
    casosRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PbxService,
        { provide: CasosService, useValue: casos },
        { provide: UsuariosService, useValue: {} },
        {
          provide: TenantRlsService,
          useValue: {
            conTenant: jest.fn((_tenant: string, fn: (m: any) => unknown) =>
              fn({
                getRepository: (entity: any) => (entity?.name === 'CasoEntity' ? casosRepo : llamadasRepo),
                query: jest.fn(),
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<PbxService>(PbxService);
  });

  it('telefono → canal "llamada" (el comportamiento de siempre)', async () => {
    await atenderConOrigen('telefono');
    expect(casos.crear).toHaveBeenCalledWith('demo', expect.objectContaining({ canal: 'llamada' }), 'operador1');
  });

  it('whatsapp_chat → canal "whatsapp"', async () => {
    await atenderConOrigen('whatsapp_chat');
    expect(casos.crear).toHaveBeenCalledWith('demo', expect.objectContaining({ canal: 'whatsapp' }), 'operador1');
  });

  it('whatsapp_llamada → canal "whatsapp_llamada"', async () => {
    await atenderConOrigen('whatsapp_llamada');
    expect(casos.crear).toHaveBeenCalledWith('demo', expect.objectContaining({ canal: 'whatsapp_llamada' }), 'operador1');
  });
});

/**
 * El identificador del llamante, dejado como un abonado marcable.
 *
 * El caso que lo motivó: un operador reportó que al tomar una llamada de
 * WhatsApp el campo "Abonado" de Recepción no se llenaba. Las pasarelas de
 * WhatsApp no manejan números sino JID (`573175882321@s.whatsapp.net`), y si la
 * central los reenvía tal cual, eso es lo que el operador ve: un identificador
 * que no se puede marcar ni cruzar contra los casos del mismo número.
 */
describe('PbxService.normalizarNumero', () => {
  it('recorta el sufijo del JID de WhatsApp', () => {
    expect(PbxService.normalizarNumero('573175882321@s.whatsapp.net')).toBe('573175882321');
    expect(PbxService.normalizarNumero('573001234567@c.us')).toBe('573001234567');
  });

  it('quita los adornos de un número "bonito" de la central', () => {
    expect(PbxService.normalizarNumero('+57 317 588 2321')).toBe('+573175882321');
    expect(PbxService.normalizarNumero('(317) 588-2321')).toBe('3175882321');
    expect(PbxService.normalizarNumero('317.588.2321')).toBe('3175882321');
  });

  it('no toca un número que ya viene limpio', () => {
    expect(PbxService.normalizarNumero('3175882321')).toBe('3175882321');
    expect(PbxService.normalizarNumero('+573175882321')).toBe('+573175882321');
  });

  it('no adivina el indicativo: 57… y 3… son las dos formas legítimas', () => {
    expect(PbxService.normalizarNumero('573175882321')).toBe('573175882321');
    expect(PbxService.normalizarNumero('3175882321')).toBe('3175882321');
  });

  it('el + solo vale al principio', () => {
    expect(PbxService.normalizarNumero('+57+317+5882321')).toBe('+573175882321');
  });

  it('si al limpiar no queda nada marcable, devuelve lo que llegó', () => {
    // Mejor que el operador vea un identificador raro a que vea el campo vacío
    // y no sepa que hubo algo del otro lado.
    expect(PbxService.normalizarNumero('anonimo@c.us')).toBe('anonimo@c.us');
    expect(PbxService.normalizarNumero('privado')).toBe('privado');
  });

  it('NO convierte un identificador de la central en algo que parece un teléfono', () => {
    // Esto es lo que manda de verdad la central para WhatsApp (visto en
    // pbx_webhook_log). Limpiarlo daba `+1744934636794102`: 16 dígitos, un
    // número imposible que el operador marcaría o copiaría al caso. Se deja
    // crudo justamente para que se vea que NO es un número.
    expect(PbxService.normalizarNumero('+CO.1744934636794102')).toBe('+CO.1744934636794102');
  });

  it('un número con cero de salida sí es marcable y se conserva', () => {
    // También visto en producción: la central antepone el prefijo de salida.
    expect(PbxService.normalizarNumero('03133958748')).toBe('03133958748');
  });
});

describe('PbxService.esNumeroMarcable', () => {
  it('acepta lo que es un abonado', () => {
    expect(PbxService.esNumeroMarcable('3175882321')).toBe(true);
    expect(PbxService.esNumeroMarcable('+573175882321')).toBe(true);
    expect(PbxService.esNumeroMarcable('03133958748')).toBe(true);
  });

  it('rechaza lo que no cabe en un plan de numeración', () => {
    // E.164: 15 dígitos como máximo.
    expect(PbxService.esNumeroMarcable('+CO.1744934636794102')).toBe(false);
    expect(PbxService.esNumeroMarcable('1744934636794102')).toBe(false);
    expect(PbxService.esNumeroMarcable('12345')).toBe(false);
    expect(PbxService.esNumeroMarcable('')).toBe(false);
  });
});
