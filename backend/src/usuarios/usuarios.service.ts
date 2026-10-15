import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { cifrar, descifrar } from '../common/secretos';
import { UsuarioEntity } from './usuario.entity';
import { RolesService } from '../roles/roles.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { CredencialesService, HORAS_INVITACION, HORAS_RECUPERACION } from '../credenciales/credenciales.service';
import { TipoCredencial } from '../credenciales/credencial-token.entity';
import { CorreoService } from '../correo/correo.service';
import { plantillaInvitacion, plantillaRecuperacion } from '../correo/plantillas';

/** Contexto del actor autenticado (subconjunto del JWT). */
export interface Actor {
  sub: string;
  rol: string;
  tenant?: string | null;
}

/** Vista pública de un usuario (sin el hash de contraseña). */
export interface UsuarioDto {
  id: string;
  username: string;
  nombre: string;
  rol: string;
  tenant: string | null;
  activo: boolean;
  /** Agencia a la que pertenece (agencias.id). */
  agenciaId: string | null;
  /** Canales de atención asignados (canales.id). */
  canales: string[];
  /** Extensión de la planta telefónica; null si no atiende llamadas por PBX. */
  extension: string | null;
  /**
   * ¿Tiene clave SIP guardada? Sí o no, nunca el valor.
   *
   * La clave en sí solo sale por la ruta del softphone y solo hacia su propio
   * duño. Un listado de administración que la trajera la pondría en la
   * pantalla de cualquiera que gestione usuarios.
   */
  tieneClaveSip: boolean;
  /** "@" de WhatsApp para la integración CTI/YACO; null si no aplica. */
  whatsappHandle: string | null;
  /**
   * Cuándo vinculó su aplicación de autenticación; null si todavía no lo ha
   * hecho. Solo la FECHA: el secreto no sale de aquí jamás. Le dice al
   * administrador si tiene algo que restablecer antes de pulsar el botón.
   */
  mfaActivadoEn: Date | null;
  /** Correo del funcionario; null en las cuentas anteriores al campo. */
  correo: string | null;
  /** Con fecha, la persona demostró que el buzón es suyo al usar un enlace. */
  correoVerificadoEn: Date | null;
  /** Cuándo salió la última invitación. Con `correoVerificadoEn` nulo: pendiente de activar. */
  invitacionEnviadaEn: Date | null;
  /** Por qué falló el último envío, si falló. Lo ve el administrador en la lista. */
  invitacionError: string | null;
  /** El proveedor reportó que la dirección rebota. */
  correoRebotadoEn: Date | null;
}

export interface CrearUsuarioDto {
  username: string;
  nombre: string;
  /**
   * Contraseña inicial. OPCIONAL: el camino recomendado es dejarla vacía y
   * dar un `correo`, para que la persona elija la suya por invitación. Una
   * contraseña que un administrador inventa la conocen dos personas, y la de
   * la segunda suele viajar por WhatsApp.
   */
  contrasena?: string;
  /** A dónde va la invitación. Sin esto o sin `contrasena`, no se puede crear. */
  correo?: string | null;
  rol: string;
  tenant?: string;
  agenciaId?: string | null;
  canales?: string[];
  extension?: string | null;
  whatsappHandle?: string | null;
}

export interface ActualizarUsuarioDto {
  nombre?: string;
  correo?: string | null;
  rol?: string;
  activo?: boolean;
  contrasena?: string;
  agenciaId?: string | null;
  canales?: string[];
  extension?: string | null;
  whatsappHandle?: string | null;
}

/**
 * Directorio de usuarios (PostgreSQL, bcrypt). El `username` es único en TODA
 * la plataforma, no solo dentro de su tenant: dos secads no pueden tener cada
 * uno un "carlos" propio. La gestión está acotada por ámbito: el superadmin
 * gobierna todos los tenants; el admin, solo el suyo. El rol que se asigna
 * debe existir en el tenant (RBAC dinámico, ver RolesService).
 */
@Injectable()
export class UsuariosService implements OnModuleInit {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectRepository(UsuarioEntity)
    private readonly repo: Repository<UsuarioEntity>,
    private readonly roles: RolesService,
    private readonly catalogos: CatalogosService,
    private readonly credenciales: CredencialesService,
    private readonly correo: CorreoService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * La cuenta activa de ESE tenant con ese username. Úsese siempre que el
   * tenant ya se conozca (viaja en el JWT) — es la búsqueda sin ambigüedad.
   * `tenant: null` es el caso del superadmin (no pertenece a ningún tenant).
   */
  /**
   * La cuenta por su id. Es la búsqueda sin ambigüedad posible: el username
   * es único en la plataforma salvo por duplicados heredados, así que todo lo
   * que continúe una sesión ya empezada —el segundo factor— debe usar esta.
   */
  buscarPorId(id: string): Promise<UsuarioEntity | null> {
    return this.repo.findOne({ where: { id, activo: true } });
  }

  buscarPorUsernameYTenant(username: string, tenant: string | null): Promise<UsuarioEntity | null> {
    return this.repo.findOne({
      where: { username: username.trim().toLowerCase(), tenant: tenant ?? IsNull(), activo: true },
    });
  }

  /**
   * Cuentas activas con ese username. El username es único en toda la
   * plataforma, así que en el caso normal hay a lo sumo una — pero instancias
   * dadas de alta antes de esta restricción pueden conservar duplicados
   * heredados (ver la migración `UsernameUnicoGlobal`), así que el login
   * sigue resolviendo por contraseña en vez de asumir una sola coincidencia.
   */
  private buscarActivosPorUsername(username: string): Promise<UsuarioEntity[]> {
    return this.repo.find({ where: { username: username.trim().toLowerCase(), activo: true } });
  }

  /**
   * Valida credenciales. Prueba la contraseña contra cada cuenta activa con
   * ese username hasta encontrar la que corresponde — cubre tanto el caso
   * normal (una sola cuenta) como un eventual duplicado heredado.
   */
  async validar(username: string, contrasena: string): Promise<UsuarioEntity | null> {
    const candidatos = await this.buscarActivosPorUsername(username);
    for (const u of candidatos) {
      if (await bcrypt.compare(contrasena, u.passwordHash)) return u;
    }
    return null;
  }

  /**
   * ¿Ya existe una cuenta con ese username, en cualquier tenant? Para la
   * validación en vivo del formulario de alta (antes de intentar crear) y
   * para el chequeo que hace `crear()` mismo.
   */
  async existeUsername(username: string): Promise<boolean> {
    const valor = username?.trim().toLowerCase();
    if (!valor) return false;
    return !!(await this.repo.findOne({ where: { username: valor } }));
  }

  // --- Gestión (usuarios.gestionar) -----------------------------------------

  /**
   * Usuarios del tenant en gestión — el propio para un admin de tenant, o el
   * elegido en la barra superior para el superadmin (`@Tenant()` ya resuelve
   * cuál es). Antes el superadmin veía TODOS los tenants mezclados sin
   * importar cuál tuviera seleccionado; quedaba fuera del aislamiento que sí
   * respeta el resto de Administración (roles, agencias, canales…).
   */
  async listar(tenant: string): Promise<UsuarioDto[]> {
    const usuarios = await this.repo.find({ where: { tenant }, order: { username: 'ASC' } });
    return usuarios.map((u) => this.aDto(u));
  }

  async crear(actor: Actor, dto: CrearUsuarioDto): Promise<UsuarioDto> {
    const username = dto.username?.trim().toLowerCase();
    if (!username || !dto.nombre?.trim()) {
      throw new BadRequestException('Usuario y nombre son obligatorios.');
    }
    const correo = normalizarCorreo(dto.correo);
    // Una de las dos, no ninguna: o la persona recibe una invitación para
    // elegir su clave, o el administrador pone una inicial. Sin ninguna, la
    // cuenta nacería sin forma de entrar.
    if (!correo && !dto.contrasena) {
      throw new BadRequestException(
        'Indique un correo para enviarle la invitación, o una contraseña inicial.',
      );
    }
    if (dto.contrasena) this.validarContrasena(dto.contrasena);
    const { rol, tenant } = await this.resolverAmbito(actor, dto.rol, dto.tenant);

    // Único en TODA la plataforma: si "carlos" ya existe en otro secad, no
    // se puede volver a crear aquí — de lo contrario, al iniciar sesión con
    // ese username y esa contraseña, no habría forma de saber a cuál de los
    // dos tenants pertenece quien entra.
    if (await this.existeUsername(username)) {
      throw new ConflictException('Ese nombre de usuario ya existe en otra instancia. Elija uno distinto.');
    }

    const { agenciaId, canales } = await this.resolverAdscripcion(tenant, dto.agenciaId, dto.canales);
    const extension = await this.resolverExtension(tenant, dto.extension, null);
    const whatsappHandle = await this.resolverWhatsappHandle(tenant, dto.whatsappHandle, null);

    const u = await this.repo.save(
      this.repo.create({
        username,
        nombre: dto.nombre.trim(),
        // Sin contraseña inicial queda un hash de 32 bytes aleatorios que
        // nadie conoce: la columna sigue siendo NOT NULL y la cuenta existe,
        // pero no hay ninguna cadena que abra esa sesión. La única puerta es
        // el enlace de invitación.
        passwordHash: dto.contrasena
          ? await bcrypt.hash(dto.contrasena, 10)
          : await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        rol,
        tenant,
        correo,
        agenciaId,
        canales,
        extension,
        whatsappHandle,
        activo: true,
      }),
    );

    // El envío va después de guardar y NO puede tumbar el alta: si Brevo está
    // caído, la cuenta existe igual y el administrador ve el error y puede
    // pedir el enlace para pasarlo por otra vía.
    if (correo) await this.emitirYEnviar(u, 'invitacion', actor.sub);

    return this.aDto(await this.repo.findOneOrFail({ where: { id: u.id } }));
  }

  // ── Invitación y recuperación ──────────────────────────────────────────────

  /**
   * Emite un enlace de un solo uso y lo manda al correo de la cuenta.
   *
   * No lanza: devuelve qué pasó. El enlace se devuelve SOLO cuando el envío
   * falló — si el correo salió, el administrador no necesita tener en la mano
   * una credencial que acabaría reenviada por WhatsApp. Para el caso del
   * servidor que acepta el correo y lo descarta en silencio está la acción
   * explícita de pedir el enlace sin enviarlo (`invitar` con `enviar: false`).
   */
  private async emitirYEnviar(
    u: UsuarioEntity, tipo: TipoCredencial, creadoPor: string | null,
  ): Promise<{ ok: boolean; enlace?: string; error?: string }> {
    if (!u.correo) return { ok: false, error: 'La cuenta no tiene correo registrado.' };

    const { token } = await this.credenciales.emitir(u.id, tipo, creadoPor);
    const enlace = enlaceDe(token);
    const horas = tipo === 'invitacion' ? HORAS_INVITACION : HORAS_RECUPERACION;
    const plantilla = tipo === 'invitacion'
      ? plantillaInvitacion(u.nombre, u.username, enlace, horas)
      : plantillaRecuperacion(u.nombre, u.username, enlace, horas);

    const r = await this.correo.enviar({ ...plantilla, para: u.correo });

    u.invitacionEnviadaEn = new Date();
    u.invitacionError = r.ok ? null : (r.error ?? 'No se pudo enviar.');
    await this.repo.save(u);

    return r.ok ? { ok: true } : { ok: false, enlace, error: u.invitacionError ?? undefined };
  }

  /**
   * Un administrador reenvía la invitación, o pide el enlace sin enviarlo.
   * Emitir uno nuevo anula el anterior: nunca quedan dos enlaces vivos.
   */
  async invitar(
    actor: Actor, id: string, enviar = true,
  ): Promise<{ username: string; tenant: string | null; ok: boolean; enlace?: string; error?: string }> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (actor.rol !== 'superadmin' && u.tenant !== actor.tenant) {
      throw new ForbiddenException('No puede gestionar usuarios de otro tenant.');
    }
    if (!u.correo) {
      throw new BadRequestException('La cuenta no tiene correo. Regístrele uno antes de invitarla.');
    }

    if (!enviar) {
      // El administrador se lleva el enlace para entregarlo en persona o por
      // radio. Queda en la bitácora porque es, literalmente, entregar una llave.
      const { token } = await this.credenciales.emitir(u.id, 'invitacion', actor.sub);
      return { username: u.username, tenant: u.tenant ?? null, ok: true, enlace: enlaceDe(token) };
    }

    const r = await this.emitirYEnviar(u, 'invitacion', actor.sub);
    return { username: u.username, tenant: u.tenant ?? null, ...r };
  }

  /**
   * Registrar el correo de una cuenta que no tenía, y mandarle la invitación.
   *
   * Existe por las cuentas anteriores a que FALCON tuviera correos: se crearon
   * con una contraseña que puso un administrador y no tienen a dónde mandarles
   * nada. Mientras sigan así no pueden recuperar su clave solas, y el día que
   * alguien la olvide hay que atenderlo a mano.
   *
   * Es UN paso y no dos a propósito. Hacerlo con el PATCH de siempre y después
   * el botón de invitar deja un estado intermedio —cuenta con correo y sin
   * invitación— que no se ve en ninguna pantalla: la fila deja de decir «sin
   * correo» y nadie vuelve a mirarla, con la persona igual de bloqueada que
   * antes. Aquí, o pasan las dos cosas o la bitácora dice cuál falló.
   */
  async registrarCorreo(
    actor: Actor, id: string, correo: string, enviar = true,
  ): Promise<{
    username: string; tenant: string | null; correo: string;
    yaTenia: boolean; ok: boolean; enlace?: string; error?: string;
  }> {
    const limpio = normalizarCorreo(correo);
    if (!limpio) throw new BadRequestException('Escriba un correo válido.');

    const antes = await this.repo.findOne({ where: { id } });
    if (!antes) throw new NotFoundException('Usuario no encontrado.');
    const yaTenia = !!antes.correo;

    // Pasa por `actualizar` y no por un `save` propio: ahí vive la comprobación
    // de tenant, la anulación de los enlaces vivos de la dirección anterior y
    // el borrado del estado de verificación. Duplicar eso aquí sería la forma
    // de que un día dejen de coincidir.
    await this.actualizar(actor, id, { correo: limpio });
    const r = await this.invitar(actor, id, enviar);
    return { ...r, correo: limpio, yaTenia };
  }

  /**
   * Autoservicio: «olvidé mi contraseña». Se pide por USERNAME, no por correo
   * —así no hay que decidir a qué cuenta pertenece una dirección compartida— y
   * no devuelve nada: quien pregunta no debe poder averiguar si un usuario
   * existe, ni si tiene correo registrado.
   */
  async solicitarRecuperacion(username: string): Promise<void> {
    if (!String(username ?? '').trim()) return;
    const candidatos = await this.buscarActivosPorUsername(username);
    for (const u of candidatos) {
      if (u.correo) await this.emitirYEnviar(u, 'recuperacion', 'autoservicio');
    }
  }

  /** Qué cuenta abre este enlace, para que la página salude antes de pedir la clave. */
  async datosDeToken(token: string): Promise<{ username: string; nombre: string; tipo: TipoCredencial }> {
    const fila = await this.credenciales.validar(token);
    const u = fila ? await this.repo.findOne({ where: { id: fila.usuarioId, activo: true } }) : null;
    if (!fila || !u) throw new NotFoundException('El enlace no es válido, ya se usó o venció.');
    return { username: u.username, nombre: u.nombre, tipo: fila.tipo };
  }

  /**
   * El dueño del enlace elige su contraseña. Consumir el token es lo que
   * VERIFICA el correo: solo quien abre ese buzón pudo llegar hasta aquí.
   */
  async establecerPorToken(token: string, contrasena: string): Promise<{ username: string }> {
    this.validarContrasena(contrasena ?? '');
    const fila = await this.credenciales.consumir(token);
    if (!fila) throw new NotFoundException('El enlace no es válido, ya se usó o venció.');

    const u = await this.repo.findOne({ where: { id: fila.usuarioId, activo: true } });
    if (!u) throw new NotFoundException('El enlace no es válido, ya se usó o venció.');

    u.passwordHash = await bcrypt.hash(contrasena, 10);
    u.correoVerificadoEn = new Date();
    u.invitacionError = null;
    u.correoRebotadoEn = null;
    u.correoRebotadoMotivo = null;
    await this.repo.save(u);

    // Cualquier otro enlace vivo de esta cuenta muere aquí.
    await this.credenciales.anularVivos(u.id);
    return { username: u.username };
  }

  /** El proveedor avisó que la dirección rebota. Lo ve el administrador en la lista. */
  async registrarRebote(correo: string, motivo: string): Promise<number> {
    const valor = normalizarCorreo(correo);
    if (!valor) return 0;
    const r = await this.repo.update(
      { correo: valor },
      { correoRebotadoEn: new Date(), correoRebotadoMotivo: (motivo ?? '').slice(0, 300) },
    );
    return r.affected ?? 0;
  }

  /**
   * Quita el enrolamiento del doble factor: la próxima vez que entre, el
   * usuario verá otra vez el código QR y vinculará el teléfono nuevo.
   *
   * Es el camino para quien cambió de celular o lo perdió. La identidad la
   * verifica quien restablece —en persona, por radio o por teléfono—, que en
   * una central con supervisor de turno es más confiable que un código enviado
   * a un buzón.
   *
   * Lleva la MISMA guarda de instancia que `actualizar`: un administrador de
   * un municipio no puede tocar las cuentas de otro. Reescribirla aparte era
   * la forma segura de que las dos se separaran con el tiempo.
   */
  async restablecerMfa(actor: Actor, id: string): Promise<{ username: string; tenant: string | null; teniaMfa: boolean }> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (actor.rol !== 'superadmin' && u.tenant !== actor.tenant) {
      throw new ForbiddenException('No puede gestionar usuarios de otro tenant.');
    }

    const teniaMfa = !!u.mfaSecreto;
    u.mfaSecreto = null;
    u.mfaActivadoEn = null;
    u.mfaUltimoContador = null;
    // También se levanta el bloqueo: quien llega aquí tras cinco intentos
    // fallidos no debería tener que esperar quince minutos más.
    u.mfaIntentosFallidos = 0;
    u.mfaBloqueoHasta = null;
    await this.repo.save(u);

    return { username: u.username, tenant: u.tenant ?? null, teniaMfa };
  }

  async actualizar(actor: Actor, id: string, dto: ActualizarUsuarioDto): Promise<UsuarioDto> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (actor.rol !== 'superadmin' && u.tenant !== actor.tenant) {
      throw new ForbiddenException('No puede gestionar usuarios de otro tenant.');
    }
    if (u.rol === 'superadmin') {
      // La cuenta superadmin es la llave maestra: degradarla o desactivarla deja
      // el sistema sin nadie que pueda entrar a Administración.
      if (dto.rol && dto.rol !== 'superadmin') {
        throw new ForbiddenException('No se puede cambiar el rol del superadmin.');
      }
      if (dto.activo === false) throw new ForbiddenException('No se puede desactivar al superadmin.');
    }
    if (dto.rol) u.rol = (await this.resolverAmbito(actor, dto.rol, u.tenant ?? undefined)).rol;
    if (dto.nombre?.trim()) u.nombre = dto.nombre.trim();
    if (typeof dto.activo === 'boolean') u.activo = dto.activo;
    if (dto.contrasena) {
      this.validarContrasena(dto.contrasena);
      u.passwordHash = await bcrypt.hash(dto.contrasena, 10);
      // La clave cambió por otra vía: cualquier enlace de activación o de
      // recuperación que anduviera por un buzón deja de valer ahora.
      await this.credenciales.anularVivos(u.id);
    }
    if (dto.correo !== undefined) {
      const nuevo = normalizarCorreo(dto.correo);
      if (nuevo !== (u.correo ?? null)) {
        // Dirección distinta: lo que se hubiera verificado era de la anterior.
        u.correo = nuevo;
        u.correoVerificadoEn = null;
        u.correoRebotadoEn = null;
        u.correoRebotadoMotivo = null;
        await this.credenciales.anularVivos(u.id);
      }
    }
    if (dto.agenciaId !== undefined || dto.canales !== undefined) {
      const adscripcion = await this.resolverAdscripcion(
        u.tenant ?? null,
        dto.agenciaId !== undefined ? dto.agenciaId : u.agenciaId,
        dto.canales !== undefined ? dto.canales : u.canales ?? [],
      );
      u.agenciaId = adscripcion.agenciaId;
      u.canales = adscripcion.canales;
    }
    if (dto.extension !== undefined) {
      u.extension = await this.resolverExtension(u.tenant ?? null, dto.extension, u.id);
    }
    if (dto.whatsappHandle !== undefined) {
      u.whatsappHandle = await this.resolverWhatsappHandle(u.tenant ?? null, dto.whatsappHandle, u.id);
    }
    return this.aDto(await this.repo.save(u));
  }

  /**
   * Mínimo de la contraseña al crearla o cambiarla. Las cuentas abren la
   * bandeja del 123: una contraseña trivial es una puerta, no una clave. Se
   * aplica solo hacia adelante — las cuentas existentes siguen entrando igual
   * hasta su próximo cambio.
   */
  private validarContrasena(contrasena: string): void {
    if (contrasena.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');
    }
  }

  /**
   * Autoservicio: el propio funcionario cambia SU contraseña, demostrando que
   * conoce la actual — no depende de que un administrador se la resetee (y el
   * administrador deja de conocer las claves de su gente).
   */
  async cambiarContrasenaPropia(
    username: string, tenant: string | null, actual: string, nueva: string,
  ): Promise<{ ok: true }> {
    const u = await this.buscarPorUsernameYTenant(username, tenant);
    if (!u) throw new ForbiddenException('La cuenta no existe o fue desactivada.');
    if (!actual || !(await bcrypt.compare(actual, u.passwordHash))) {
      throw new ForbiddenException('La contraseña actual no es correcta.');
    }
    this.validarContrasena(nueva ?? '');
    u.passwordHash = await bcrypt.hash(nueva, 10);
    await this.repo.save(u);
    // Quien ya entró y cambió su clave no debe dejar atrás un enlace de
    // recuperación vivo en su buzón.
    await this.credenciales.anularVivos(u.id);
    return { ok: true };
  }

  /**
   * Extensión del funcionario, en un secad concreto: única por tenant, para
   * que el webhook de la PBX pueda resolver sin ambigüedad a quién dirigir la
   * llamada que el ACD ya enrutó a esa extensión.
   */
  private async resolverExtension(
    tenant: string | null, extension: string | null | undefined, propioId: string | null,
  ): Promise<string | null> {
    if (extension === undefined) return null;
    const valor = extension?.trim();
    if (!valor) return null;
    if (!tenant) throw new BadRequestException('Solo un usuario de un tenant puede tener extensión.');
    const enUso = await this.repo.findOne({ where: { tenant, extension: valor } });
    if (enUso && enUso.id !== propioId) {
      throw new ConflictException('Esa extensión ya está asignada a otro funcionario.');
    }
    return valor;
  }

  /**
   * Guarda (o borra) la clave SIP de una extensión. Solo de escritura.
   *
   * Es lo que permite contestar DENTRO de FALCON: el navegador del operador se
   * registra como teléfono en la central con la clave de SU extensión. Se
   * cifra en reposo y nunca vuelve en un listado de administración —ahi solo
   * se dice si está puesta—; la única ruta por la que sale es la del
   * softphone, y solo hacia su propio duño.
   *
   * Mandar vacío la borra, que es cómo se le quita el softphone a alguien sin
   * tocarle la extensión ni nada más.
   */
  async registrarClaveSip(id: string, clave: string | null): Promise<{ tieneClaveSip: boolean }> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    const valor = clave?.trim();
    if (valor && !u.extension?.trim()) {
      // Sin extensión la clave no sirve para nada: no hay identidad con la que
      // registrarse. Decirlo evita el misterio de «ya la puse y no funciona».
      throw new BadRequestException(
        'Primero asigne la extensión: la clave SIP es de una extensión, y sin ella no hay con qué registrarse.',
      );
    }
    u.sipClave = valor ? cifrar(valor, this.llaveDeCifrado()) : null;
    await this.repo.save(u);
    return { tieneClaveSip: !!u.sipClave };
  }

  /**
   * La clave SIP en claro, para entregarla al navegador de su duño.
   *
   * Si la llave de cifrado del servidor cambió, devuelve vacío y lo registra
   * en vez de reventar: así el softphone queda «no disponible» con su motivo
   * —que es lo correcto— y el resto de la telefonía sigue funcionando.
   */
  claveSipDe(u: UsuarioEntity | null): string {
    if (!u?.sipClave) return '';
    try {
      return descifrar(u.sipClave, this.llaveDeCifrado());
    } catch {
      this.logger.error(
        `No se pudo descifrar la clave SIP de «${u.username}»: la llave de cifrado cambió. `
        + 'Vuelva a registrarla en Administración → Usuarios.',
      );
      return '';
    }
  }

  private llaveDeCifrado(): string {
    return process.env.JWT_SECRET ?? '';
  }

  /** El funcionario dueño de esa extensión en el secad; null si no hay match. */
  async buscarPorExtension(tenant: string, extension: string): Promise<UsuarioEntity | null> {
    const valor = extension?.trim();
    if (!valor) return null;
    return this.repo.findOne({ where: { tenant, extension: valor, activo: true } });
  }

  /**
   * "@" de WhatsApp del funcionario, único por tenant — mismo propósito que
   * `resolverExtension`, para la integración CTI/YACO.
   */
  private async resolverWhatsappHandle(
    tenant: string | null, handle: string | null | undefined, propioId: string | null,
  ): Promise<string | null> {
    if (handle === undefined) return null;
    const valor = handle?.trim().replace(/^@/, '') || null;
    if (!valor) return null;
    if (!tenant) throw new BadRequestException('Solo un usuario de un tenant puede tener "@" de WhatsApp.');
    const enUso = await this.repo.findOne({ where: { tenant, whatsappHandle: valor } });
    if (enUso && enUso.id !== propioId) {
      throw new ConflictException('Ese "@" de WhatsApp ya está asignado a otro funcionario.');
    }
    return valor;
  }

  /** El funcionario dueño de ese "@" de WhatsApp en el secad; null si no hay match. */
  async buscarPorWhatsappHandle(tenant: string, handle: string): Promise<UsuarioEntity | null> {
    const valor = handle?.trim().replace(/^@/, '');
    if (!valor) return null;
    return this.repo.findOne({ where: { tenant, whatsappHandle: valor, activo: true } });
  }

  /**
   * Valida el rol/tenant que el actor intenta asignar y devuelve los efectivos.
   *  - superadmin: 'superadmin' (sin tenant) o cualquier rol existente del tenant.
   *  - resto: cualquier rol existente de su propio tenant (nunca superadmin).
   */
  private async resolverAmbito(actor: Actor, rol: string, tenant?: string | null): Promise<{ rol: string; tenant: string | null }> {
    if (actor.rol === 'superadmin') {
      if (rol === 'superadmin') return { rol, tenant: null };
      if (!tenant?.trim()) throw new BadRequestException('Debe indicar el tenant del usuario.');
      if (!(await this.roles.existe(tenant.trim(), rol))) {
        throw new BadRequestException('Ese rol no existe en el tenant.');
      }
      return { rol, tenant: tenant.trim() };
    }
    if (rol === 'superadmin') throw new ForbiddenException('No puede asignar el rol superadmin.');
    const t = actor.tenant ?? '';
    if (!(await this.roles.existe(t, rol))) {
      throw new ForbiddenException('No puede asignar ese rol.');
    }
    return { rol, tenant: t };
  }

  /**
   * Valida la agencia y el canal del funcionario: ambos deben existir en su
   * secad, y el canal debe pertenecer a su agencia — un funcionario solo
   * atiende las colas de la entidad de la que hace parte.
   *
   * UN canal por funcionario, no varios. El tablero de Despacho muestra una
   * bandeja a la vez porque un mismo caso tiene un estado distinto en cada
   * canal (ver CasoCanalService): con dos canales asignados, el funcionario no
   * sabría cuál de los dos está mirando. La columna sigue siendo una lista por
   * compatibilidad con lo ya guardado, pero aquí se corta en uno.
   */
  private async resolverAdscripcion(
    tenant: string | null,
    agenciaId?: string | null,
    canales?: string[] | null,
  ): Promise<{ agenciaId: string | null; canales: string[] }> {
    if (!tenant || !agenciaId) return { agenciaId: null, canales: [] };
    const agencia = await this.catalogos.agenciaDe(tenant, agenciaId);
    const pedidos = canales ?? [];
    if (pedidos.length > 1) {
      throw new BadRequestException('Un funcionario atiende un solo canal: elija uno.');
    }
    const validos = await this.catalogos.validarCanales(tenant, pedidos, agencia.id);
    return { agenciaId: agencia.id, canales: validos.slice(0, 1).map((c) => c.id) };
  }

  private aDto(u: UsuarioEntity): UsuarioDto {
    return {
      id: u.id, username: u.username, nombre: u.nombre, rol: u.rol,
      tenant: u.tenant ?? null, activo: u.activo,
      agenciaId: u.agenciaId ?? null, canales: u.canales ?? [],
      extension: u.extension ?? null,
      tieneClaveSip: !!u.sipClave,
      whatsappHandle: u.whatsappHandle ?? null,
      mfaActivadoEn: u.mfaActivadoEn ?? null,
      correo: u.correo ?? null,
      correoVerificadoEn: u.correoVerificadoEn ?? null,
      invitacionEnviadaEn: u.invitacionEnviadaEn ?? null,
      invitacionError: u.invitacionError ?? null,
      correoRebotadoEn: u.correoRebotadoEn ?? null,
    };
  }

  /**
   * Restaura la cuenta `superadmin` si su rol o su tenant quedaron desviados
   * (edición manual en la base, importación de datos, migración a medias). Sin
   * el rol reservado no resuelve permisos: pierde el acceso a Administración y
   * recibe 403 en todo, sin forma de arreglarlo desde la interfaz.
   */
  private async repararSuperadmin(): Promise<void> {
    const u = await this.repo.findOne({ where: { username: 'superadmin' } });
    if (!u) return;
    if (u.rol === 'superadmin' && u.tenant === null && u.activo) return;
    const antes = `rol=${u.rol} tenant=${u.tenant ?? 'null'} activo=${u.activo}`;
    u.rol = 'superadmin';
    u.tenant = null;
    u.activo = true;
    await this.repo.save(u);
    this.logger.warn(`Cuenta superadmin restaurada a sus valores reservados (estaba con ${antes}).`);
  }

  /**
   * Siembra el superadmin global y los usuarios demo del tenant 'demo'.
   * Idempotente por `username` (la llave única real de la tabla): en una base
   * existente agrega solo lo que falte, y un fallo del seed no impide arrancar.
   */
  private async seed(): Promise<void> {
    try {
      const hash = await bcrypt.hash('demo', 10);
      const asegurar = async (f: Partial<UsuarioEntity>) => {
        if (await this.repo.findOne({ where: { username: f.username } })) return;
        await this.repo.save(this.repo.create({ ...f, passwordHash: hash, activo: true }));
      };

      await asegurar({ username: 'superadmin', nombre: 'Super Administrador', rol: 'superadmin', tenant: null });
      await this.repararSuperadmin();

      if (!(await this.repo.findOne({ where: { tenant: 'demo' } }))) {
        await asegurar({ username: 'admin1', nombre: 'Administrador', rol: 'admin', tenant: 'demo' });
        await asegurar({ username: 'supervisor1', nombre: 'Supervisor Uno', rol: 'supervisor', tenant: 'demo' });
        await asegurar({ username: 'operador1', nombre: 'Operador Uno', rol: 'operador', tenant: 'demo' });
      }

      // Los usuarios de demostración quedan adscritos a la agencia
      // administrativa: sin agencia no podrían recepcionar con origen.
      await this.catalogos.asegurarSeed('demo');
      const otras = (await this.catalogos.listarAgencias('demo')).find((a) => a.codigo === 'OTRAS');
      if (otras) {
        await this.repo.update({ tenant: 'demo', agenciaId: IsNull() }, { agenciaId: otras.id });
      }
    } catch (e) {
      this.logger.warn(`Seed de usuarios demo omitido: ${(e as Error).message}`);
    }
  }
}

/**
 * Normaliza una dirección: recortada y en minúsculas, o null. Los correos no
 * distinguen mayúsculas en la práctica, y guardar `Juan@X.CO` hace que el
 * rebote y la búsqueda no encuentren la fila.
 */
function normalizarCorreo(valor: string | null | undefined): string | null {
  const v = String(valor ?? '').trim().toLowerCase();
  if (!v) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    throw new BadRequestException('El correo no tiene una forma válida.');
  }
  return v;
}

/**
 * El enlace que va en el correo. `URL_PUBLICA` es el origen desde el que la
 * gente abre FALCON; sin ella el enlace sale relativo y no sirve en un correo,
 * así que se avisa al construirlo en vez de mandar algo roto.
 */
function enlaceDe(token: string): string {
  const base = (process.env.URL_PUBLICA ?? '').replace(/\/+$/, '');
  return `${base}/activar/${token}`;
}
