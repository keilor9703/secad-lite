import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutorTipo, MensajeChatEntity } from './mensaje.entity';
import { CasosService } from '../casos/casos.service';
import { CasoEntity } from '../casos/caso.entity';

/**
 * Lógica del chat: crea el caso al iniciar una conversación, persiste cada
 * mensaje y sirve el historial. Todo acotado por tenant.
 */
@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(MensajeChatEntity)
    private readonly mensajes: Repository<MensajeChatEntity>,
    private readonly casos: CasosService,
  ) {}

  /** Inicia un chat: crea el caso (canal chat) y guarda el primer mensaje. */
  async iniciar(tenant: string, nombre: string, texto: string, usuario: string): Promise<{ caso: CasoEntity; mensaje: MensajeChatEntity }> {
    const titulo = texto.trim().slice(0, 80) || 'Chat ciudadano';
    const caso = await this.casos.crear(
      tenant,
      { canal: 'chat', titulo, descripcion: texto.trim(), ciudadano: nombre, agencia: 'Central' },
      usuario,
    );
    const mensaje = await this.guardar(tenant, caso.id, 'ciudadano', nombre, texto);
    return { caso, mensaje };
  }

  guardar(tenant: string, casoId: string, autorTipo: AutorTipo, autorNombre: string, texto: string): Promise<MensajeChatEntity> {
    return this.mensajes.save(this.mensajes.create({ tenant, casoId, autorTipo, autorNombre, texto: texto.trim() }));
  }

  historial(tenant: string, casoId: string): Promise<MensajeChatEntity[]> {
    return this.mensajes.find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
  }
}
