import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EntityManager, In } from 'typeorm';
import { VideoSesionEntity } from './video-sesion.entity';
import { VideoChatMensajeEntity } from './video-chat-mensaje.entity';
import { VideoTokenService } from './video-token.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { SmsService } from '../sms/sms.service';
import { CasoEntity } from '../casos/caso.entity';

/** Estados en los que la llamada todavía se puede retomar. */
const ESTADOS_VIVOS = ['PENDIENTE', 'CONECTADA'] as const;

/** Prefijo de la ruta pública del ciudadano. Corto a propósito: va en un SMS. */
const RUTA_PUBLICA = '/v';

/**
 * Alfabeto del código público. Sin 0/O ni 1/l/I: el despachador tiene que
 * poder DICTARLO por teléfono cuando el SMS no llega, y esas parejas son las
 * que se confunden al oído.
 */
const ALFABETO = '23456789abcdefghjkmnpqrstuvwxyz';

/**
 * Largo del código. 12 caracteres sobre 31 símbolos son ~59 bits: adivinarlo
 * a ciegas no es viable en los minutos que vive una llamada, y el enlace
 * completo cabe holgado en un mensaje de texto.
 */
const LARGO_CODIGO = 12;

/** Cuántas veces reintentar si el código sorteado ya existía. */
const INTENTOS_CODIGO = 5;

@Injectable()
export class VideollamadaService {
  private readonly logger = new Logger(VideollamadaService.name);

  constructor(
    private readonly rls: TenantRlsService,
    private readonly tokens: VideoTokenService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Abre una videollamada para un caso y manda el enlace por SMS.
   *
   * Es IDEMPOTENTE por caso: si ya hay una vigente, devuelve esa misma en vez
   * de crear otra. Sin eso, un despachador que refresca la pantalla generaba un
   * enlace nuevo y dejaba al ciudadano conectado a una sesión que ya nadie
   * atiende — con el ciudadano viendo que "hay alguien" y nadie del otro lado.
   */
  async crear(
    tenant: string,
    casoId: string,
    numeroTelefono: string,
    despachador: string,
    /** Origen por el que llegó la petición, deducido del proxy. Ver baseWeb(). */
    origenSolicitud?: string | null,
  ): Promise<{
    sesionId: string; token: string; enlace: string; expiraEn: Date;
    smsEnviado: boolean; mensaje: string; reutilizada: boolean;
  }> {
    if (!casoId) throw new BadRequestException('Falta el caso.');

    const caso = await this.rls.conTenant(tenant, (m) =>
      m.getRepository(CasoEntity).findOne({ where: { tenant, id: casoId } }));
    if (!caso) throw new NotFoundException('Caso no encontrado.');

    const vigente = await this.activaDe(tenant, casoId);
    if (vigente) {
      const token = this.tokens.crear(
        { sesionId: vigente.id, casoId, tenant, despachador }, vigente.expiraEn);
      return {
        sesionId: vigente.id, token, enlace: this.enlace(await this.claveDe(vigente), origenSolicitud), expiraEn: vigente.expiraEn,
        smsEnviado: false, reutilizada: true,
        mensaje: 'Ya había una videollamada en curso para este caso — se reutiliza el mismo enlace.',
      };
    }

    const expiraEn = new Date(Date.now() + this.tokens.minutosPorDefecto * 60_000);

    // El código es único por instancia. Si el sorteo choca se vuelve a sortear,
    // en vez de reventarle la llamada al despachador. El reintento va POR FUERA
    // de la transacción: en PostgreSQL un INSERT fallido la deja abortada y
    // cualquier sentencia siguiente muere con «current transaction is aborted».
    let sesion: VideoSesionEntity | null = null;
    for (let intento = 1; intento <= INTENTOS_CODIGO && !sesion; intento++) {
      try {
        sesion = await this.rls.conTenant(tenant, (m) => {
          const repo = m.getRepository(VideoSesionEntity);
          return repo.save(repo.create({
            tenant, casoId, estado: 'PENDIENTE',
            usuarioDespachador: despachador,
            numeroTelefono: numeroTelefono?.trim() || null,
            codigo: this.sortearCodigo(),
            expiraEn,
          }));
        });
      } catch (e) {
        if (intento >= INTENTOS_CODIGO) throw e;
      }
    }
    if (!sesion) throw new BadRequestException('No fue posible abrir la videollamada.');

    const token = this.tokens.crear({ sesionId: sesion.id, casoId, tenant, despachador }, expiraEn);
    const enlace = this.enlace(await this.claveDe(sesion), origenSolicitud);

    // Sin dominio configurado el enlace sale sin él: no se manda. Un SMS con
    // «/v/itagui-k7m2x9qr4t8v» le hace creer al ciudadano que ya puede
    // conectarse y lo deja tocando un enlace muerto en plena emergencia.
    if (!this.baseWeb(origenSolicitud)) {
      this.logger.error(
        'No se pudo determinar el dominio público: ni FRONTEND_URL está definida ni el ' +
        'proxy declaró el host de la petición. El enlace sale sin dominio y el SMS no se envía.');
      return {
        sesionId: sesion.id, token, enlace, expiraEn, smsEnviado: false, reutilizada: false,
        mensaje: 'No se pudo armar el enlace: el servidor no sabe con qué dominio público ' +
          'se le alcanza. Avise al administrador (FRONTEND_URL).',
      };
    }

    // El SMS puede fallar y la llamada tiene que quedar abierta igual: el
    // despachador ya tiene el enlace y puede dictarlo por teléfono.
    const smsEnviado = numeroTelefono?.trim()
      ? await this.sms.enviar(
          numeroTelefono.trim(),
          `FALCON CAD - Linea 123. Para atenderlo por video, abra este enlace: ${enlace}`)
      : false;

    return {
      sesionId: sesion.id, token, enlace, expiraEn, smsEnviado, reutilizada: false,
      mensaje: smsEnviado
        ? 'Enlace enviado por SMS.'
        : 'No se pudo enviar el SMS — copie el enlace o díctelo al ciudadano.',
    };
  }

  /**
   * La videollamada en curso de un caso, si la hay. Es lo que permite
   * RECONECTARSE tras un F5, un cambio de pestaña, una caída de red o un relevo
   * de turno: el ciudadano sigue en la misma sesión y no hay que mandarle otro
   * enlace.
   */
  async activaDe(tenant: string, casoId: string): Promise<VideoSesionEntity | null> {
    return this.rls.conTenant(tenant, async (m) => {
      const sesion = await m.getRepository(VideoSesionEntity).findOne({
        where: { tenant, casoId, estado: In([...ESTADOS_VIVOS]) },
        order: { creadoEn: 'DESC' },
      });
      if (!sesion) return null;

      // Vencida sin que nadie entrara: se marca ahora, que es cuando se mira.
      // Un barrido aparte solo para esto no aportaría nada.
      if (sesion.expiraEn.getTime() < Date.now() && sesion.estado === 'PENDIENTE') {
        await m.getRepository(VideoSesionEntity).update(
          { tenant, id: sesion.id }, { estado: 'EXPIRADA' });
        return null;
      }
      return sesion;
    });
  }

  obtener(tenant: string, sesionId: string): Promise<VideoSesionEntity | null> {
    return this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).findOne({ where: { tenant, id: sesionId } }));
  }

  /** Vuelve a firmar el enlace con la vigencia que le queda a la sesión. */
  tokenDe(sesion: VideoSesionEntity, despachador: string): string {
    return this.tokens.crear(
      { sesionId: sesion.id, casoId: sesion.casoId, tenant: sesion.tenant, despachador },
      sesion.expiraEn);
  }

  /**
   * Dominio público de FALCON, con dos fuentes y en este orden:
   *
   *   1. `FRONTEND_URL`, si el administrador la configuró. Manda siempre.
   *   2. El origen por el que llegó la petición, que el reverse proxy declara
   *      en `X-Forwarded-Host` (ver common/origen-publico.ts). Así un
   *      despliegue detrás de nginx funciona sin configurar nada.
   *
   * Lo que NUNCA es fuente es el cuerpo de la petición: este dominio termina
   * dentro de un SMS firmado «FALCON CAD - Linea 123», y aceptarlo de ahí
   * dejaría que cualquier funcionario con sesión le mandara al ciudadano un
   * enlace a un dominio ajeno —con un token válido dentro— pidiéndole cámara y
   * micrófono en nombre de la línea.
   *
   * Se usa `||` y no `??` a propósito: `FRONTEND_URL=` (definida pero vacía, un
   * tropiezo fácil en un .env) también cuenta como no configurada.
   */
  private baseWeb(origenSolicitud?: string | null): string | null {
    const configurado = (this.config.get<string>('FRONTEND_URL') || '').trim().replace(/\/+$/, '');
    if (configurado) return configurado;
    return (origenSolicitud || '').trim().replace(/\/+$/, '') || null;
  }

  enlace(clave: string, origenSolicitud?: string | null): string {
    return `${this.baseWeb(origenSolicitud) ?? ''}${RUTA_PUBLICA}/${clave}`;
  }

  private sortearCodigo(): string {
    let salida = '';
    for (let i = 0; i < LARGO_CODIGO; i++) salida += ALFABETO[randomInt(ALFABETO.length)];
    return salida;
  }

  /**
   * La clave que viaja en la URL: `<instancia>-<codigo>`.
   *
   * La instancia va delante porque las tablas de la videollamada están bajo
   * RLS: sin saber a qué instancia pertenece el código no hay forma de
   * buscarlo sin abrir un hueco en el aislamiento. De paso el enlace dice a
   * qué municipio pertenece, que para el ciudadano es una señal de que el
   * mensaje es legítimo y no un fraude.
   *
   * A una sesión anterior a este cambio se le asigna el código al pedirle el
   * enlace, en vez de dejarla sin uno: así no queda un segundo formato de
   * enlace vivo indefinidamente.
   */
  async claveDe(sesion: VideoSesionEntity): Promise<string> {
    if (!sesion.codigo) {
      sesion.codigo = this.sortearCodigo();
      await this.rls.conTenant(sesion.tenant, (m) =>
        m.getRepository(VideoSesionEntity).update({ id: sesion.id }, { codigo: sesion.codigo }));
    }
    return `${sesion.tenant}-${sesion.codigo}`;
  }

  /**
   * Del código de la URL a la sesión. Devuelve null ante cualquier duda: clave
   * mal formada, instancia inexistente o código que no existe.
   *
   * El corte es por el ÚLTIMO guion: el alfabeto del código no lo incluye, así
   * que un código de instancia con guiones sigue resolviéndose bien.
   */
  async porClave(clave: string): Promise<VideoSesionEntity | null> {
    const corte = (clave ?? '').lastIndexOf('-');
    if (corte <= 0) return null;

    const tenant = clave.slice(0, corte);
    const codigo = clave.slice(corte + 1);
    if (!codigo || codigo.length !== LARGO_CODIGO) return null;

    return this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).findOne({ where: { tenant, codigo } }));
  }

  /** Todas las videollamadas de un caso: la traza que queda cuando ya se cerró. */
  listarPorCaso(tenant: string, casoId: string): Promise<VideoSesionEntity[]> {
    return this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).find({
        where: { tenant, casoId }, order: { creadoEn: 'DESC' },
      }));
  }

  listarChat(tenant: string, sesionId: string): Promise<VideoChatMensajeEntity[]> {
    return this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoChatMensajeEntity).find({
        where: { tenant, sesionId }, order: { creadoEn: 'ASC' },
      }));
  }

  // ── Lo que mueve el gateway ───────────────────────────────────────────────

  async marcarConectada(tenant: string, sesionId: string, ip?: string | null): Promise<void> {
    await this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity)
        .createQueryBuilder()
        .update(VideoSesionEntity)
        .set({ estado: 'CONECTADA', conectadoEn: () => 'COALESCE("conectadoEn", NOW())', ipCiudadano: ip ?? null })
        .where('tenant = :tenant AND id = :id', { tenant, id: sesionId })
        // Una sesión ya finalizada no vuelve a CONECTADA porque alguien
        // reabra el enlace viejo.
        .andWhere('estado IN (:...vivos)', { vivos: [...ESTADOS_VIVOS] })
        .execute());
  }

  async marcarFinalizada(tenant: string, sesionId: string): Promise<void> {
    await this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).update(
        { tenant, id: sesionId },
        { estado: 'FINALIZADA', finalizadoEn: new Date() }));
  }

  async actualizarUbicacion(
    tenant: string, sesionId: string, lat: number, lng: number, precision?: number | null,
  ): Promise<void> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

    await this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).update(
        { tenant, id: sesionId },
        {
          ultimaLat: lat, ultimaLng: lng,
          ultimaPrecision: Number.isFinite(precision as number) ? (precision as number) : null,
          ultimaUbicacionEn: new Date(),
        }));
  }

  /**
   * Guarda un mensaje del chat y lo devuelve. Null si no se pudo: quien llama
   * NO debe relayarlo entonces, para que lo que ve el otro extremo sea
   * exactamente lo que quedó registrado.
   */
  async guardarMensajeChat(
    tenant: string, sesionId: string, emisor: 'DESPACHADOR' | 'CIUDADANO',
    texto: string, usuario?: string | null,
  ): Promise<VideoChatMensajeEntity | null> {
    const limpio = (texto ?? '').trim().slice(0, 2000);
    if (!limpio) return null;

    return this.rls.conTenant(tenant, async (m: EntityManager) => {
      const sesion = await m.getRepository(VideoSesionEntity)
        .findOne({ where: { tenant, id: sesionId } });
      if (!sesion) return null;

      return m.getRepository(VideoChatMensajeEntity).save(
        m.getRepository(VideoChatMensajeEntity).create({
          tenant, sesionId, casoId: sesion.casoId, emisor, texto: limpio,
          usuario: usuario ?? null,
        }));
    });
  }

  async asociarGrabacion(tenant: string, sesionId: string, archivoId: string): Promise<void> {
    await this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).update(
        { tenant, id: sesionId }, { archivoGrabacionId: archivoId }));
  }
}
