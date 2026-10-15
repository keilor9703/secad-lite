import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'node:crypto';
import type { JwtPayload } from '../auth/auth.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { CorreoService } from '../correo/correo.service';
import { plantillaTicketAcuse, plantillaTicketMesa, TicketCorreo } from '../correo/plantillas';
import { TenantEntity } from '../tenants/tenant.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { nivelDe } from './severidad';
import { TicketDto } from './dto/ticket.dto';

/**
 * El reporte de soporte, por correo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN CORREO Y NO UN TICKET
 *
 * Todavía no hay herramienta de mesa de ayuda contratada (ver *Lo que falta*
 * en `docs/mesa-de-ayuda.md`). Mientras no la haya, el reporte sale a
 * `soporte@falconcad.com.co` y una copia a quien lo abrió. Eso impone tres
 * cosas que hay que mantener cuando llegue la herramienta:
 *
 *  1. **El número lo acuña este servicio**, no la herramienta. Sin él, quien
 *     reporta y quien atiende no tienen cómo nombrar el mismo reporte por
 *     teléfono. Cuando exista la herramienta, el número pasará a ser el suyo
 *     y este se conservará como referencia del correo.
 *
 *  2. **No se habla de ESTADO en ningún correo.** No hay tablero que lo
 *     mantenga: decir «estado: abierto» sería prometer una consulta que no
 *     existe, y la primera persona que intente verla pierde la confianza en
 *     todo lo demás que diga el correo.
 *
 *  3. **Si el correo no sale, no se inventa que salió.** `CorreoService` no
 *     lanza nunca: devuelve si pudo. Cuando no pudo, quien reporta recibe un
 *     aviso claro y el diálogo deja a la vista el reporte para copiarlo — y
 *     queda, además, en la bitácora de la instancia, que es lo único durable
 *     que hay hoy.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface RespuestaTicket {
  /** El número del reporte. Se devuelve siempre: también identifica el intento fallido. */
  id: string;
  /** ¿Llegó a la mesa? Si es falso, el reporte NO salió y hay que copiarlo. */
  enviado: boolean;
  /** Qué pasó con la copia para quien reportó. */
  acuse: 'enviado' | 'sin-correo' | 'fallo';
  /** A dónde se mandó, para decírselo a quien reporta sin que tenga que adivinar. */
  mesa: string;
  /** Por qué no salió, cuando no salió. */
  error?: string;
}

@Injectable()
export class SoporteService {
  private readonly logger = new Logger(SoporteService.name);

  /**
   * El buzón de la mesa. Configurable porque un día habrá una dirección que
   * crea tickets en la herramienta, y cambiarla no debería exigir un
   * despliegue del código.
   */
  private readonly mesa = (process.env.SOPORTE_CORREO ?? 'soporte@falconcad.com.co').trim();

  constructor(
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    private readonly correo: CorreoService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  async abrir(actor: JwtPayload, dto: TicketDto): Promise<RespuestaTicket> {
    const id = nuevoId();
    const nivel = nivelDe(dto.severidad);

    // Quién reporta sale de la BASE, no del cuerpo de la petición: el correo
    // al que va el acuse tiene que ser el de la cuenta autenticada y no uno
    // que el cliente pueda elegir, o el endpoint se convierte en una forma de
    // mandar correo con el membrete de FALCON CAD a donde se quiera.
    const u = await this.usuarios.findOne({ where: { id: actor.sub } }).catch(() => null);
    const quien = u ? `${u.nombre} (${u.username})` : `${actor.nombre} (${actor.sub})`;
    const correoQuien = (u?.correo ?? '').trim();

    const ticket: TicketCorreo = {
      id,
      severidad: nivel.id,
      severidadTitulo: nivel.titulo,
      compromiso: nivel.compromiso,
      relato: dto.relato.trim(),
      contexto: dto.contexto,
      instancia: await this.instancia(actor.tenant),
      quien,
      correoQuien,
      pantalla: (dto.pantalla ?? '').trim(),
    };

    // Primero el aviso a la mesa: es el ticket. El acuse es una cortesía, y
    // acusar «su reporte llegó» cuando no llegó sería peor que no acusar.
    const aMesa = await this.correo.enviar({ ...plantillaTicketMesa(ticket), para: this.mesa });

    let acuse: RespuestaTicket['acuse'] = 'sin-correo';
    if (aMesa.ok && correoQuien) {
      const r = await this.correo.enviar({
        ...plantillaTicketAcuse(ticket, this.mesa),
        para: correoQuien,
      });
      acuse = r.ok ? 'enviado' : 'fallo';
      if (!r.ok) {
        // Que el acuse falle no invalida el ticket: la mesa ya lo tiene.
        this.logger.warn(`Ticket ${id}: la mesa lo recibió, el acuse a ${correoQuien} no salió (${r.error}).`);
      }
    }

    // Rastro en la instancia. Hoy es el ÚNICO registro durable del reporte, así
    // que lleva el relato completo — no un resumen. El contexto técnico no: es
    // largo, lo reconstruye la aplicación, y la mesa ya lo tiene en el correo.
    await this.auditoria.registrar(
      actor.tenant ?? 'plataforma',
      u?.username ?? actor.nombre,
      'soporte.ticket',
      [
        `${id} · ${nivel.id} ${nivel.titulo}`,
        ticket.pantalla ? `pantalla ${ticket.pantalla}` : '',
        aMesa.ok ? `enviado a ${this.mesa}` : `NO SE PUDO ENVIAR (${aMesa.error ?? 'sin detalle'})`,
        `acuse: ${acuse}`,
        '',
        ticket.relato,
      ].filter(Boolean).join(' · '),
    );

    if (!aMesa.ok) {
      // El correo era la única salida y se cerró. Al registro del servidor,
      // completo, para poder recuperarlo de los logs del contenedor: no lleva
      // credenciales (el informe excluye el token de sesión a propósito).
      this.logger.error(
        `Ticket ${id} NO salió a la mesa (${aMesa.error ?? 'sin detalle'}). Reporte de ${quien}, `
        + `instancia ${ticket.instancia}, ${nivel.id}:\n${ticket.relato}`,
      );
    }

    return {
      id,
      enviado: aMesa.ok,
      acuse,
      mesa: this.mesa,
      error: aMesa.ok ? undefined : aMesa.error,
    };
  }

  /**
   * «Alcaldía de Soacha (63001)». El código solo no le dice nada a quien lee
   * el ticket en la mesa, y el nombre solo no basta para entrar a mirar.
   */
  private async instancia(codigo: string | null | undefined): Promise<string> {
    if (!codigo) return 'plataforma (sin instancia elegida)';
    const t = await this.tenants.findOne({ where: { codigo } }).catch(() => null);
    return t ? `${t.nombre} (${t.codigo})` : codigo;
  }
}

/**
 * El número del reporte: `FC-261015-7K3Q`.
 *
 * Tres decisiones:
 *
 *  - **La fecha va en hora de Colombia**, no UTC. Un ticket abierto a las 8 de
 *    la noche en Bogotá es del día siguiente en UTC, y el número diría una
 *    fecha que no coincide con la que vio quien reportó.
 *  - **Alfabeto sin ambigüedades** (sin I, O, 0 ni 1): este número se dicta por
 *    teléfono, y «cero o o» es exactamente la clase de confusión que hace
 *    perder un ticket.
 *  - **`randomInt`, no `Math.random`**: aquí no hay base de datos que impida
 *    repetir uno, y aunque adivinarlo no abre ninguna puerta, un generador
 *    sesgado sí multiplica las colisiones dentro del mismo día.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function nuevoId(hoy = new Date()): string {
  // `en-CA` da `YYYY-MM-DD`, que es lo único que se necesita de Intl aquí.
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: '2-digit', month: '2-digit', day: '2-digit',
  }).format(hoy).replace(/-/g, '');
  let cola = '';
  for (let i = 0; i < 4; i++) cola += ALFABETO[randomInt(ALFABETO.length)];
  return `FC-${fecha}-${cola}`;
}
