import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CasoCanalEntity } from './caso-canal.entity';
import { CasoEntity } from './caso.entity';
import { EstadoCaso } from './caso.model';

/**
 * El estado de despacho por entidad, y la regla que lo une con el caso.
 *
 * Vive aparte de `CasosService` a propósito: `DespachoService` también mueve el
 * estado (al poner una unidad en la calle) y `CasosModule` ya importa
 * `DespachoModule`, así que meter esto en el servicio de casos obligaría a una
 * dependencia circular o —peor— a copiar la cascada de cierre en dos sitios,
 * que es justo lo que después se desincroniza.
 *
 * No depende de ningún otro módulo de negocio: solo del `EntityManager` que le
 * entrega quien lo llama, ya dentro de su transacción y con `app.tenant` fijado.
 */
@Injectable()
export class CasoCanalService {
  /** Orden del ciclo de vida, para saber cuál entidad va más atrasada. */
  private static readonly AVANCE: Record<EstadoCaso, number> = {
    nuevo: 0, en_gestion: 1, despachado: 2, derivado: 3, cerrado: 4,
  };

  /**
   * Abre la bandeja de cada canal destino. Idempotente: remitir de nuevo a un
   * canal que ya tenía el caso no duplica la fila ni le reinicia el reloj a
   * quien ya lo estaba atendiendo.
   */
  async abrir(
    manager: EntityManager,
    tenant: string,
    casoId: string,
    canales: Array<{ id: string; agenciaId: string }>,
  ): Promise<void> {
    if (!canales.length) return;
    const repo = manager.getRepository(CasoCanalEntity);
    const ya = new Set((await repo.find({ where: { tenant, casoId } })).map((f) => f.canalId));
    const nuevas = canales
      .filter((c) => !ya.has(c.id))
      .map((c) => repo.create({ tenant, casoId, canalId: c.id, agenciaId: c.agenciaId, estado: 'nuevo' as EstadoCaso }));
    if (nuevas.length) await repo.save(nuevas);
  }

  /**
   * Cierra las filas de los canales que dejan de atender el caso (traslado
   * exclusivo). No se borran: queda el rastro de que esa entidad estuvo
   * involucrada y hasta cuándo.
   */
  async retirar(manager: EntityManager, tenant: string, casoId: string, conservar: string[]): Promise<void> {
    const repo = manager.getRepository(CasoCanalEntity);
    const quedan = new Set(conservar);
    const fuera = (await repo.find({ where: { tenant, casoId } }))
      .filter((f) => !quedan.has(f.canalId) && f.estado !== 'cerrado');
    for (const f of fuera) f.estado = 'cerrado';
    if (fuera.length) await repo.save(fuera);
  }

  /** La fila de ESTE caso en ESE canal, o null si el caso nunca llegó ahí. */
  fila(manager: EntityManager, tenant: string, casoId: string, canalId: string): Promise<CasoCanalEntity | null> {
    return manager.getRepository(CasoCanalEntity).findOne({ where: { tenant, casoId, canalId } });
  }

  filas(manager: EntityManager, tenant: string, casoId: string): Promise<CasoCanalEntity[]> {
    return manager.getRepository(CasoCanalEntity).find({ where: { tenant, casoId } });
  }

  /**
   * Avanza a `estado` todas las filas de una agencia que aún no llegaron ahí.
   * Lo usa el despacho de recursos: la entidad que pone una unidad en la calle
   * es la que pasa a «con recursos», no las demás.
   */
  async avanzarAgencia(
    manager: EntityManager,
    tenant: string,
    casoId: string,
    agenciaId: string,
    estado: EstadoCaso,
  ): Promise<boolean> {
    const repo = manager.getRepository(CasoCanalEntity);
    const filas = (await repo.find({ where: { tenant, casoId, agenciaId } }))
      .filter((f) => CasoCanalService.AVANCE[f.estado] < CasoCanalService.AVANCE[estado] && f.estado !== 'cerrado');
    if (!filas.length) return false;
    for (const f of filas) f.estado = estado;
    await repo.save(filas);
    return true;
  }

  /**
   * Lleva a `estado` todas las filas abiertas de un caso. Lo usa la remisión a
   * otra jurisdicción: el caso sale de este secad entero, así que todas las
   * bandejas de aquí quedan marcadas igual.
   */
  async marcarTodas(manager: EntityManager, tenant: string, casoId: string, estado: EstadoCaso): Promise<void> {
    const repo = manager.getRepository(CasoCanalEntity);
    const abiertas = (await repo.find({ where: { tenant, casoId } })).filter((f) => f.estado !== 'cerrado');
    for (const f of abiertas) f.estado = estado;
    if (abiertas.length) await repo.save(abiertas);
  }

  /**
   * Recalcula `casos.estado` a partir de las filas por canal. Es la regla
   * central de todo el diseño:
   *
   *   - Cerrado SOLO cuando TODAS las entidades cerraron lo suyo. Mientras
   *     quede una abierta el caso sigue abierto, aunque las demás terminaran:
   *     es lo que impide que el cierre de policía borre el caso de la bandeja
   *     de bomberos a mitad de su trabajo.
   *   - Si queda alguna abierta, el macro-estado es el MÁS ATRASADO de ellas.
   *     Un caso que policía ya despachó pero bomberos no ha abierto sigue
   *     contando como pendiente, que es la verdad operativa.
   *
   * Devuelve el cambio solo si lo hubo, para que quien llama decida si deja
   * constancia en la bitácora.
   */
  async sincronizarMacro(
    manager: EntityManager,
    tenant: string,
    caso: CasoEntity,
  ): Promise<{ anterior: EstadoCaso; nuevo: EstadoCaso } | null> {
    const filas = await this.filas(manager, tenant, caso.id);
    // Un caso sin canales (recepcionado sin destino) conserva su estado propio:
    // no hay de dónde derivarlo.
    if (!filas.length) return null;

    const abiertas = filas.filter((f) => f.estado !== 'cerrado');
    const nuevo: EstadoCaso = abiertas.length
      ? abiertas.reduce((a, b) => (CasoCanalService.AVANCE[a.estado] <= CasoCanalService.AVANCE[b.estado] ? a : b)).estado
      : 'cerrado';

    const anterior = caso.estado;
    if (anterior === nuevo) return null;
    caso.estado = nuevo;
    if (nuevo === 'cerrado') {
      // El desenlace del caso es el que puso la última entidad en cerrar.
      const ultima = filas.reduce((a, b) => (a.actualizadoEn > b.actualizadoEn ? a : b));
      caso.codigoCierre = ultima.codigoCierre ?? caso.codigoCierre ?? null;
    }
    await manager.getRepository(CasoEntity).save(caso);
    return { anterior, nuevo };
  }
}
