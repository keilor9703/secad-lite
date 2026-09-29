import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
        sesionId: vigente.id, token, enlace: this.enlace(token), expiraEn: vigente.expiraEn,
        smsEnviado: false, reutilizada: true,
        mensaje: 'Ya había una videollamada en curso para este caso — se reutiliza el mismo enlace.',
      };
    }

    const expiraEn = new Date(Date.now() + this.tokens.minutosPorDefecto * 60_000);
    const sesion = await this.rls.conTenant(tenant, (m) =>
      m.getRepository(VideoSesionEntity).save(
        m.getRepository(VideoSesionEntity).create({
          tenant, casoId, estado: 'PENDIENTE',
          usuarioDespachador: despachador,
          numeroTelefono: numeroTelefono?.trim() || null,
          expiraEn,
        }),
      ));

    const token = this.tokens.crear({ sesionId: sesion.id, casoId, tenant, despachador }, expiraEn);
    const enlace = this.enlace(token);

    // El SMS puede fallar y la llamada tiene que quedar abierta igual: el
    // despachador ya tiene el enlace y puede dictarlo por teléfono.
    const smsEnviado = numeroTelefono?.trim()
      ? await this.sms.enviar(
          tenant, numeroTelefono.trim(),
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

  enlace(token: string): string {
    const base = (this.config.get<string>('FRONTEND_URL') ?? '').replace(/\/+$/, '');
    return `${base}/video/${token}`;
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
