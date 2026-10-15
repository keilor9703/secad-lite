import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigPbxEntity, ProveedorPbx } from './config-pbx.entity';
import { cifrar } from '../common/secretos';

/**
 * Lo que se puede enseñar de la configuración de una planta.
 *
 * El secreto NUNCA entra aquí, ni truncado. Un «últimos cuatro caracteres»
 * parece inofensivo y es un cuarto de la clave regalado a cualquiera que mire
 * la pantalla; para saber si está puesta basta un sí o un no.
 */
export interface VistaConfigPbx {
  tenant: string;
  proveedor: ProveedorPbx;
  activo: boolean;
  zadarmaKey: string | null;
  tieneCredenciales: boolean;
  numeroEntrante: string | null;
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
}

@Injectable()
export class PbxConfigService {
  constructor(
    @InjectRepository(ConfigPbxEntity) private readonly repo: Repository<ConfigPbxEntity>,
  ) {}

  async listar(): Promise<VistaConfigPbx[]> {
    const filas = await this.repo.find({ order: { tenant: 'ASC' } });
    return filas.map((f) => this.vista(f));
  }

  async guardar(dto: {
    tenant?: string;
    proveedor?: ProveedorPbx;
    activo?: boolean;
    zadarmaKey?: string | null;
    zadarmaSecreto?: string | null;
    numeroEntrante?: string | null;
  }, actor: string): Promise<VistaConfigPbx> {
    const tenant = String(dto.tenant ?? '').trim();
    if (!tenant) throw new BadRequestException('Indique la instancia.');

    const fila = (await this.repo.findOne({ where: { tenant } }))
      ?? this.repo.create({ tenant, proveedor: 'YACO', activo: true });

    if (dto.proveedor) {
      if (dto.proveedor !== 'YACO' && dto.proveedor !== 'ZADARMA') {
        throw new BadRequestException('Proveedor no reconocido.');
      }
      fila.proveedor = dto.proveedor;
    }
    if (typeof dto.activo === 'boolean') fila.activo = dto.activo;
    if (dto.zadarmaKey !== undefined) fila.zadarmaKey = dto.zadarmaKey?.trim() || null;
    if (dto.numeroEntrante !== undefined) fila.numeroEntrante = dto.numeroEntrante?.trim() || null;

    // Solo de escritura: sin valor en el cuerpo se conserva el que había. Un
    // formulario que no recibió el secreto no puede reenviarlo, y sin esto
    // apagar la integración lo borraría sin querer.
    const teniaSecreto = !!fila.zadarmaSecreto;
    const secreto = dto.zadarmaSecreto?.trim();
    if (secreto) fila.zadarmaSecreto = cifrar(secreto, process.env.JWT_SECRET ?? '');

    // Sin secreto no se puede verificar NADA de lo que llegue, y aceptar sin
    // verificar es peor que no tener la integración: cualquiera podría
    // inyectar llamadas en la cola del 123. Pero eso NO puede impedir
    // *elegir* Zadarma, porque el campo donde se escribe el secreto solo
    // aparece una vez elegido — exigirlo antes dejaba la pantalla en un
    // callejón sin salida, con el proveedor imposible de guardar.
    //
    // Así que elegir Zadarma sin secreto es un estado legítimo: queda
    // seleccionada y APAGADA. Lo que sí se rechaza es encenderla a ciegas.
    if (fila.proveedor === 'ZADARMA' && !fila.zadarmaSecreto) {
      if (dto.activo === true) {
        throw new BadRequestException(
          'Para activar Zadarma hace falta el secreto de la API: sin él no se puede verificar '
          + 'la firma de lo que llegue. Guarde el secreto y vuelva a activarla.',
        );
      }
      fila.activo = false;
    } else if (fila.proveedor === 'ZADARMA' && secreto && !teniaSecreto && dto.activo === undefined) {
      // Y la vuelta: acaba de llegar el secreto que faltaba. La ÚNICA razón
      // por la que esta fila estaba apagada era esa, así que se enciende sola.
      //
      // La alternativa —dejarla apagada y esperar a que alguien se acuerde de
      // mover «Estado»— ya se probó: quien configuró la instancia dio por
      // hecho que con la credencial puesta quedaba lista, y la planta se
      // quedó muda sin que nada en pantalla dijera por qué. Si de verdad se
      // quiere apagada, se apaga, que es un clic y se ve.
      fila.activo = true;
    }

    fila.actualizadoPor = actor;
    return this.vista(await this.repo.save(fila));
  }

  private vista(f: ConfigPbxEntity): VistaConfigPbx {
    return {
      tenant: f.tenant,
      proveedor: f.proveedor,
      activo: f.activo,
      zadarmaKey: f.zadarmaKey ?? null,
      tieneCredenciales: !!f.zadarmaSecreto,
      numeroEntrante: f.numeroEntrante ?? null,
      actualizadoPor: f.actualizadoPor ?? null,
      actualizadoEn: f.actualizadoEn ?? null,
    };
  }
}
