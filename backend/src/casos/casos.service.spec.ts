import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CasosService } from './casos.service';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity } from './evento.entity';
import { DespachoService } from '../despacho/despacho.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantRlsService } from '../common/tenant-rls.service';
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
};

describe('CasosService', () => {
  let service: CasosService;
  let repo: ReturnType<typeof mockRepo>;
  let eventosRepo: ReturnType<typeof mockRepo>;
  // Capturados por el mock de TenantRlsService.conTenant (ver abajo): se
  // declaran antes porque los providers se arman antes de tener `repo`/`eventosRepo`.
  let repoRef: ReturnType<typeof mockRepo>;
  let eventosRepoRef: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasosService,
        { provide: getRepositoryToken(CasoEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(EventoCasoEntity), useFactory: mockRepo },
        { provide: DespachoService, useValue: { liberarCaso: jest.fn() } },
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
              entity === CasoEntity ? repoRef : eventosRepoRef,
            query: jest.fn(),
          })),
        }},
      ],
    }).compile();

    service = module.get<CasosService>(CasosService);
    repo = module.get(getRepositoryToken(CasoEntity));
    eventosRepo = module.get(getRepositoryToken(EventoCasoEntity));
    repoRef = repo;
    eventosRepoRef = eventosRepo;
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

    it('devuelve el caso si el actor tiene casos.ver_todos', async () => {
      const caso = { id: '1', tenant: 'demo', canales: ['otro-canal'], creadoPor: 'otro' } as CasoEntity;
      repo.findOne.mockResolvedValue(caso);
      const result = await service.obtener('demo', '1', actorSupervisor);
      expect(result).toBe(caso);
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
});
