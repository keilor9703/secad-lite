import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigPbxEntity } from './config-pbx.entity';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { CapacidadPbx, CredencialesPbx, faltanRequeridas } from './proveedores/proveedor';
import { descriptor as descriptorDe, PROVEEDOR_POR_DEFECTO } from './proveedores/registro';

/**
 * Lo que se puede enseñar de la configuración de una planta.
 *
 * Los valores secretos NUNCA entran aquí, ni truncados. Un «últimos cuatro
 * caracteres» parece inofensivo y es un cuarto de la clave regalado a
 * cualquiera que mire la pantalla; para saber si está puesta basta un sí o un
 * no, y eso es `credencialesPuestas`.
 */
export interface VistaConfigPbx {
  tenant: string;
  proveedor: string;
  activo: boolean;
  /** Los valores NO secretos, tal cual. Los secretos no aparecen. */
  credenciales: CredencialesPbx;
  /** Qué campos tienen algo guardado — incluidos los secretos, como sí/no. */
  credencialesPuestas: string[];
  /** Qué le falta para poder encenderse, con la etiqueta que lee el humano. */
  faltan: string[];
  /** Lo que sabe hacer el proveedor elegido: la pantalla no ofrece lo demás. */
  capacidades: readonly CapacidadPbx[];
  numeroEntrante: string | null;
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
}

/** Lo que el formulario puede mandar. */
export interface GuardarConfigPbx {
  tenant?: string;
  proveedor?: string;
  activo?: boolean;
  /** Solo los campos que se escribieron; lo que no venga se conserva. */
  credenciales?: CredencialesPbx;
  numeroEntrante?: string | null;
}

@Injectable()
export class PbxConfigService {
  constructor(
    @InjectRepository(ConfigPbxEntity) private readonly repo: Repository<ConfigPbxEntity>,
    private readonly cred: PbxCredencialesService,
  ) {}

  async listar(): Promise<VistaConfigPbx[]> {
    const filas = await this.repo.find({ order: { tenant: 'ASC' } });
    return filas.map((f) => this.vista(f));
  }

  async guardar(dto: GuardarConfigPbx, actor: string): Promise<VistaConfigPbx> {
    const tenant = String(dto.tenant ?? '').trim();
    if (!tenant) throw new BadRequestException('Indique la instancia.');

    const fila = (await this.repo.findOne({ where: { tenant } }))
      ?? this.repo.create({ tenant, proveedor: PROVEEDOR_POR_DEFECTO, activo: true });

    if (dto.proveedor) {
      if (!descriptorDe(dto.proveedor)) {
        throw new BadRequestException('Proveedor no reconocido.');
      }
      fila.proveedor = String(dto.proveedor).toUpperCase();
    }
    if (typeof dto.activo === 'boolean') fila.activo = dto.activo;
    if (dto.numeroEntrante !== undefined) fila.numeroEntrante = dto.numeroEntrante?.trim() || null;

    // El descriptor del proveedor que queda DESPUÉS de este guardado: es el
    // que decide qué campos existen, cuáles se cifran y cuáles hacen falta.
    const d = descriptorDe(fila.proveedor);
    if (!d) throw new BadRequestException('Proveedor no reconocido.');

    const guardadas = this.cred.comoEstanGuardadas(fila);
    const faltabanAntes = faltanRequeridas(d, this.aPresencia(d, guardadas));
    const mezcladas = this.cred.mezclar(d, guardadas, dto.credenciales);
    fila.credenciales = Object.keys(mezcladas).length ? JSON.stringify(mezcladas) : null;
    const faltanAhora = faltanRequeridas(d, this.aPresencia(d, mezcladas));

    // ────────────────────────────────────────────────────────────────────────
    // SIN LAS CREDENCIALES QUE PIDE EL PROVEEDOR, LA PLANTA NO SE ENCIENDE
    //
    // Sin el secreto no se puede verificar NADA de lo que llegue, y aceptar
    // sin verificar es peor que no tener la integración: cualquiera podría
    // inyectar llamadas en la cola del 123.
    //
    // Pero eso NO puede impedir *elegir* el proveedor, porque los campos donde
    // se escriben las credenciales solo aparecen una vez elegido — exigirlas
    // antes dejaba la pantalla en un callejón sin salida, con el proveedor
    // imposible de guardar. Así que elegirlo sin credenciales es un estado
    // legítimo: queda seleccionado y APAGADO. Lo que sí se rechaza es
    // encenderlo a ciegas.
    // ────────────────────────────────────────────────────────────────────────
    if (faltanAhora.length) {
      if (dto.activo === true) {
        throw new BadRequestException(
          `Para activar ${d.nombre} falta: ${faltanAhora.join(', ')}. `
          + 'Sin eso no se puede verificar lo que llegue. Guárdelo y vuelva a activarla.',
        );
      }
      fila.activo = false;
    } else if (faltabanAntes.length && dto.activo === undefined) {
      // Y la vuelta: acaba de llegar lo que faltaba. La ÚNICA razón por la que
      // esta fila estaba apagada era esa, así que se enciende sola.
      //
      // La alternativa —dejarla apagada y esperar a que alguien se acuerde de
      // mover «Estado»— ya se probó: quien configuró la instancia dio por
      // hecho que con la credencial puesta quedaba lista, y la planta se quedó
      // muda sin que nada en pantalla dijera por qué. Si de verdad se quiere
      // apagada, se apaga, que es un clic y se ve.
      fila.activo = true;
    }

    fila.actualizadoPor = actor;
    return this.vista(await this.repo.save(fila));
  }

  /**
   * «Qué campos hay» sin mirar su valor.
   *
   * `faltanRequeridas` solo necesita saber si cada campo tiene algo, y lo
   * guardado está cifrado: descifrarlo para contar sería trabajo —y un riesgo—
   * para nada.
   */
  private aPresencia(d: { credenciales: readonly { clave: string }[] }, guardadas: CredencialesPbx): CredencialesPbx {
    const r: CredencialesPbx = {};
    for (const c of d.credenciales) if (guardadas[c.clave]) r[c.clave] = 'x';
    return r;
  }

  private vista(f: ConfigPbxEntity): VistaConfigPbx {
    const clave = f.proveedor || PROVEEDOR_POR_DEFECTO;
    const d = descriptorDe(clave);
    const guardadas = this.cred.comoEstanGuardadas(f);
    const visibles: CredencialesPbx = {};
    for (const campo of d?.credenciales ?? []) {
      if (!campo.secreto && guardadas[campo.clave]) visibles[campo.clave] = guardadas[campo.clave];
    }
    return {
      tenant: f.tenant,
      proveedor: clave,
      activo: f.activo,
      credenciales: visibles,
      credencialesPuestas: Object.keys(this.aPresencia(d ?? { credenciales: [] }, guardadas)),
      faltan: d ? faltanRequeridas(d, this.aPresencia(d, guardadas)) : [],
      capacidades: d?.capacidades ?? [],
      numeroEntrante: f.numeroEntrante ?? null,
      actualizadoPor: f.actualizadoPor ?? null,
      actualizadoEn: f.actualizadoEn ?? null,
    };
  }
}
