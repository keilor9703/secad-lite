import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CredencialTokenEntity, TipoCredencial } from './credencial-token.entity';

/** Plazos. La invitación da margen para un turno libre; la recuperación, no. */
export const HORAS_INVITACION = 72;
export const HORAS_RECUPERACION = 1;

export interface TokenEmitido {
  /** El token en claro. Existe solo aquí y en el enlace del correo. */
  token: string;
  venceEn: Date;
}

/**
 * Emite y consume los enlaces de un solo uso.
 *
 * Tres garantías, y las tres tienen prueba:
 *
 *  1. **Un solo uso.** Al consumirse queda con fecha en `usadoEn` y no vuelve
 *     a validar. Un correo reenviado deja de servir.
 *  2. **Vence.** Pasado el plazo no vale, aunque nadie lo haya usado.
 *  3. **Emitir uno anula los anteriores.** Nunca hay dos enlaces vivos para la
 *     misma cuenta: si un administrador reenvía la invitación porque sospecha
 *     que la primera se filtró, la primera deja de valer en ese instante.
 */
@Injectable()
export class CredencialesService {
  constructor(
    @InjectRepository(CredencialTokenEntity)
    private readonly repo: Repository<CredencialTokenEntity>,
  ) {}

  /** sha256 en hexadecimal. Lo que se guarda; nunca el token. */
  static hash(token: string): string {
    return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
  }

  /**
   * Emite un enlace para esa cuenta y anula los que tuviera vivos.
   *
   * 32 bytes de `randomBytes` son 256 bits: no se adivina por fuerza bruta, y
   * por eso el endpoint público puede responder siempre lo mismo sin revelar
   * nada. `base64url` evita que el enlace se rompa al viajar por un correo.
   */
  async emitir(usuarioId: string, tipo: TipoCredencial, creadoPor?: string | null): Promise<TokenEmitido> {
    await this.anularVivos(usuarioId);

    const token = randomBytes(32).toString('base64url');
    const horas = tipo === 'invitacion' ? HORAS_INVITACION : HORAS_RECUPERACION;
    const venceEn = new Date(Date.now() + horas * 60 * 60 * 1000);

    await this.repo.save(
      this.repo.create({
        usuarioId,
        tipo,
        tokenHash: CredencialesService.hash(token),
        venceEn,
        creadoPor: creadoPor ?? null,
      }),
    );
    return { token, venceEn };
  }

  /**
   * ¿A qué cuenta corresponde este token, si todavía vale? Devuelve null para
   * cualquier motivo —no existe, vencido, usado, anulado— sin distinguir cuál:
   * quien prueba enlaces al azar no aprende nada de la diferencia.
   */
  async validar(token: string): Promise<CredencialTokenEntity | null> {
    const fila = await this.buscar(token);
    if (!fila) return null;
    if (fila.usadoEn || fila.anuladoEn) return null;
    if (fila.venceEn.getTime() <= Date.now()) return null;
    return fila;
  }

  /**
   * Marca el token como usado y devuelve la fila, o null si ya no valía.
   *
   * La comprobación y la marca van en la misma sentencia condicionada: dos
   * peticiones simultáneas con el mismo enlace —el doble clic de siempre— no
   * pueden consumirlo las dos, porque la segunda no encuentra fila que
   * actualizar.
   */
  async consumir(token: string): Promise<CredencialTokenEntity | null> {
    const fila = await this.validar(token);
    if (!fila) return null;
    const r = await this.repo
      .createQueryBuilder()
      .update(CredencialTokenEntity)
      .set({ usadoEn: () => 'now()' })
      .where('id = :id AND "usadoEn" IS NULL AND "anuladoEn" IS NULL', { id: fila.id })
      .execute();
    return r.affected === 1 ? fila : null;
  }

  /** Anula los enlaces vivos de una cuenta. También al cambiar la contraseña por otra vía. */
  async anularVivos(usuarioId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(CredencialTokenEntity)
      .set({ anuladoEn: () => 'now()' })
      .where('"usuarioId" = :usuarioId AND "usadoEn" IS NULL AND "anuladoEn" IS NULL', { usuarioId })
      .execute();
  }

  /**
   * Borra los vencidos hace más de 30 días. No es higiene: un token vencido ya
   * no abre nada, pero la tabla crece sin tope si nadie la limpia.
   */
  async purgar(): Promise<number> {
    const corte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const r = await this.repo.delete({ venceEn: LessThan(corte) });
    return r.affected ?? 0;
  }

  /** Enlaces vivos de una cuenta; para que la interfaz sepa si hay invitación pendiente. */
  contarVivos(usuarioId: string): Promise<number> {
    return this.repo.count({
      where: { usuarioId, usadoEn: IsNull(), anuladoEn: IsNull() },
    });
  }

  private async buscar(token: string): Promise<CredencialTokenEntity | null> {
    const limpio = String(token ?? '').trim();
    if (!limpio) return null;
    const hash = CredencialesService.hash(limpio);
    const fila = await this.repo.findOne({ where: { tokenHash: hash } });
    if (!fila) return null;
    // Comparación en tiempo constante sobre el hash. La búsqueda por índice ya
    // decidió, así que esto no cambia el resultado; está para que el camino no
    // dependa de cuántos caracteres del hash coinciden.
    const a = Buffer.from(fila.tokenHash, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? fila : null;
  }
}
