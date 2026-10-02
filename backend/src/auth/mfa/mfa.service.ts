import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsuarioEntity } from '../../usuarios/usuario.entity';
import { ConfigMfaEntity } from './config-mfa.entity';
import { cifrar, descifrar } from '../../common/secretos';
import { contadorDe, generarSecreto, uriOtpauth, verificarCodigo } from './totp';

export const TENANT_CONFIG_MFA = '__global__';

/** Nombre que el usuario verá en su aplicación de autenticación. */
const EMISOR = 'FALCON CAD';

/** Fallos seguidos antes de bloquear, y cuánto dura el bloqueo. */
const INTENTOS_MAXIMOS = 5;
const BLOQUEO_MINUTOS = 15;

/**
 * Cuánto viven los tokens intermedios.
 *
 * El del reto es corto: el usuario ya tiene el código delante. El de
 * inscripción es más largo porque hay que instalar la aplicación, escanear y
 * esperar al siguiente código.
 */
const RETO_MINUTOS = 5;
const INSCRIPCION_MINUTOS = 10;

/**
 * Marca que distingue los tokens intermedios del 2FA de un token de sesión.
 *
 * ES LA PIEZA MÁS IMPORTANTE DE TODO ESTO. El guard de la aplicación acepta
 * cualquier JWT firmado con JWT_SECRET; si los tokens del reto y de la
 * inscripción no fueran distinguibles, presentarlos como `Authorization:
 * Bearer` daría una sesión completa sin haber pasado el segundo factor. El
 * guard rechaza todo token que traiga este claim.
 */
export const USO_INTERMEDIO = 'mfa';

// `sub` es el ID del usuario, no su nombre: el username es único salvo por
// duplicados heredados, y resolver por nombre dejaría abierta la posibilidad
// de terminar emitiendo la sesión de OTRA cuenta homónima.
export interface RetoMfa { sub: string; uso: typeof USO_INTERMEDIO; fase: 'reto' }
export interface TokenInscripcion { sub: string; uso: typeof USO_INTERMEDIO; fase: 'inscripcion'; secreto: string }

export interface InicioInscripcion {
  /** URI que se convierte en QR en el navegador. */
  otpauth: string;
  /** El mismo secreto en texto, para teclearlo si la cámara no coopera. */
  claveManual: string;
  /** Token que lleva el secreto hasta que el usuario demuestre que lo escaneó. */
  inscripcion: string;
}

/**
 * Doble factor por código temporal (TOTP).
 *
 * Dos decisiones gobiernan el diseño:
 *
 * 1. El secreto NO se guarda al mostrar el QR, sino al confirmar el primer
 *    código. Viaja mientras tanto dentro de un token firmado y efímero. Si se
 *    guardara antes, un usuario que cierra la ventana a medias quedaría con
 *    2FA activo sin haberlo escaneado — es decir, fuera del sistema para
 *    siempre.
 *
 * 2. El superadministrador queda exento. Es quien tiene que poder entrar a
 *    apagar esto si algo sale mal; si también dependiera del 2FA, un fallo
 *    aquí dejaría la plataforma sin nadie que pueda arreglarla.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(ConfigMfaEntity) private readonly configs: Repository<ConfigMfaEntity>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * ¿Hay que exigir segundo factor?
   *
   * Dos interruptores, y el de la variable de entorno manda. El de Plataforma
   * es el de uso diario; el del entorno es el de emergencia, para cuando no se
   * puede llegar a Plataforma —y por eso tiene que poder apagar, nunca
   * encender lo que la aplicación apagó—.
   */
  async exigido(): Promise<boolean> {
    if ((this.config.get<string>('MFA_OBLIGATORIO') ?? '').toLowerCase() === 'false') {
      this.logger.warn('El doble factor está DESACTIVADO por MFA_OBLIGATORIO=false.');
      return false;
    }
    const cfg = await this.configs.findOne({ where: { tenant: TENANT_CONFIG_MFA } });
    return cfg ? cfg.exigido : true;
  }

  /** El superadministrador nunca pasa por el segundo factor. */
  exento(rol: string): boolean {
    return rol === 'superadmin';
  }

  /** Token que acredita «ya presentó usuario y contraseña», nada más. */
  firmarReto(usuarioId: string): string {
    const claims: RetoMfa = { sub: usuarioId, uso: USO_INTERMEDIO, fase: 'reto' };
    return this.jwt.sign(claims, { expiresIn: `${RETO_MINUTOS}m` });
  }

  private leerReto(token: string): string {
    let claims: RetoMfa;
    try {
      claims = this.jwt.verify<RetoMfa>(token);
    } catch (e) {
      // Caducado e inválido NO son lo mismo, y decir «expiró» ante cualquier
      // fallo manda a buscar donde no es: con el token llegando vacío por un
      // problema de validación, el mensaje señalaba al reloj.
      throw new UnauthorizedException(this.expirado(e)
        ? 'La sesión de verificación expiró. Vuelva a iniciar sesión.'
        : 'No se pudo validar la sesión de verificación. Vuelva a iniciar sesión.');
    }
    if (claims?.uso !== USO_INTERMEDIO || claims.fase !== 'reto' || !claims.sub) {
      throw new UnauthorizedException('Token de verificación inválido.');
    }
    return claims.sub;
  }

  /**
   * Arranca el enrolamiento: secreto nuevo, URI para el QR y un token que lo
   * guarda hasta que el usuario demuestre haberlo escaneado.
   */
  async iniciarInscripcion(reto: string): Promise<InicioInscripcion> {
    const sub = this.leerReto(reto);
    const u = await this.porId(sub);

    // Volver a empezar siempre genera un secreto NUEVO. Reutilizar el de un
    // intento anterior significaría que un QR mostrado y abandonado sigue
    // sirviendo para enrolarse.
    const secreto = generarSecreto();
    const claims: TokenInscripcion = { sub, uso: USO_INTERMEDIO, fase: 'inscripcion', secreto };

    return {
      otpauth: uriOtpauth(EMISOR, `${u.username}${u.tenant ? '@' + u.tenant : ''}`, secreto),
      claveManual: secreto,
      inscripcion: this.jwt.sign(claims, { expiresIn: `${INSCRIPCION_MINUTOS}m` }),
    };
  }

  /**
   * Confirma el enrolamiento. Solo aquí se guarda el secreto, y solo si el
   * código demuestra que la aplicación del usuario ya lo tiene.
   */
  async confirmarInscripcion(inscripcion: string, codigo: string): Promise<string> {
    let claims: TokenInscripcion;
    try {
      claims = this.jwt.verify<TokenInscripcion>(inscripcion);
    } catch (e) {
      throw new UnauthorizedException(this.expirado(e)
        ? 'El enrolamiento expiró. Vuelva a generar el código QR.'
        : 'No se pudo validar el enrolamiento. Vuelva a generar el código QR.');
    }
    if (claims?.uso !== USO_INTERMEDIO || claims.fase !== 'inscripcion' || !claims.secreto) {
      throw new UnauthorizedException('Token de enrolamiento inválido.');
    }

    const u = await this.porId(claims.sub);
    this.comprobarBloqueo(u);

    const contador = verificarCodigo(claims.secreto, codigo);
    if (contador === null) {
      await this.anotarFallo(u);
      throw new UnauthorizedException('El código no es correcto. Verifique la hora de su teléfono.');
    }

    u.mfaSecreto = cifrar(claims.secreto, this.secreto());
    u.mfaActivadoEn = new Date();
    u.mfaUltimoContador = String(contador);
    u.mfaIntentosFallidos = 0;
    u.mfaBloqueoHasta = null;
    await this.usuarios.save(u);

    this.logger.log(`Doble factor enrolado para ${u.username}.`);
    return claims.sub;
  }

  /** Verifica el código de un usuario ya enrolado. Devuelve su username. */
  async verificar(reto: string, codigo: string): Promise<string> {
    const sub = this.leerReto(reto);
    const u = await this.porId(sub);
    this.comprobarBloqueo(u);

    if (!u.mfaSecreto) {
      throw new UnauthorizedException('Este usuario todavía no tiene configurado el doble factor.');
    }

    let secreto: string;
    try {
      secreto = descifrar(u.mfaSecreto, this.secreto());
    } catch {
      // La llave de cifrado cambió: el secreto guardado ya no se puede leer.
      // No se puede dejar entrar, pero tampoco culpar al usuario de un código
      // que escribió bien.
      this.logger.error(
        `No se pudo descifrar el secreto 2FA de ${u.username}: la llave de cifrado cambió. ` +
        'Hay que volver a enrolar al usuario.',
      );
      throw new UnauthorizedException('No se pudo verificar el segundo factor. Avise al administrador.');
    }

    const contador = verificarCodigo(secreto, codigo);
    if (contador === null) {
      await this.anotarFallo(u);
      throw new UnauthorizedException('El código no es correcto. Verifique la hora de su teléfono.');
    }

    // Un código vale UNA vez. Sin esto serviría durante los 90 segundos de la
    // ventana, que es tiempo de sobra para quien lo vio por encima del hombro.
    if (u.mfaUltimoContador !== null && u.mfaUltimoContador !== undefined
        && Number(u.mfaUltimoContador) >= contador) {
      await this.anotarFallo(u);
      throw new UnauthorizedException('Ese código ya se usó. Espere al siguiente.');
    }

    u.mfaUltimoContador = String(contador);
    u.mfaIntentosFallidos = 0;
    u.mfaBloqueoHasta = null;
    await this.usuarios.save(u);
    return sub;
  }

  /** ¿Este usuario ya tiene segundo factor configurado? */
  async tieneSecreto(usuarioId: string): Promise<boolean> {
    const u = await this.usuarios.findOne({ where: { id: usuarioId }, select: ['id', 'mfaSecreto'] });
    return !!u?.mfaSecreto;
  }

  /** Quita el enrolamiento: el usuario volverá a ver el QR al entrar. */
  async restablecer(usuarioId: string): Promise<void> {
    const u = await this.porId(usuarioId);
    u.mfaSecreto = null;
    u.mfaActivadoEn = null;
    u.mfaUltimoContador = null;
    u.mfaIntentosFallidos = 0;
    u.mfaBloqueoHasta = null;
    await this.usuarios.save(u);
    this.logger.warn(`Doble factor restablecido para ${u.username}.`);
  }

  private comprobarBloqueo(u: UsuarioEntity): void {
    if (u.mfaBloqueoHasta && u.mfaBloqueoHasta > new Date()) {
      const minutos = Math.ceil((u.mfaBloqueoHasta.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(
        `Demasiados intentos fallidos. Vuelva a intentar en ${minutos} minuto(s).`,
      );
    }
  }

  private async anotarFallo(u: UsuarioEntity): Promise<void> {
    u.mfaIntentosFallidos = (u.mfaIntentosFallidos ?? 0) + 1;
    if (u.mfaIntentosFallidos >= INTENTOS_MAXIMOS) {
      u.mfaBloqueoHasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60_000);
      u.mfaIntentosFallidos = 0;
      this.logger.warn(`${u.username} bloqueado por ${BLOQUEO_MINUTOS} minutos: ${INTENTOS_MAXIMOS} códigos fallidos.`);
    }
    await this.usuarios.save(u);
  }

  private async porId(id: string): Promise<UsuarioEntity> {
    const u = await this.usuarios.findOne({ where: { id, activo: true } });
    if (!u) throw new UnauthorizedException('La cuenta ya no está disponible.');
    return u;
  }

  /** ¿El token falló por caducidad, o por cualquier otra cosa? */
  private expirado(e: unknown): boolean {
    return (e as { name?: string })?.name === 'TokenExpiredError';
  }

  private secreto(): string {
    return this.config.get<string>('JWT_SECRET') ?? 'dev-secret';
  }

  // ── Política de la plataforma ───────────────────────────────────────────

  async verConfig(): Promise<{ exigido: boolean; forzadoPorEntorno: boolean; actualizadoPor: string | null; actualizadoEn: Date | null }> {
    const cfg = await this.configs.findOne({ where: { tenant: TENANT_CONFIG_MFA } });
    return {
      exigido: cfg ? cfg.exigido : true,
      // Si el entorno lo apagó, la pantalla tiene que decirlo: si no, el
      // administrador vería «exigido» y no entendería por qué nadie lo pide.
      forzadoPorEntorno: (this.config.get<string>('MFA_OBLIGATORIO') ?? '').toLowerCase() === 'false',
      actualizadoPor: cfg?.actualizadoPor ?? null,
      actualizadoEn: cfg?.actualizadoEn ?? null,
    };
  }

  async guardarConfig(exigido: boolean, actor: string) {
    const cfg = (await this.configs.findOne({ where: { tenant: TENANT_CONFIG_MFA } }))
      ?? this.configs.create({ tenant: TENANT_CONFIG_MFA });
    cfg.exigido = exigido;
    cfg.actualizadoPor = actor;
    await this.configs.save(cfg);
    this.logger.warn(`${actor} ${exigido ? 'ACTIVÓ' : 'DESACTIVÓ'} el doble factor para toda la plataforma.`);
    return this.verConfig();
  }
}
