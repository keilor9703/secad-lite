import { IsString, MaxLength } from 'class-validator';

/** Credenciales de login (clase para que el ValidationPipe valide los tipos). */
export class LoginDto {
  @IsString() @MaxLength(120)
  usuario!: string;

  @IsString() @MaxLength(200)
  contrasena!: string;
}

/** Autoservicio: cambiar la propia contraseña demostrando la actual. */
export class CambiarContrasenaDto {
  @IsString() @MaxLength(200)
  actual!: string;

  @IsString() @MaxLength(200)
  nueva!: string;
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
  /**
   * Integraciones contratadas por SU tenant (pbx, whatsapp, api, cti…). Sin
   * esto la interfaz no tenía forma de saber, para un usuario que no es
   * superadmin, qué módulos están habilitados — terminaba pidiendo la
   * configuración de todos y mostrando un aviso de "no habilitado" por cada
   * uno que no se contrató.
   */
  integraciones: string[];
}
