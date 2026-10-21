import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, MoreThan, Not } from 'typeorm';
import { MensajeChatEntity } from '../chat/mensaje.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { CasosGateway } from '../casos/casos.gateway';
import { ArchivosService } from '../archivos/archivos.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { PrioridadCaso } from '../catalogos/codigo-caso.entity';
import { ConversacionWaEntity } from './conversacion.entity';
import { UbicacionCiudadano, esRuido, menuDeTipos, opcionElegida, textoDelMenu, ubicacionDe } from './admision';
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

/** Algo que impide que la línea funcione, y dónde se arregla. */
export interface FaltaWhatsapp {
  /** Qué falta, en una frase que se entienda sin saber cómo está hecho esto. */
  que: string;
  /** Dónde y cómo se arregla. */
  comoSeArregla: string;
  /** `true` si lo arregla quien opera el servidor, no el administrador del municipio. */
  esDelServidor?: boolean;
}

/**
 * EN QUÉ ESTÁ LA LÍNEA DE WHATSAPP DE ESTA INSTANCIA.
 *
 * Existe porque hasta ahora la pantalla no decía nada: si faltaba algo, los
 * mensajes simplemente no llegaban y averiguar por qué costaba entrar al
 * servidor a leer `docker logs`. Eso es asumible una vez; con un municipio
 * nuevo cada mes, no.
 */
export interface EstadoWhatsapp {
  /** Por dónde está conectada la línea. `null` = por ninguna. */
  via: 'infobip' | 'meta' | null;
  /** Si no falta nada. */
  listo: boolean;
  /** Lo que falta, en el orden en que conviene resolverlo. */
  faltan: FaltaWhatsapp[];
  /** Lo que ha pasado POR FALCON. No es la factura de Infobip. */
  consumo: { entrantes: number; salientes: number; dias: number };
  /** Cuándo escribió un ciudadano por última vez. `null` = nunca. */
  ultimoEntrante: string | null;
}

/**
 * Horas que WhatsApp deja contestar con texto libre, contadas desde el último
 * mensaje del ciudadano. Fuera de esa ventana hace falta una plantilla
 * aprobada por Meta, que es otro trámite y otro código.
 */
export const HORAS_VENTANA_WHATSAPP = 24;

/**
 * Cuántos dígitos finales identifican un teléfono.
 *
 * Diez son los de un móvil colombiano sin indicativo. Comparar por la cola
 * admite las tres formas en que llega el mismo número; con diez dígitos, dos
 * personas distintas que coincidan es algo que no pasa en un municipio.
 */
const LARGO_COLA_TELEFONO = 10;

/**
 * Lo único que recibe quien solo saluda.
 *
 * No abre caso, y dice cómo pedir ayuda de verdad. Dar el número de teléfono
 * no es un adorno: quien no sepa escribir, o no tenga datos, o esté a oscuras,
 * tiene que poder llamar.
 */
const SALUDO_INICIAL =
  'Linea de emergencias. Escriba QUE ESTA PASANDO y DONDE, o llame al 123. ' +
  'Tambien puede enviar su ubicacion, una foto o una nota de voz.';

/** Lo que se pregunta después de abrir el caso, no antes. */
const PREGUNTA_LUGAR =
  'Recibido, ya hay un operador viendo su reporte. ' +
  'Responda con la DIRECCION donde esta ocurriendo, o envie su ubicacion.';

/** El bot se despide: a partir de aquí habla una persona. */
const CIERRE =
  'Gracias. Un operador lo atendera por aqui mismo. Si es urgente, llame al 123.';

/** Los tipos de mensaje que traen un archivo que vale la pena guardar. */
const TIPOS_CON_ARCHIVO = new Set(['IMAGE', 'VIDEO', 'VOICE', 'AUDIO', 'DOCUMENT']);

/**
 * Lo más grande que se baja de un adjunto de WhatsApp.
 *
 * El archivo se trae entero a memoria para trocearlo, así que el límite no es
 * una preferencia: dos videos grandes a la vez tumbarían el proceso, y con él
 * la bandeja del municipio. WhatsApp ya limita a 16 MB el video y a 100 MB el
 * documento; esto corta por debajo y lo deja escrito en el log.
 */
const MAX_BYTES_ADJUNTO = 32 * 1024 * 1024;

/** Ventana sobre la que se cuenta el movimiento de la línea. */
const DIAS_CONSUMO = 30;

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
    private readonly gateway: CasosGateway,
    private readonly catalogos: CatalogosService,
    private readonly archivos: ArchivosService,
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
        // Qué casos YA ABIERTOS recibieron mensaje. Se junta aquí y se avisa
        // después: `conTenant` es una transacción, y emitir desde dentro
        // anuncia a los tableros algo que todavía puede deshacerse.
        const avisos: string[] = [];
        // Lo que el bot de admisión tiene que contestar. Se manda FUERA de la
        // transacción: es una llamada de red, y tenerla abierta mientras se
        // espera al proveedor bloquea filas de `casos` del municipio entero.
        const respuestas: { a: string; texto: string }[] = [];
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
            const r = await this.procesar(
              manager, tenant.codigo, from, nombres.get(from) || from, texto, wamid,
            );
            if (r.avisar) avisos.push(r.avisar);
            if (r.responder) respuestas.push({ a: from, texto: r.responder });
            n++;
          }
          return n;
        });
        await this.avisarMensajesNuevos(tenant.codigo, avisos);
        await this.contestar(tenant.codigo, respuestas);
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

      // Ver el comentario del camino de Meta: se avisa fuera de la transacción.
      const avisos: string[] = [];
      const respuestas: { a: string; texto: string }[] = [];
      // Los adjuntos se bajan DESPUÉS de cerrar la transacción: descargar
      // un video de diez megas con filas de `casos` bloqueadas deja al
      // municipio entero esperando a la red de otro.
      const adjuntos: { casoId: string; mensaje: unknown }[] = [];
      procesados += await this.rls.conTenant(tenant.codigo, async (manager) => {
        const mensajes = manager.getRepository(MensajeChatEntity);
        // Infobip reintenta lo que no confirmamos a tiempo: el mismo mensaje
        // no puede abrir dos casos ni aparecer dos veces en la conversación.
        if (id && (await mensajes.findOne({ where: { tenant: tenant.codigo, waMessageId: id } }))) {
          return 0;
        }
        const res = await this.procesar(
          manager,
          tenant.codigo,
          de,
          nombre,
          texto ?? this.avisoDeTipoDesconocido(r?.message),
          id,
          // Un audio, una foto o una ubicación NO pasan por el filtro de
          // ruido: abren caso siempre.
          //
          // Se mira el TIPO del mensaje y no si se pudo sacar texto. Una
          // foto trae pie, y `textoDeInfobip` devuelve ese pie: una imagen
          // de un accidente con el pie «ok» habría pasado por el filtro de
          // ruido y se habría descartado, con la foto dentro.
          this.esSoloTextoDe(r?.message),
          ubicacionDe(r?.message),
        );
        if (res.avisar) avisos.push(res.avisar);
        if (res.responder) respuestas.push({ a: de, texto: res.responder });
        if (res.casoId) adjuntos.push({ casoId: res.casoId, mensaje: r?.message });
        return 1;
      });
      await this.avisarMensajesNuevos(tenant.codigo, avisos);
      await this.contestar(tenant.codigo, respuestas);
      for (const a of adjuntos) await this.guardarAdjunto(tenant.codigo, a.casoId, a.mensaje);
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
/**
   * ¿Lo que llegó era SOLO texto?
   *
   * Solo lo que es puro texto puede ser ruido. Todo lo demás —audio, foto,
   * video, ubicación, documento— es un reporte en sí mismo, por mucho que el
   * pie de foto diga «ok».
   */
  private esSoloTextoDe(m: unknown): boolean {
    const tipo = String((m as { type?: string } | null)?.type ?? '').toUpperCase();
    return tipo === 'TEXT' || tipo === 'BUTTON' || tipo.startsWith('INTERACTIVE');
  }

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

  /**
   * Historial de la conversación de un caso de WhatsApp.
   *
   * Pedir la conversación ES leerla: esta llamada la hace la pantalla de
   * detalle, y quien la tiene abierta está viendo los mensajes. Así que
   * aquí se apaga la insignia.
   *
   * Solo se avisa cuando el contador CAMBIÓ de verdad. El detalle repregunta
   * cada 4 segundos mientras el caso está en pantalla; emitir en cada vuelta
   * sería mandar un `caso:actualizado` por operador cada 4 segundos a todos
   * los navegadores del municipio, para no decir nada nuevo.
   */
  async historial(tenant: string, casoId: string): Promise<MensajeChatEntity[]> {
    const { mensajes, seLimpio } = await this.rls.conTenant(tenant, async (manager) => {
      const caso = await this.casoWhatsapp(manager, tenant, casoId);
      const seLimpio = (caso.mensajesSinLeer ?? 0) > 0;
      if (seLimpio) {
        await manager.getRepository(CasoEntity).update({ tenant, id: casoId }, { mensajesSinLeer: 0 });
      }
      const mensajes = await manager
        .getRepository(MensajeChatEntity)
        .find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
      return { mensajes, seLimpio };
    });
    if (seLimpio) await this.avisarMensajesNuevos(tenant, [casoId]);
    return mensajes;
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
  /**
   * Guarda el mensaje en su caso, abriendo uno si hace falta.
   *
   * Devuelve el id del caso SOLO cuando el mensaje entró a uno que ya
   * existía. Un caso nuevo ya se anuncia solo —`casosSvc.crear` emite
   * `caso:nuevo`—, así que devolver su id haría que el tablero lo contara
   * dos veces y enseñara una insignia de «1 sin leer» sobre un caso cuyo
   * único mensaje es el titular que el operador ya está viendo.
   */
  /**
   * Guarda el mensaje donde corresponda, y decide si hay caso.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * UN MENSAJE NO ES UN CASO
   *
   * Hasta el 21/10/2026 sí lo era, y por eso «Holaaa» acababa en la bandeja
   * de Recepción compitiendo por atención con una emergencia real. Una línea
   * 123 publicada recibe saludos, stickers, números equivocados y gente
   * probando si contesta un robot.
   *
   * Ahora un mensaje nace como CONVERSACIÓN, y el caso se abre en cuanto hay
   * algo que no sea ruido reconocible. El orden importa y es deliberado: el
   * caso se crea PRIMERO y se tipifica DESPUÉS. Hacerlo al revés —preguntar
   * el tipo antes de abrir el caso— dejaría una emergencia esperando a que
   * alguien conteste un menú.
   *
   * Devuelve qué caso hay que refrescar en los tableros y qué debe
   * contestarle el bot al ciudadano. Lo segundo se manda FUERA de esta
   * transacción: es una llamada de red, y tenerla abierta mientras se espera
   * a Infobip bloquea filas de `casos` para todo el municipio.
   */
  private async procesar(
    manager: EntityManager, tenant: string, from: string, nombre: string, texto: string,
    wamid: string | null = null,
    /**
     * `false` cuando lo que llegó NO era texto (un audio, una foto, una
     * ubicación). Eso nunca pasa por el filtro de ruido: quien se esconde de
     * un agresor manda una nota de voz y no va a contestar un menú.
     */
    eraTexto = true,
    /**
     * Dónde dice el ciudadano que está, si mandó su ubicación.
     *
     * Entra por aquí y no se resuelve fuera porque es la misma decisión:
     * guardar las coordenadas Y dar por contestada la pregunta del bot. Si
     * se hiciera aparte, el bot seguiría pidiendo una dirección que el
     * ciudadano acaba de mandar con un toque.
     */
    ubicacion: UbicacionCiudadano | null = null,
  ): Promise<{ casoId: string | null; avisar: string | null; responder: string | null }> {
    const casos = manager.getRepository(CasoEntity);
    const mensajesRepo = manager.getRepository(MensajeChatEntity);
    const convRepo = manager.getRepository(ConversacionWaEntity);

    const abierto = await casos.findOne({
      where: { tenant, telefono: from, canal: 'whatsapp', estado: Not('cerrado') },
      order: { creadoEn: 'DESC' },
    });

    const conv =
      (await convRepo.findOne({ where: { tenant, telefono: from } })) ??
      convRepo.create({ tenant, telefono: from, estado: 'nueva', mensajesDelBot: 0 });

    // ── Todavía no hay caso ────────────────────────────────────────────────
    if (!abierto) {
      if (eraTexto && esRuido(texto)) {
        // No se abre caso y NO se guarda el mensaje: no hay expediente al que
        // pertenezca. Se pierde un «hola», que es exactamente lo que vale.
        // Si resultara no ser ruido, el siguiente mensaje abre el caso.
        const primeraVez = conv.mensajesDelBot === 0;
        conv.estado = 'nueva';
        if (primeraVez) conv.mensajesDelBot += 1;
        await convRepo.save(conv);
        return { casoId: null, avisar: null, responder: primeraVez ? SALUDO_INICIAL : null };
      }

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
      await mensajesRepo.save(
        mensajesRepo.create({
          tenant, casoId: caso.id, autorTipo: 'ciudadano', autorNombre: nombre, texto,
          waMessageId: wamid,
        }),
      );

      if (ubicacion) await this.ubicar(manager, tenant, caso.id, ubicacion);
      const menu = menuDeTipos(await this.tiposDe(tenant));
      conv.casoId = caso.id;
      conv.estado = 'esperando_tipo';
      conv.mensajesDelBot += 1;
      await convRepo.save(conv);
      // El caso ya está en la bandeja; esto solo lo enriquece.
      return { casoId: caso.id, avisar: null, responder: textoDelMenu(menu) };
    }

    // ── El caso ya existe ──────────────────────────────────────────────────
    const casoId = abierto.id;
    await mensajesRepo.save(
      mensajesRepo.create({
        tenant, casoId, autorTipo: 'ciudadano', autorNombre: nombre, texto, waMessageId: wamid,
      }),
    );
    // `increment` y no leer-sumar-guardar: dos mensajes que entren a la vez
    // por réplicas distintas se contarían una sola vez si cada una guarda el
    // número que leyó antes.
    await casos.increment({ tenant, id: casoId }, 'mensajesSinLeer', 1);

    // EL BOT SE CALLA EN CUANTO HAY UN OPERADOR. Un cuestionario automático
    // encima de una persona que ya está atendiendo la emergencia estorba, y
    // al ciudadano le llegan dos voces a la vez sin saber a cuál contestar.
    const hayOperador = await mensajesRepo.findOne({
      where: { tenant, casoId, autorTipo: 'operador' },
    });
    if (hayOperador) {
      conv.casoId = casoId;
      conv.estado = 'cerrada';
      await convRepo.save(conv);
      if (ubicacion) await this.ubicar(manager, tenant, casoId, ubicacion);
      return { casoId, avisar: casoId, responder: null };
    }

    conv.casoId = casoId;

    // LA UBICACIÓN CONTESTA LA PREGUNTA. El ciudadano la manda con un toque
    // y resuelve lo que más cuesta por teléfono; seguir pidiéndole una
    // dirección escrita después de eso es no haber leído lo que mandó.
    if (ubicacion) {
      await this.ubicar(manager, tenant, casoId, ubicacion);
      const faltabaElLugar = conv.estado === 'esperando_lugar' || conv.estado === 'esperando_tipo';
      conv.estado = 'cerrada';
      await convRepo.save(conv);
      return { casoId, avisar: casoId, responder: faltabaElLugar ? CIERRE : null };
    }

    if (conv.estado === 'esperando_tipo' && eraTexto) {
      const menu = menuDeTipos(await this.tiposDe(tenant));
      const op = opcionElegida(texto, menu);
      if (op) {
        if (op.codigo) await this.tipificar(manager, tenant, casoId, op.codigo);
        conv.estado = 'esperando_lugar';
        conv.mensajesDelBot += 1;
        await convRepo.save(conv);
        return { casoId, avisar: casoId, responder: PREGUNTA_LUGAR };
      }
      // No eligió: contestó otra cosa. No se insiste — el mensaje ya está en
      // el caso y un operador lo va a leer. Insistir en una línea 123 es peor
      // que no preguntar.
      conv.estado = 'cerrada';
      await convRepo.save(conv);
      return { casoId, avisar: casoId, responder: null };
    }

    if (conv.estado === 'esperando_lugar' && eraTexto) {
      await casos.update({ tenant, id: casoId }, { direccion: texto.slice(0, 200) });
      conv.estado = 'cerrada';
      conv.mensajesDelBot += 1;
      await convRepo.save(conv);
      return { casoId, avisar: casoId, responder: CIERRE };
    }

    await convRepo.save(conv);
    return { casoId, avisar: casoId, responder: null };
  }

  /** Pone las coordenadas en el caso, y la dirección si WhatsApp la resolvió. */
  private async ubicar(
    manager: EntityManager, tenant: string, casoId: string, u: UbicacionCiudadano,
  ): Promise<void> {
    await manager.getRepository(CasoEntity).update(
      { tenant, id: casoId },
      { lat: u.lat, lng: u.lng, ...(u.direccion ? { direccion: u.direccion.slice(0, 200) } : {}) },
    );
  }

  /**
   * Avisa a Recepción y a Despacho de que a un caso ABIERTO le entró algo.
   *
   * Sin esto la insignia solo aparecería al recargar la página, que es casi
   * lo mismo que no tenerla: quien está mirando el tablero no recarga.
   *
   * Nunca lanza. Un fallo avisando no puede deshacer un mensaje que YA está
   * guardado: el dato del ciudadano pesa más que la notificación.
   */
  private async avisarMensajesNuevos(tenant: string, casoIds: string[]): Promise<void> {
    for (const id of new Set(casoIds)) {
      try {
        const caso = await this.rls.conTenant(tenant, (manager) =>
          manager.getRepository(CasoEntity).findOne({ where: { tenant, id } }),
        );
        if (caso) this.gateway.emitirCambio(tenant, caso);
      } catch (e) {
        this.log.warn(`No se pudo avisar del mensaje en el caso ${id}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Manda lo que el bot de admisión tenga que decir.
   *
   * Nunca lanza, y a propósito: el mensaje del ciudadano YA está guardado y
   * el caso YA está en la bandeja. Que el bot no pueda contestar es una
   * molestia; perder el reporte por eso sería otra cosa.
   */
  private async contestar(tenant: string, respuestas: { a: string; texto: string }[]): Promise<void> {
    for (const r of respuestas) {
      try {
        await this.enviar(tenant, r.a, r.texto);
      } catch (e) {
        this.log.warn(`El bot de admisión no pudo contestar (${tenant}): ${(e as Error).message}`);
      }
    }
  }

  /**
   * Baja la foto, el audio o el documento que mandó el ciudadano y lo deja en
   * el expediente del caso.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ ESTO IMPORTA MÁS DE LO QUE PARECE
   *
   * Hasta ahora un audio abría el caso y escribía «[El ciudadano envió una
   * nota de voz]», y ahí se acababa: el operador sabía que existía y no podía
   * oírla. Quien se esconde de un agresor manda una nota de voz porque no
   * puede hablar ni escribir, y esa nota ERA el reporte.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * NUNCA LANZA, Y SE SALTA LO QUE NO QUEPA
   *
   * El caso ya está abierto y el mensaje ya está en la conversación. Que no se
   * pueda bajar el adjunto es una pérdida; perder el reporte entero por eso
   * sería otra cosa. Y un archivo enorme no se intenta: traerlo a memoria para
   * trocearlo tumbaría el proceso, y con él la bandeja del municipio.
   */
  private async guardarAdjunto(tenant: string, casoId: string, mensaje: unknown): Promise<void> {
    const m = mensaje as { type?: string; url?: string; caption?: string } | null;
    const url = String(m?.url ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return;

    const tipo = String(m?.type ?? '').toUpperCase();
    if (!TIPOS_CON_ARCHIVO.has(tipo)) return;

    try {
      const clave = (process.env.INFOBIP_API_KEY ?? '').trim();
      const res = await fetch(url, {
        headers: clave ? { Authorization: `App ${clave}` } : {},
      });
      if (!res.ok) {
        this.log.warn(`No se pudo bajar el adjunto de WhatsApp (${tenant}): ${res.status}`);
        return;
      }

      // Se mira la cabecera ANTES de leer el cuerpo: preguntar después de
      // habérselo tragado no evita nada.
      const anunciado = Number(res.headers.get('content-length') ?? 0);
      if (anunciado > MAX_BYTES_ADJUNTO) {
        this.log.warn(`Adjunto de WhatsApp demasiado grande (${anunciado} bytes), no se guarda.`);
        return;
      }

      const datos = Buffer.from(await res.arrayBuffer());
      if (!datos.length || datos.length > MAX_BYTES_ADJUNTO) return;

      const mime = res.headers.get('content-type') ?? 'application/octet-stream';
      await this.archivos.subirCompleto(
        tenant,
        {
          casoId,
          nombre: this.nombreDeAdjunto(tipo, mime),
          tipoMime: mime.split(';')[0].trim(),
          usuario: 'whatsapp',
          descripcion: String(m?.caption ?? '').trim() || null,
          origen: 'ADJUNTO',
        },
        datos,
      );
    } catch (e) {
      this.log.warn(`Falló el adjunto de WhatsApp (${tenant}): ${(e as Error).message}`);
    }
  }

  /** Un nombre reconocible en la lista de adjuntos del caso. */
  private nombreDeAdjunto(tipo: string, mime: string): string {
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = (mime.split('/')[1] ?? 'bin').split(';')[0].trim();
    const base: Record<string, string> = {
      IMAGE: 'foto', VIDEO: 'video', VOICE: 'nota-de-voz',
      AUDIO: 'audio', DOCUMENT: 'documento', STICKER: 'sticker',
    };
    return `whatsapp-${base[tipo] ?? 'adjunto'}-${sello}.${ext}`;
  }

  /** Los códigos de caso activos del municipio, para armar el menú. */
  private async tiposDe(tenant: string): Promise<{ codigo: string; descripcion: string }[]> {
    try {
      return await this.catalogos.listarCodigos(tenant, true);
    } catch (e) {
      // Sin catálogo no se pregunta el tipo, pero el caso ya está abierto.
      this.log.warn(`No se pudo leer el catálogo de ${tenant}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Aplica al caso el tipo que eligió el ciudadano.
   *
   * Se tocan la tipificación, la prioridad y el título, y NO la agencia
   * responsable, aunque el código del catálogo sugiera una. Mover un caso de
   * bandeja después de creado se lo quita de delante a quien ya lo tenía
   * abierto, y eso en mitad de una emergencia es peor que una tipificación
   * que un operador corrige en dos clics.
   */
  private async tipificar(
    manager: EntityManager, tenant: string, casoId: string, codigo: string,
  ): Promise<void> {
    const tipo = (await this.tiposDe(tenant)).find(
      (c) => c.codigo.toUpperCase() === codigo.toUpperCase(),
    ) as { codigo: string; descripcion: string; prioridad?: PrioridadCaso } | undefined;
    if (!tipo) return;
    await manager.getRepository(CasoEntity).update(
      { tenant, id: casoId },
      {
        codigoCaso: tipo.codigo,
        titulo: tipo.descripcion.slice(0, 200),
        ...(tipo.prioridad ? { prioridad: tipo.prioridad } : {}),
      },
    );
  }

  /**
   * Qué le falta a esta instancia para recibir y contestar por WhatsApp.
   *
   * El orden de la lista importa: es el orden en que hay que resolverlo. Las
   * credenciales del servidor van primero porque sin ellas lo demás da igual,
   * y el número va antes que la bandeja porque sin número no llega nada que
   * mandar a ninguna bandeja.
   */
  async estado(tenant: string): Promise<EstadoWhatsapp> {
    const t = await this.tenants.porCodigo(tenant);
    const base = (process.env.INFOBIP_BASE_URL ?? '').trim();
    const clave = (process.env.INFOBIP_API_KEY ?? '').trim();
    const tokenWebhook = (process.env.INFOBIP_WEBHOOK_TOKEN ?? '').trim();
    const tokenMeta = await this.tenants.waAccessTokenDe(tenant);

    const infobipListo = !!(base && clave);
    const via: EstadoWhatsapp['via'] =
      t?.waNumero && infobipListo ? 'infobip'
      : t?.waPhoneNumberId && tokenMeta ? 'meta'
      : null;

    const faltan: FaltaWhatsapp[] = [];

    if (!t?.waNumero && !t?.waPhoneNumberId) {
      faltan.push({
        que: 'No hay número de línea.',
        comoSeArregla:
          'Escriba arriba el número de WhatsApp de esta instancia, en dígitos ' +
          '(p. ej. 573132354086). Es lo que decide de qué municipio es un mensaje ' +
          'que entra: sin él, el mensaje llega al servidor y se descarta.',
      });
    }

    if (t?.waNumero && !infobipListo) {
      faltan.push({
        que: 'Hay número, pero el servidor no tiene las credenciales de Infobip.',
        comoSeArregla:
          'Un administrador pone INFOBIP_BASE_URL e INFOBIP_API_KEY en el .env del ' +
          'servidor y vuelve a desplegar. Son de la cuenta, no de este municipio: se ' +
          'ponen una vez y sirven para todas las instancias.',
        esDelServidor: true,
      });
    }

    if (t?.waNumero && infobipListo && !tokenWebhook) {
      faltan.push({
        que: 'Se puede enviar, pero NO recibir: falta el token del webhook.',
        comoSeArregla:
          'Un administrador pone INFOBIP_WEBHOOK_TOKEN en el .env del servidor, con el ' +
          'mismo valor que lleve la cabecera x-infobip-token del perfil de notificación ' +
          'de Infobip. Sin él, en producción se rechaza cada mensaje entrante.',
        esDelServidor: true,
      });
    }

    if (!via && (t?.waPhoneNumberId || tokenMeta)) {
      faltan.push({
        que: 'La conexión con Meta está a medias.',
        comoSeArregla: t?.waPhoneNumberId
          ? 'Falta el token de acceso de Meta. Péguelo abajo.'
          : 'Falta el phone_number_id del número. Péguelo arriba.',
      });
    }

    if (!t?.waAgenciaResponsableId) {
      faltan.push({
        que: 'Los casos de WhatsApp no llegarían a ninguna bandeja.',
        comoSeArregla:
          'Elija abajo la agencia responsable y sus canales. Sin esto el caso se crea, ' +
          'pero solo lo ve quien tenga permiso de supervisión: nadie lo despacha.',
      });
    }

    const { entrantes, salientes, ultimoEntrante } = await this.movimiento(tenant);

    return {
      via,
      listo: faltan.length === 0,
      faltan,
      consumo: { entrantes, salientes, dias: DIAS_CONSUMO },
      ultimoEntrante,
    };
  }

  /**
   * Cuántos mensajes han pasado por aquí, y cuándo fue el último entrante.
   *
   * Se cuenta sobre NUESTRA base y no contra Infobip a propósito: esto dice
   * qué pasó por FALCON, que es lo que FALCON puede afirmar. La factura la
   * emite Infobip y puede no coincidir —reintentos, mensajes de otras
   * aplicaciones de la misma cuenta—, así que presentarlo como «consumo
   * facturable» sería inventarse una cifra.
   */
  private async movimiento(
    tenant: string,
  ): Promise<{ entrantes: number; salientes: number; ultimoEntrante: string | null }> {
    const desde = new Date(Date.now() - DIAS_CONSUMO * 24 * 3_600_000);
    try {
      return await this.rls.conTenant(tenant, async (manager) => {
        const repo = manager.getRepository(MensajeChatEntity);
        const [entrantes, salientes] = await Promise.all([
          repo.count({ where: { tenant, autorTipo: 'ciudadano', creadoEn: MoreThan(desde) } }),
          repo.count({ where: { tenant, autorTipo: 'operador', creadoEn: MoreThan(desde) } }),
        ]);
        const ultimo = await repo.findOne({
          where: { tenant, autorTipo: 'ciudadano' },
          order: { creadoEn: 'DESC' },
        });
        return {
          entrantes,
          salientes,
          ultimoEntrante: ultimo ? new Date(ultimo.creadoEn).toISOString() : null,
        };
      });
    } catch (e) {
      // Una cifra que no se pudo calcular no puede tumbar la pantalla de
      // configuración, que es justo donde se va a arreglar lo que falla.
      this.log.warn(`No se pudo contar el movimiento de WhatsApp (${tenant}): ${(e as Error).message}`);
      return { entrantes: 0, salientes: 0, ultimoEntrante: null };
    }
  }

  /**
   * Manda un mensaje de prueba y cuenta qué pasó.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ NO BASTA CON «ENVIADO / NO ENVIADO»
   *
   * Porque quien está dando de alta un municipio necesita saber QUÉ arreglar.
   * Y hay una trampa que se lleva a todo el mundo la primera vez: WhatsApp no
   * deja escribirle primero a nadie. Si el número de prueba no le ha escrito
   * a la línea en las últimas 24 horas, el envío se rechaza — y eso NO
   * significa que la configuración esté mal.
   *
   * Así que cuando no hay conversación abierta esto no dice «falló»: dice qué
   * hacer para que la prueba sea válida.
   */
  async probar(tenant: string, a: string): Promise<{ ok: boolean; detalle: string }> {
    const destino = (a ?? '').replace(/\D/g, '');
    if (!destino) {
      return { ok: false, detalle: 'Escriba el número al que mandar la prueba, en dígitos.' };
    }

    const estado = await this.estado(tenant);
    if (!estado.via) {
      return {
        ok: false,
        detalle: estado.faltan[0]?.que ?? 'La línea de WhatsApp no está configurada.',
      };
    }

    const texto =
      'FALCON CAD - Mensaje de prueba de la linea. Si lo recibe, la configuracion ' +
      'de WhatsApp de esta instancia funciona. No requiere respuesta.';

    const r = await this.enviarDetallado(tenant, destino, texto);
    if (r.ok) return r;

    // El motivo más probable, y el que no es culpa de la configuración.
    const hayVentana = await this.enviarSiHayConversacion(tenant, destino, texto);
    if (hayVentana) return { ok: true, detalle: 'Enviado.' };

    return {
      ok: false,
      detalle:
        `${r.detalle} — Si es la primera prueba, lo más probable es que ese número no le ` +
        `haya escrito a la línea: WhatsApp no permite escribir primero sin una plantilla ` +
        `aprobada por Meta. Mándele un WhatsApp al ${(await this.tenants.porCodigo(tenant))?.waNumero ?? 'número de la línea'} ` +
        `desde ese teléfono y vuelva a probar.`,
    };
  }

  /**
   * Manda un texto por WhatsApp SOLO si hay una conversación abierta con ese
   * número. Devuelve si salió; nunca lanza.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ NO BASTA CON QUE EXISTA UN CASO
   *
   * WhatsApp solo deja escribir texto libre dentro de las 24 horas siguientes
   * al último mensaje DEL CIUDADANO. Pasada esa ventana hace falta una
   * plantilla aprobada por Meta, y un envío fuera de plazo no falla de forma
   * obvia: lo rechaza el proveedor y el ciudadano no recibe nada.
   *
   * Un caso puede llevar abierto tres días con el último mensaje del
   * ciudadano hace dos. Por eso lo que se mira es la hora de ese mensaje y no
   * la del caso: si se mirara el caso, el enlace de la videollamada se daría
   * por enviado y nadie lo recibiría — y el operador se quedaría esperando a
   * alguien que nunca va a conectarse.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * EL NÚMERO SE COMPARA POR LA COLA
   *
   * El mismo teléfono llega escrito de tres formas: `573175882321` desde el
   * webhook, `+57 317 588 2321` tecleado por un operador, `3175882321`
   * dictado por el ciudadano. Comparar la cadena entera diría que son tres
   * personas distintas, y el enlace se iría por SMS teniendo la conversación
   * abierta delante. Se comparan los últimos dígitos, que es lo que no
   * cambia.
   */
  async enviarSiHayConversacion(tenant: string, telefono: string, texto: string): Promise<boolean> {
    const digitos = (telefono ?? '').replace(/\D/g, '');
    if (!digitos || !texto?.trim()) return false;
    const cola = digitos.slice(-LARGO_COLA_TELEFONO);

    try {
      const abierto = await this.rls.conTenant(tenant, async (manager) => {
        const caso = await manager
          .getRepository(CasoEntity)
          .createQueryBuilder('c')
          .where('c.tenant = :tenant', { tenant })
          .andWhere('c.canal = :canal', { canal: 'whatsapp' })
          .andWhere('c.estado <> :cerrado', { cerrado: 'cerrado' })
          .andWhere('c.telefono LIKE :cola', { cola: `%${cola}` })
          .orderBy('c."creadoEn"', 'DESC')
          .getOne();
        if (!caso) return false;

        const ultimo = await manager.getRepository(MensajeChatEntity).findOne({
          where: { tenant, casoId: caso.id, autorTipo: 'ciudadano' },
          order: { creadoEn: 'DESC' },
        });
        if (!ultimo) return false;

        const horas = (Date.now() - new Date(ultimo.creadoEn).getTime()) / 3_600_000;
        return horas < HORAS_VENTANA_WHATSAPP;
      });

      if (!abierto) return false;
      return await this.enviar(tenant, digitos, texto);
    } catch (e) {
      // Quien llama tiene un camino alterno (el SMS). Un fallo mirando la
      // conversación no puede dejar al ciudadano sin enlace por ningún lado.
      this.log.warn(`No se pudo comprobar la conversación de WhatsApp (${tenant}): ${(e as Error).message}`);
      return false;
    }
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
    return (await this.enviarDetallado(tenant, to, texto)).ok;
  }

  /**
   * Lo mismo que `enviar`, pero diciendo POR QUÉ no salió.
   *
   * El booleano le basta a quien responde un caso —el operador ve «no se
   * pudo enviar» y llama por teléfono—, pero no le sirve a quien está
   * configurando la línea: «false» puede ser una clave mala, una IP no
   * autorizada, un número sin dar de alta o la ventana de 24 horas
   * cerrada, y cada una se arregla en un sitio distinto. Averiguar cuál
   * era costaba entrar al servidor a leer `docker logs`.
   */
  private async enviarDetallado(
    tenant: string, to: string, texto: string,
  ): Promise<{ ok: boolean; detalle: string }> {
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
      return {
        ok: false,
        detalle:
          'Esta instancia no tiene por dónde enviar: ni número de línea con las ' +
          'credenciales de Infobip en el servidor, ni phone_number_id con token de Meta.',
      };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${t.waPhoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
      });
      if (!res.ok) {
        this.log.warn(`WhatsApp Graph API respondió ${res.status} para tenant ${tenant}.`);
        return { ok: false, detalle: `Meta respondió ${res.status}: ${await this.cuerpoBreve(res)}` };
      }
      return { ok: true, detalle: 'Enviado por Meta (Cloud API).' };
    } catch (e) {
      this.log.warn(`No se pudo enviar el WhatsApp para tenant ${tenant}: ${(e as Error).message}`);
      return { ok: false, detalle: `No se pudo contactar con Meta: ${(e as Error).message}` };
    }
  }

  /** Un trozo legible de la respuesta de error, para enseñárselo a quien configura. */
  private async cuerpoBreve(res: { text(): Promise<string> }): Promise<string> {
    try {
      return (await res.text()).slice(0, 300);
    } catch {
      return 'sin cuerpo';
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
  ): Promise<{ ok: boolean; detalle: string }> {
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
        return { ok: false, detalle: `Infobip respondió ${res.status}: ${await this.cuerpoBreve(res)}` };
      }
      return { ok: true, detalle: `Enviado por Infobip desde ${from}.` };
    } catch (e) {
      this.log.warn(`No se pudo enviar por Infobip (${tenant}): ${(e as Error).message}`);
      return { ok: false, detalle: `No se pudo contactar con Infobip: ${(e as Error).message}` };
    }
  }
}
