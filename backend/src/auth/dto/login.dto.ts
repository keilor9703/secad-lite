/** Credenciales de login. */
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
  rol: string;
  permisos: string[];
  tenant: string | null;
  /** Agencia del funcionario (agencias.id); nula para superadmin y ciudadanos. */
  agencia?: string | null;
}
