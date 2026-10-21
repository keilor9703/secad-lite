import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { MensajeChatEntity } from '../chat/mensaje.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantRlsService } from '../common/tenant-rls.service';

/** Un elemento de `results[]` en la entrega de Infobip. */
interface InfobipEntrante {
  from?: string;
  to?: string;
  messageId?: string;
  receivedAt?: string;
  contact?: { name?: string };
  message?: { type?: string; text?: string; caption?: string };
}

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

  /**
   * MENSAJES QUE ENTRAN POR INFOBIP, NO POR META DIRECTAMENTE.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ HAY DOS CAMINOS Y NO UNO
   *
   * Porque la línea puede estar conectada a Meta directamente, o a través de
   * Infobip como proveedor oficial. Se eligió Infobip para las plantas
   * nuestras por una razón que no tiene que ver con los mensajes: es el único
   * camino por el que la LLAMADA de WhatsApp llega como SIP a nuestro
   * Asterisk, por la troncal que ya existe. Pero lo que Infobip entrega por
   * webhook viene en SU formato, no en el de Meta.
   *
   * Lo que cambia entre los dos:
   *
   *  - Meta enruta por `phone_number_id`; Infobip, por el número de destino.
   *  - Meta anida `entry[].changes[].value.messages[]`; Infobip entrega una
   *    lista plana en `results[]`.
   *  - Meta nombra los tipos en minúscula (`text`); Infobip en mayúscula
   *    (`TEXT`).
   *
   * Lo que NO cambia: a partir de aquí es el mismo `procesar()`. Un caso de
   * WhatsApp es un caso de WhatsApp, haya entrado por donde haya entrado, y
   * duplicar esa lógica sería garantizar que un día se arregle en un camino
   * y no en el otro.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * LO QUE NO SE RECONOCE SE REGISTRA, NO SE DESCARTA EN SILENCIO
   *
   * Este traductor se escribió contra el formato documentado de Infobip,
   * ANTES de haber visto un mensaje real suyo. Así que un cuerpo que no
   * encaje no se tira: se cuenta y se avisa, para que la primera entrega real
   * diga qué falta en vez de desaparecer.
   */
  async recibirDeInfobip(payload: unknown): Promise<{ procesados: number; sinReconocer: number }> {
    const cuerpo = payload as { results?: unknown[] } | null;
    const lista = Array.isArray(cuerpo?.results) ? cuerpo!.results! : [];
    if (!lista.length) {
      this.log.warn(
        'Infobip entregó un cuerpo sin `results`: no se procesó nada. ' +
          'Si esto se repite, el formato cambió y hay que ajustar el traductor.',
      );
      return { procesados: 0, sinReconocer: 0 };
    }

    let procesados = 0;
    let sinReconocer = 0;

    for (const cruda of lista) {
      const r = cruda as InfobipEntrante;
      const de = String(r?.from ?? '').trim();
      const para = String(r?.to ?? '').trim();
      if (!de || !para) {
        sinReconocer++;
        continue;
      }

      // El número de destino ES la línea: así se sabe de qué municipio es.
      const tenant = await this.tenants.porWaNumero(para);
      if (!tenant) {
        // No es un error del que haya que avisar a gritos: puede ser otra
        // línea de la misma cuenta de Infobip que no es de FALCON. Pero se
        // deja escrito, porque también es como se ve un `waNumero` mal
        // escrito en la configuración de una instancia.
        this.log.warn(`Mensaje de WhatsApp para ${para}: ninguna instancia tiene ese número.`);
        sinReconocer++;
        continue;
      }
      try {
        this.tenants.asegurarVigente(tenant, 'whatsapp');
      } catch {
        continue;
      }

      const texto = this.textoDeInfobip(r?.message);
      if (texto === null) {
        // Un tipo que todavía no sabemos leer —una ubicación, un audio— NO se
        // descarta: el ciudadano mandó algo y el operador tiene que enterarse
        // de que existe, aunque todavía no podamos enseñárselo bien.
        sinReconocer++;
      }

      const id = r?.messageId ? String(r.messageId).slice(0, 120) : null;
      const nombre = String(r?.contact?.name ?? '').trim() || de;

      procesados += await this.rls.conTenant(tenant.codigo, async (manager) => {
        const mensajes = manager.getRepository(MensajeChatEntity);
        // Infobip reintenta lo que no confirmamos a tiempo: el mismo mensaje
        // no puede abrir dos casos ni aparecer dos veces en la conversación.
        if (id && (await mensajes.findOne({ where: { tenant: tenant.codigo, waMessageId: id } }))) {
          return 0;
        }
        await this.procesar(
          manager,
          tenant.codigo,
          de,
          nombre,
          texto ?? this.avisoDeTipoDesconocido(r?.message),
          id,
        );
        return 1;
      });
    }

    if (sinReconocer) {
      this.log.warn(`Infobip: ${sinReconocer} elemento(s) sin reconocer en esta entrega.`);
    }
    return { procesados, sinReconocer };
  }

  /**
   * El texto de un mensaje de Infobip, o `null` si es de un tipo que todavía
   * no sabemos leer.
   *
   * `null` y cadena vacía NO son lo mismo aquí: vacío es «mandó un texto
   * vacío», `null` es «mandó algo que no sabemos mostrar». La diferencia
   * decide si esto se cuenta como sin reconocer.
   */
  private textoDeInfobip(m: unknown): string | null {
    const msg = m as { type?: string; text?: string; caption?: string } | null;
    const tipo = String(msg?.type ?? '').toUpperCase();
    if (tipo === 'TEXT') return String(msg?.text ?? '');
    // Un pie de foto es lo que el ciudadano escribió, y en una emergencia
    // suele ser lo importante: «es en esta esquina».
    if (msg?.caption) return String(msg.caption);
    if (tipo === 'BUTTON' || tipo === 'INTERACTIVE_BUTTON_REPLY' || tipo === 'INTERACTIVE_LIST_REPLY') {
      return String(msg?.text ?? '');
    }
    return null;
  }

  /**
   * Lo que se le escribe al operador cuando llega algo que no sabemos leer.
   *
   * Decir el tipo importa: «mandó un audio» hace que el operador lo pida de
   * otra forma o llame. Un caso vacío hace que crea que fue un error.
   */
  private avisoDeTipoDesconocido(m: unknown): string {
    const tipo = String((m as { type?: string } | null)?.type ?? '').toUpperCase();
    const legible: Record<string, string> = {
      IMAGE: 'una imagen',
      VIDEO: 'un video',
      VOICE: 'una nota de voz',
      AUDIO: 'un audio',
      DOCUMENT: 'un documento',
      LOCATION: 'su ubicación',
      CONTACT: 'un contacto',
      STICKER: 'un sticker',
    };
    const que = legible[tipo] ?? `un mensaje de tipo ${tipo || 'desconocido'}`;
    return `[El ciudadano envió ${que}. Todavía no se puede ver desde FALCON: pídaselo por escrito o llámelo.]`;
  }

  /** Historial de la conversación de un caso de WhatsApp. */
  async historial(tenant: string, casoId: string): Promise<MensajeChatEntity[]> {
    return this.rls.conTenant(tenant, async (manager) => {
      await this.casoWhatsapp(manager, tenant, casoId);
      return manager.getRepository(MensajeChatEntity).find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
    });
  }

  /** El operador responde: guarda el mensaje y lo envía por WhatsApp (best-effort). */
  /**
   * El operador responde.
   *
   * Devuelve si se pudo ENVIAR, y no solo si se pudo guardar, porque son dos
   * cosas distintas y confundirlas es grave: antes, una línea sin
   * credenciales guardaba el mensaje, escribía una advertencia en el log del
   * servidor y devolvía como si todo hubiera ido bien. El operador escribía
   * «ya va la patrulla en camino», lo veía en la conversación, y el ciudadano
   * no recibía nada.
   *
   * El mensaje se guarda igual aunque no se pueda enviar: es lo que el
   * operador quiso decir y queda en el expediente. Lo que no puede pasar es
   * que parezca entregado.
   */
  async responder(
    tenant: string, casoId: string, texto: string, operador: string,
  ): Promise<MensajeChatEntity & { enviado: boolean }> {
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
    const enviado = telefono ? await this.enviar(tenant, telefono, t) : false;
    return { ...mensaje, enviado };
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
  /**
   * Manda el mensaje por donde corresponda, y dice si lo consiguió.
   *
   * Hay dos caminos porque la línea puede estar conectada a Meta directamente
   * o a través de Infobip, y se contesta por donde se recibió: contestar por
   * Meta una línea que vive en Infobip no falla con un error claro, falla con
   * un 401 que parece un problema de credenciales.
   *
   * Devolver `false` en vez de callar es el cambio importante: quien llama
   * tiene que poder decirle al operador que su mensaje NO salió.
   */
  private async enviar(tenant: string, to: string, texto: string): Promise<boolean> {
    const t = await this.tenants.porCodigo(tenant);

    // La cuenta de Infobip es de quien opera FALCON, no de cada municipio:
    // por eso las credenciales son del entorno y no de la instancia. Lo que
    // SÍ es de la instancia es su número, que es el remitente.
    const base = (process.env.INFOBIP_BASE_URL ?? '').trim();
    const clave = (process.env.INFOBIP_API_KEY ?? '').trim();
    if (t?.waNumero && base && clave) {
      return this.enviarPorInfobip(base, clave, t.waNumero, to, texto, tenant);
    }

    // El token vive cifrado en la base; se descifra solo aquí, para usarlo.
    const token = await this.tenants.waAccessTokenDe(tenant);
    if (!t?.waPhoneNumberId || !token) {
      this.log.warn(`WhatsApp sin credenciales para tenant ${tenant}; respuesta NO enviada.`);
      return false;
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${t.waPhoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
      });
      if (!res.ok) {
        this.log.warn(`WhatsApp Graph API respondió ${res.status} para tenant ${tenant}.`);
        return false;
      }
      return true;
    } catch (e) {
      this.log.warn(`No se pudo enviar el WhatsApp para tenant ${tenant}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Envío por Infobip.
   *
   * El host NO es fijo: Infobip asigna uno por cuenta
   * (`xxxxx.api.infobip.com`), igual que en el remitente de SMS, así que no
   * se puede quemar en el código.
   */
  private async enviarPorInfobip(
    base: string, clave: string, from: string, to: string, texto: string, tenant: string,
  ): Promise<boolean> {
    const host = base.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    try {
      const res = await fetch(`https://${host}/whatsapp/1/message/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `App ${clave}`,
        },
        body: JSON.stringify({ from, to, content: { text: texto } }),
      });
      if (!res.ok) {
        this.log.warn(`Infobip respondió ${res.status} al enviar WhatsApp del tenant ${tenant}.`);
        return false;
      }
      return true;
    } catch (e) {
      this.log.warn(`No se pudo enviar por Infobip (${tenant}): ${(e as Error).message}`);
      return false;
    }
  }
}
