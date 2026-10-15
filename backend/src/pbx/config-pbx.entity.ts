import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * La clave del proveedor que atiende a esta instancia.
 *
 * Es texto libre a propósito: las claves válidas las define el **registro de
 * proveedores** (`proveedores/registro.ts`), no este tipo. Antes era una unión
 * `'YACO' | 'ZADARMA'`, y eso obligaba a tocar la entidad —y con ella la
 * base— para dar de alta un proveedor nuevo. Lo que valida qué se puede
 * guardar es `CLAVES_PROVEEDOR`; lo que valida qué sabe hacer cada uno, su
 * descriptor.
 */
export type ClaveProveedorPbx = string;

/**
 * Configuración de la planta telefónica de UNA instancia.
 *
 * Es por instancia y no de la plataforma —a diferencia del SMS— porque la
 * línea del 123 es del municipio: su número, su centralita, su factura. Dos
 * municipios no comparten planta.
 *
 * **Apagable, como las demás integraciones.** Hay dos interruptores y hacen
 * cosas distintas a propósito:
 *
 *  - `integraciones` del tenant (sin `'pbx'`): la instancia no contrató
 *    telefonía. No hay módulo, no hay cola de llamadas, la interfaz no la
 *    menciona. Lo decide quien vende.
 *  - `activo` de esta fila: la instancia SÍ tiene telefonía, pero esta planta
 *    está apagada ahora mismo —una migración a medias, una prueba, un
 *    proveedor caído—. El webhook rechaza lo que llegue y lo deja anotado en
 *    vez de perderlo en silencio. Lo decide quien opera.
 *
 * Sin fila, el comportamiento es el de siempre (`YACO` por el webhook
 * genérico): esta tabla no puede romper a los que ya funcionan.
 */
@Entity({ name: 'config_pbx' })
export class ConfigPbxEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código del tenant. Una planta por instancia. */
  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  @Column({ type: 'varchar', length: 32, default: 'YACO' })
  proveedor!: ClaveProveedorPbx;

  /** Apagado: se registra lo que llegue, pero no se crea ninguna llamada. */
  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  /**
   * Las credenciales del proveedor, como JSON: `{"key": "…", "secreto": "…"}`.
   *
   * Antes esto eran dos columnas, `zadarmaKey` y `zadarmaSecreto`. Un
   * proveedor nuevo costaba dos columnas más, una migración y una rama más
   * en el servicio de configuración; al tercero, nadie recuerda qué campo usa
   * cuál. Ahora cada proveedor DECLARA sus campos en su descriptor y aquí se
   * guarda lo que diga, sin que la base tenga que saber nada de él.
   *
   * **Los campos marcados como secretos van CIFRADOS** (AES-256-GCM, ver
   * `common/secretos.ts`) y no como digest, porque hay que poder recuperarlos:
   * con ellos se verifica la firma de cada aviso y se firman las llamadas a la
   * API del proveedor. Cuáles son secretos lo dice el descriptor, no una lista
   * escrita aquí: así un proveedor nuevo no puede olvidar cifrar el suyo.
   *
   * Nada de esto sale hacia el navegador: lo secreto nunca, ni truncado (ver
   * `VistaConfigPbx`).
   */
  @Column({ type: 'text', nullable: true })
  credenciales?: string | null;

  /**
   * El número que marca el ciudadano (E.164). Informativo para la pantalla y
   * para los informes; el enrutamiento lo decide la planta, no FALCON.
   */
  @Column({ type: 'varchar', length: 24, nullable: true })
  numeroEntrante?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
