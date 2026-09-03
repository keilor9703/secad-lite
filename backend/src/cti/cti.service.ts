import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CtiEventoEntity } from './cti-evento.entity';
import { TenantsService } from '../tenants/tenants.service';

/**
 * Cuerpo mínimo que ya se puede dar por seguro según la ficha técnica del
 * proveedor: todo evento (llamada, WhatsApp llamada/video/chat, app
 * ciudadana) trae un identificador de interacción. El resto del payload varía
 * por tipo de evento y aún no está definido — se acepta y se guarda sin
 * tipar más de la cuenta, para no adivinar un contrato que todavía no existe.
 */
export interface EventoCtiDto {
  identificadorInteraccion?: string;
  [clave: string]: unknown;
}

/**
 * Integración CTI/YACO (barra embebida). Este servicio es un ESQUELETO
 * deliberado: resuelve el tenant por su API key dedicada, valida que la
 * integración esté contratada, y deja constancia del evento crudo. La lógica
 * de negocio real (crear/enlazar caso según el ACD, notificar por Socket.IO,
 * asociar grabaciones) se construye sobre esto una vez el proveedor confirme
 * el contrato exacto de cada endpoint — ver los apuntes técnicos de la
 * reunión de integración.
 */
@Injectable()
export class CtiService {
  constructor(
    @InjectRepository(CtiEventoEntity)
    private readonly eventos: Repository<CtiEventoEntity>,
    private readonly tenants: TenantsService,
  ) {}

  /** Procesa un evento entrante de interacción, autenticado por la API key del tenant. */
  async procesarEventoInteraccion(apiKey: string, dto: EventoCtiDto): Promise<{ recibido: true; id: string }> {
    const tenant = await this.tenants.porCtiApiKey(apiKey);
    if (!tenant) throw new UnauthorizedException('API key de CTI inválida.');
    // Bloqueado, suscripción suspendida/vencida, o sin la integración cti
    // contratada: esta ruta es pública (la llama el backend del CTI, sin
    // sesión de usuario), así que se valida a mano, como ya hace PBX.
    this.tenants.asegurarVigente(tenant, 'cti');

    if (!dto?.identificadorInteraccion?.toString().trim()) {
      throw new BadRequestException('identificadorInteraccion es obligatorio.');
    }

    const guardado = await this.eventos.save(
      this.eventos.create({
        tenant: tenant.codigo,
        identificadorInteraccion: dto.identificadorInteraccion.toString().trim(),
        payload: dto,
      }),
    );
    return { recibido: true, id: guardado.id };
  }
}
