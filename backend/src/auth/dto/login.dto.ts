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
  tipo: 'institucional';
  nombre: string;
  rol: string;
  permisos: string[];
  tenant: string | null;
  /** Agencia del funcionario (agencias.id); nula para el superadmin. */
  agencia?: string | null;
  /**
   * Integraciones contratadas por SU tenant (pbx, whatsapp, api, cti…). Sin
   * esto la interfaz no tenía forma de saber, para un usuario que no es
   * superadmin, qué módulos están habilitados — terminaba pidiendo la
   * configuración de todos y mostrando un aviso de "no habilitado" por cada
   * uno que no se contrató.
   *
   * `null` cuando el tenant no tiene la lista configurada (instancias previas
   * a esta funcionalidad): sin restricción, igual que en el backend.
   */
  integraciones: string[] | null;
  /** Bandera/logo de SU tenant (data URL), para mostrarla junto al indicador de tenant. Null si no configuró una. */
  logoDataUrl: string | null;
  /**
   * Código DANE (DIVIPOLA) del municipio de SU tenant. Es lo que permite a
   * Recepción mostrar por defecto el municipio del caso y centrar el mapa en
   * la instancia del operador, sin que el frontend tenga que resolverlo por
   * su cuenta. Null si el tenant no tiene municipio configurado.
   */
  municipioCodigo: string | null;
}

/**
 * Respuesta del login cuando falta el segundo factor.
 *
 * Deliberadamente NO trae token de sesión: hasta que el código se verifique,
 * el usuario no tiene sesión de ninguna clase.
 */
export interface RetoMfaResult {
  requiereMfa: true;
  /** true = todavía no se ha enrolado y hay que mostrarle el QR. */
  inscripcion: boolean;
  /** Token efímero que acredita que usuario y contraseña ya se validaron. */
  reto: string;
  /** Para saludarlo por su nombre mientras escanea. */
  nombre: string;
}

/**
 * Los decoradores NO son adorno: `main.ts` usa ValidationPipe con
 * `whitelist: true`, que BORRA toda propiedad que no declare validación. Sin
 * ellos, estos campos llegan como `undefined` al controlador y el doble factor
 * falla entero —el servidor intenta verificar un token vacío— con un mensaje
 * que no apunta a nada.
 */
export class VerificarMfaDto {
  @IsString() @MaxLength(4000)
  reto!: string;

  @IsString() @MaxLength(12)
  codigo!: string;
}

export class ConfirmarMfaDto {
  @IsString() @MaxLength(4000)
  reto!: string;

  @IsString() @MaxLength(4000)
  inscripcion!: string;

  @IsString() @MaxLength(12)
  codigo!: string;
}

/** El cuerpo de `POST /auth/mfa/inscripcion`. */
export class InscripcionMfaDto {
  @IsString() @MaxLength(4000)
  reto!: string;
}
