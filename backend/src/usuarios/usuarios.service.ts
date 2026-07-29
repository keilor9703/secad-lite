import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Rol, UsuarioEntity } from './usuario.entity';

/**
 * Directorio de usuarios (institucionales) respaldado por PostgreSQL. Reemplaza
 * el login "cualquier usuario" del esqueleto: valida contra la tabla con bcrypt.
 */
@Injectable()
export class UsuariosService implements OnModuleInit {
  constructor(
    @InjectRepository(UsuarioEntity)
    private readonly repo: Repository<UsuarioEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  buscar(tenant: string, username: string): Promise<UsuarioEntity | null> {
    return this.repo.findOne({ where: { tenant, username: username.toLowerCase(), activo: true } });
  }

  /** Valida credenciales institucionales; devuelve el usuario o null. */
  async validar(tenant: string, username: string, contrasena: string): Promise<UsuarioEntity | null> {
    const u = await this.buscar(tenant, username);
    if (!u) return null;
    const ok = await bcrypt.compare(contrasena, u.passwordHash);
    return ok ? u : null;
  }

  /** Siembra usuarios institucionales de demo (uno por rol) para el tenant 'demo'. */
  private async seed(): Promise<void> {
    if (await this.repo.count({ where: { tenant: 'demo' } })) return;

    const hash = await bcrypt.hash('demo', 10);
    const demo: Array<{ username: string; nombre: string; rol: Rol }> = [
      { username: 'operador1', nombre: 'Operador Uno', rol: 'operador' },
      { username: 'supervisor1', nombre: 'Supervisor Uno', rol: 'supervisor' },
      { username: 'admin1', nombre: 'Administrador', rol: 'admin' },
    ];
    for (const d of demo) {
      await this.repo.save(
        this.repo.create({ tenant: 'demo', username: d.username, passwordHash: hash, nombre: d.nombre, rol: d.rol, tipo: 'institucional' }),
      );
    }
  }
}
