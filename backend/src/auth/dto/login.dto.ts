import { Rol } from '../../usuarios/usuario.entity';

/** Credenciales de login (institucional o civil). */
export interface LoginDto {
  usuario: string;
  contrasena: string;
}

/** Resultado de un login exitoso. */
export interface LoginResult {
  token: string;
  usuario: string;
  tipo: 'institucional' | 'civil';
  nombre: string;
  rol: Rol;
  tenant: string;
}
