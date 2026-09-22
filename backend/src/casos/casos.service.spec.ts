import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CasosService } from './casos.service';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity } from './evento.entity';
import { MensajeChatInternoEntity } from './chat-interno.entity';
import { DespachoService } from '../despacho/despacho.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { CasoCanalService } from './caso-canal.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Actor } from './casos.service';

const mockRepo = () => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  createQueryBuilder: jest.fn(),
  manager: { transaction: jest.fn() },
});

const actor: Actor = {
  sub: 'operador1',
  rol: 'operador',
  permisos: ['casos.ver', 'casos.crear', 'casos.gestionar'],
  canales: ['canal-uuid-1'],
};

const actorSupervisor: Actor = {
  sub: 'supervisor1',
  rol: 'supervisor',
  permisos: ['casos.ver', 'casos.ver_todos', 'casos.cerrar', 'casos.reabrir'],
  canales: [],
  agencia: 'agencia-uuid-1',
};

describe('CasosService', () => {
  let service: CasosService;
  let repo: ReturnType<typeof mockRepo>;
  let eventosRepo: ReturnType<typeof mockRepo>;
  let chatRepo: ReturnType<typeof mockRepo>;
  // Capturados por el mock de TenantRlsService.conTenant (ver abajo): se
  // declaran antes porque los providers se arman antes de tener `repo`/`eventosRepo`.
  let repoRef: ReturnType<typeof mockRepo>;
  let eventosRepoRef: ReturnType<typeof mockRepo>;
  let chatRepoRef: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasosService,
        { provide: getRepositoryToken(CasoEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(EventoCasoEntity), useFactory: mockRepo },
        { provide: DespachoService, useValue: { liberarCaso: jest.fn() } },
        // Sin filas por canal: estos casos de prueba no pasan por bandeja de
        // agencia, así que el macro-estado se comporta como el estado único de
        // siempre (ver CasoCanalService.sincronizarMacro con lista vacía).
        { provide: CasoCanalService, useValue: {
          abrir: jest.fn(),
          retirar: jest.fn(),
          fila: jest.fn().mockResolvedValue(null),
          filas: jest.fn().mockResolvedValue([]),
          avanzarAgencia: jest.fn(),
          sincronizarMacro: jest.fn().mockResolvedValue(null),
        }},
        { provide: CatalogosService, useValue: {
          listarCodigos: jest.fn().mockResolvedValue([]),
          validarCanales: jest.fn().mockResolvedValue([]),
          agenciaDe: jest.fn(),
          agenciasDe: jest.fn().mockResolvedValue([]),
          cierreVigente: jest.fn().mockResolvedValue({ codigo: 'AT', etiqueta: 'Atendido' }),
        }},
        { provide: TenantsService, useValue: {
          directorio: jest.fn().mockResolvedValue([]),
          porCodigo: jest.fn(),
          asegurarVigente: jest.fn(),
        }},
        { provide: TenantRlsService, useValue: {
          // En producción abre una transacción y fija app.tenant (RLS); en el
          // test no hay Postgres real, así que solo entrega un EntityManager
          // de mentiras cuyo getRepository() devuelve el mismo mockRepo que
          // ya usan las aserciones — el contrato (repo.save fue llamado) no cambia.
          conTenant: jest.fn((_tenant: string, fn: (m: any) => unknown) => fn({
            getRepository: (entity: unknown) =>
              entity === CasoEntity ? repoRef
                : entity === MensajeChatInternoEntity ? chatRepoRef
                  : eventosRepoRef,
            query: jest.fn(),
          })),
        }},
      ],
    }).compile();

    service = module.get<CasosService>(CasosService);
    repo = module.get(getRepositoryToken(CasoEntity));
    eventosRepo = module.get(getRepositoryToken(EventoCasoEntity));
    // No se inyecta por constructor (el servicio la pide via manager.getRepository
    // dentro de conTenant, igual que EventoCasoEntity) — se arma aparte.
    chatRepo = mockRepo();
    repoRef = repo;
    eventosRepoRef = eventosRepo;
    chatRepoRef = chatRepo;
    // Evitar que el seed corra en tests
    jest.spyOn(service as any, 'seed').mockResolvedValue(undefined);
  });

  describe('obtener()', () => {
    it('lanza NotFoundException si el caso no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.obtener('demo', 'no-existe')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el actor no alcanza el caso', async () => {
      const caso = { id: '1', tenant: 'demo', canales: ['otro-canal'], creadoPor: 'otro' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      await expect(service.obtener('demo', '1', actor)).rejects.toThrow(NotFoundException);
    });

    it('devuelve el caso si el actor tiene casos.ver_todos y es de la misma agencia', async () => {
      const caso = { id: '1', tenant: 'demo', canales: ['otro-canal'], creadoPor: 'otro', agenciaResponsableId: 'agencia-uuid-1' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      const result = await service.obtener('demo', '1', actorSupervisor);
      expect(result).toBe(caso);
    });

    it('lanza NotFoundException si el actor tiene casos.ver_todos pero es de OTRA agencia', async () => {
      const caso = { id: '1', tenant: 'demo', canales: ['otro-canal'], creadoPor: 'otro', agenciaResponsableId: 'agencia-uuid-2' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      await expect(service.obtener('demo', '1', actorSupervisor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('tomar()', () => {
    it('cambia estado a en_gestion cuando está nuevo', async () => {
      const caso = { id: '1', tenant: 'demo', estado: 'nuevo', canales: ['canal-uuid-1'], creadoPor: 'otro' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      repo.save.mockResolvedValue({ ...caso, estado: 'en_gestion' });
      eventosRepo.save.mockResolvedValue({});
      eventosRepo.create.mockImplementation((v: unknown) => v);
      const resultado = await service.tomar('demo', '1', actor);
      expect(repo.save).toHaveBeenCalled();
    });

    it('no hace nada si ya está en gestión', async () => {
      const caso = { id: '1', tenant: 'demo', estado: 'en_gestion', canales: ['canal-uuid-1'], creadoPor: 'actor' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      const resultado = await service.tomar('demo', '1', actor);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('agregarNota()', () => {
    it('lanza BadRequestException si la nota está vacía', async () => {
      const caso = { id: '1', tenant: 'demo', canales: ['canal-uuid-1'], creadoPor: 'actor' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      await expect(service.agregarNota('demo', '1', '', 'operador1')).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si la nota supera 1000 caracteres', async () => {
      const caso = { id: '1', tenant: 'demo', canales: ['canal-uuid-1'], creadoPor: 'actor' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      await expect(service.agregarNota('demo', '1', 'x'.repeat(1001), 'operador1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cambiarEstado()', () => {
    it('impide cerrar sin permiso casos.cerrar', async () => {
      const caso = { id: '1', tenant: 'demo', estado: 'en_gestion', canales: ['canal-uuid-1'], creadoPor: 'actor' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      const actorSinCerrar: Actor = { ...actor, permisos: ['casos.ver', 'casos.gestionar'] };
      await expect(service.cambiarEstado('demo', '1', { estado: 'cerrado', codigoCierre: 'AT', comentario: 'ok' }, actorSinCerrar))
        .rejects.toThrow();
    });
  });

  describe('chat interno (listarChatInterno / enviarChatInterno)', () => {
    it('lanza NotFoundException si el caso no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.listarChatInterno('demo', 'no-existe')).rejects.toThrow(NotFoundException);
      await expect(service.enviarChatInterno('demo', 'no-existe', 'operador1', 'Operador Uno', 'hola'))
        .rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el mensaje está vacío', async () => {
      const caso = { id: '1', tenant: 'demo', estado: 'en_gestion', canales: ['canal-uuid-1'], creadoPor: 'actor' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      await expect(service.enviarChatInterno('demo', '1', 'operador1', 'Operador Uno', '   '))
        .rejects.toThrow(BadRequestException);
      expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('impide escribir si el caso ya está cerrado — el chat queda en solo lectura', async () => {
      const caso = { id: '1', tenant: 'demo', estado: 'cerrado', canales: ['canal-uuid-1'], creadoPor: 'actor' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      await expect(service.enviarChatInterno('demo', '1', 'operador1', 'Operador Uno', 'hola'))
        .rejects.toThrow(BadRequestException);
      expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('guarda el mensaje cuando el caso está abierto, sin restringir por canal del autor', async () => {
      // 'supervisor1' no tiene este canal en su Actor de prueba y ni siquiera
      // se pasa un Actor aquí — a propósito: cualquiera con casos.ver puede
      // escribir en el chat de cualquier caso del tenant (ver el comentario
      // del método en casos.service.ts).
      const caso = { id: '1', tenant: 'demo', estado: 'en_gestion', canales: ['canal-uuid-1'], creadoPor: 'otro' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      chatRepo.save.mockImplementation((v: unknown) => Promise.resolve({ id: 'msg-1', ...(v as object) }));
      const resultado = await service.enviarChatInterno('demo', '1', 'supervisor1', 'Supervisor Uno', '  ¿ya llegó la ambulancia?  ');
      expect(chatRepo.save).toHaveBeenCalled();
      expect(resultado).toMatchObject({
        tenant: 'demo', casoId: '1', autorId: 'supervisor1', autorNombre: 'Supervisor Uno',
        texto: '¿ya llegó la ambulancia?', // recortado
      });
    });

    it('lista los mensajes del caso, más antiguos primero', async () => {
      const caso = { id: '1', tenant: 'demo', estado: 'en_gestion', canales: [] as string[], creadoPor: 'otro' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      const mensajes = [{ id: 'a' }, { id: 'b' }];
      chatRepo.find.mockResolvedValue(mensajes);
      const resultado = await service.listarChatInterno('demo', '1');
      expect(chatRepo.find).toHaveBeenCalledWith({
        where: { tenant: 'demo', casoId: '1' },
        order: { creadoEn: 'ASC' },
      });
      expect(resultado).toBe(mensajes);
    });
  });
});
