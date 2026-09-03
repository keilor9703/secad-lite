import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { MensajeChatEntity } from '../chat/mensaje.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantRlsService } from '../common/tenant-rls.service';

/** Versión de la Graph API de Meta para enviar respuestas. */
const GRAPH_VERSION = 'v20.0';

/**
 * Integración con WhatsApp (Cloud API de Meta). Recibe mensajes por webhook,
 * los enruta al tenant por `phone_number_id`, crea o continúa un caso (canal
 * 'whatsapp') con la conversación, y envía las respuestas del operador de vuelta.
 */
@Injectable()
export class WhatsappService {
  private readonly log = new Logger(WhatsappService.name);

  constructor(
    private readonly casosSvc: CasosService,
    private readonly tenants: TenantsService,
    private readonly rls: TenantRlsService,
  ) {}

  /** Procesa el payload de Meta: por cada mensaje, crea/continúa el caso. */
  async recibir(payload: any): Promise<{ procesados: number }> {
    let procesados = 0;
    const entradas = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entradas) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        const mensajes = value?.messages;
        if (!phoneNumberId || !Array.isArray(mensajes) || mensajes.length === 0) continue;

        const tenant = await this.tenants.porWaPhoneNumberId(String(phoneNumberId));
        if (!tenant) continue;
        // Tenant bloqueado/suspendido/vencido, o sin la integración contratada:
        // se descarta el mensaje en silencio (Meta reintentará igual, y esto
        // es lo mismo que ya hacía con !tenant.activo, solo que ahora cubre
        // también suscripción suspendida/vencida e integración deshabilitada).
        try {
          this.tenants.asegurarVigente(tenant, 'whatsapp');
        } catch {
          continue;
        }

        const nombres = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c?.wa_id && c?.profile?.name) nombres.set(String(c.wa_id), String(c.profile.name));
        }

        // Un webhook público, sin sesión: recién aquí se supo el tenant (por
        // el phone_number_id), así que app.tenant (RLS) se fija DENTRO de
        // esta transacción, una por remitente (`entry`/`change`) del payload.
        procesados += await this.rls.conTenant(tenant.codigo, async (manager) => {
          const mensajesRepo = manager.getRepository(MensajeChatEntity);
          let n = 0;
          for (const m of mensajes) {
            const from = m?.from ? String(m.from) : '';
            if (!from) continue;
            // Meta reenvía los webhooks que no confirma a tiempo: el mismo
            // mensaje (mismo wamid) no se procesa dos veces.
            const wamid = m?.id ? String(m.id).slice(0, 120) : null;
            if (wamid && (await mensajesRepo.findOne({ where: { tenant: tenant.codigo, waMessageId: wamid } }))) {
              continue;
            }
            const texto = this.textoDe(m);
            await this.procesar(manager, tenant.codigo, from, nombres.get(from) || from, texto, wamid);
            n++;
          }
          return n;
        });
      }
    }
    return { procesados };
  }

  /** Historial de la conversación de un caso de WhatsApp. */
  async historial(tenant: string, casoId: string): Promise<MensajeChatEntity[]> {
    return this.rls.conTenant(tenant, async (manager) => {
      await this.casoWhatsapp(manager, tenant, casoId);
      return manager.getRepository(MensajeChatEntity).find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
    });
  }

  /** El operador responde: guarda el mensaje y lo envía por WhatsApp (best-effort). */
  async responder(tenant: string, casoId: string, texto: string, operador: string): Promise<MensajeChatEntity> {
    const t = texto?.trim();
    if (!t) throw new BadRequestException('El mensaje no puede estar vacío.');
    const { mensaje, telefono } = await this.rls.conTenant(tenant, async (manager) => {
      const caso = await this.casoWhatsapp(manager, tenant, casoId);
      const repo = manager.getRepository(MensajeChatEntity);
      const mensaje = await repo.save(
        repo.create({ tenant, casoId, autorTipo: 'operador', autorNombre: operador, texto: t }),
      );
      return { mensaje, telefono: caso.telefono };
    });
    if (telefono) await this.enviar(tenant, telefono, t);
    return mensaje;
  }

  // ---------------------------------------------------------------------------
  private async procesar(manager: EntityManager, tenant: string, from: string, nombre: string, texto: string, wamid: string | null = null): Promise<void> {
    const abierto = await manager.getRepository(CasoEntity).findOne({
      where: { tenant, telefono: from, canal: 'whatsapp', estado: Not('cerrado') },
      order: { creadoEn: 'DESC' },
    });
    let casoId: string;
    if (abierto) {
      casoId = abierto.id;
    } else {
      // A quién se envía: la agencia/canales configurados para WhatsApp en
      // Administración. Sin esa configuración el caso queda sin canal (solo
      // lo ve un supervisor) — es la misma situación de antes de este ajuste.
      const t = await this.tenants.porCodigo(tenant);
      const caso = await this.casosSvc.crear(
        tenant,
        {
          canal: 'whatsapp', titulo: texto.slice(0, 80) || 'WhatsApp', descripcion: texto,
          ciudadano: nombre, telefono: from,
          agenciaResponsableId: t?.waAgenciaResponsableId ?? undefined,
          canales: t?.waCanales ?? undefined,
        },
        'whatsapp',
      );
      casoId = caso.id;
    }
    const mensajesRepo = manager.getRepository(MensajeChatEntity);
    await mensajesRepo.save(
      mensajesRepo.create({ tenant, casoId, autorTipo: 'ciudadano', autorNombre: nombre, texto, waMessageId: wamid }),
    );
  }

  private async casoWhatsapp(manager: EntityManager, tenant: string, casoId: string): Promise<CasoEntity> {
    const caso = await manager.getRepository(CasoEntity).findOne({ where: { tenant, id: casoId } });
    if (!caso) throw new NotFoundException('Caso no encontrado.');
    if (caso.canal !== 'whatsapp') throw new BadRequestException('El caso no es de canal WhatsApp.');
    return caso;
  }

  private textoDe(m: any): string {
    if (m?.type === 'text' && m.text?.body) return String(m.text.body);
    if (m?.type === 'button' && m.button?.text) return String(m.button.text);
    if (m?.type === 'interactive') {
      return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interactivo]');
    }
    return `[${m?.type ?? 'mensaje'} no soportado]`;
  }

  /** Envía un texto por la Graph API con el token del tenant. No lanza errores. */
  private async enviar(tenant: string, to: string, texto: string): Promise<void> {
    const t = await this.tenants.porCodigo(tenant);
    // El token vive cifrado en la base; se descifra solo aquí, para usarlo.
    const token = await this.tenants.waAccessTokenDe(tenant);
    if (!t?.waPhoneNumberId || !token) {
      this.log.warn(`WhatsApp sin credenciales para tenant ${tenant}; respuesta no enviada.`);
      return;
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${t.waPhoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
      });
      if (!res.ok) this.log.warn(`WhatsApp Graph API respondió ${res.status} para tenant ${tenant}.`);
    } catch (e) {
      this.log.warn(`No se pudo enviar el WhatsApp para tenant ${tenant}: ${(e as Error).message}`);
    }
  }
}
