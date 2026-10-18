import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cómo autentica el operador a su contraparte.
 *
 *  - `ip`       — por dirección de origen. No hay credenciales: el operador
 *                 confía en nuestra IP y nosotros en sus subredes. Es lo que
 *                 entrega Infobip como troncal estática, y la más robusta:
 *                 no hay registro que se pueda caer a las 3 de la mañana.
 *  - `registro` — la planta se REGISTRA contra el operador con usuario y
 *                 clave. Imprescindible cuando el servidor no tiene IP fija.
 *  - `digest`   — sin registro, pero cada llamada va firmada con usuario y
 *                 clave.
 */
export type AutenticacionTroncal = 'ip' | 'registro' | 'digest';

/**
 * LA TRONCAL SIP DE UN MUNICIPIO — por donde la llamada del ciudadano entra
 * a nuestra planta, y por donde sale la que hacemos nosotros.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA TRONCAL POR MUNICIPIO, Y NO UNA COMPARTIDA
 *
 * Técnicamente se podría compartir: una sola troncal, y el número marcado
 * decide a qué instancia va la llamada. Está descartado por tres razones, y
 * las tres son del negocio antes que de la técnica:
 *
 *  1. **Los canales son un cupo.** Una troncal de 10 canales compartida entre
 *     tres municipios significa que una emergencia grande en uno deja a los
 *     otros dos sin línea. Eso es inaceptable en el 123 y además es
 *     imposible de explicar.
 *  2. **La factura es del municipio.** Cada alcaldía contrata y paga lo suyo;
 *     una troncal común nos convierte en revendedores de minutos, con la
 *     cartera y el riesgo de eso.
 *  3. **La troncal identifica al inquilino por sí sola.** Si cada municipio
 *     entra por la suya, no hay que deducir de quién es una llamada: llegó
 *     por su troncal, es suya. Un error de deducción ahí manda la emergencia
 *     de un municipio a la sala de despacho de otro.
 *
 * Varias filas por instancia SÍ se permiten, con `prioridad`: una troncal
 * principal y otra de respaldo con otro operador es exactamente lo que se
 * necesita el día que un operador se cae, y es la razón por la que esto no
 * son dos columnas más en `planta_asterisk`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE GUARDA CIFRADO
 *
 * `clave` va cifrada en reposo (AES-256-GCM, `common/secretos.ts`) y no como
 * digest: hay que poder recuperarla para escribirla en el `pjsip.conf` de la
 * planta. No vuelve nunca al navegador, ni truncada.
 */
@Entity({ name: 'pbx_troncal' })
export class PbxTroncalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Como lo llama quien opera: «Infobip Bogotá», «Claro respaldo». */
  @Column({ type: 'varchar', length: 80 })
  nombre!: string;

  /**
   * Quién presta el servicio. Texto libre por lo mismo que en `config_pbx`:
   * un operador nuevo no puede costar una migración de la base.
   */
  @Column({ type: 'varchar', length: 32 })
  proveedor!: string;

  /**
   * A dónde se le manda el SIP: el FQDN o la IP del SBC del operador.
   * En Infobip es un nombre largo propio de la cuenta, no uno público.
   */
  @Column({ type: 'varchar', length: 180 })
  servidor!: string;

  /**
   * El puerto del operador. 5060 casi siempre, pero es editable porque el
   * nuestro también lo es: cuando no pudimos abrir el 5060 en la nube, la
   * troncal quedó entregando en otro puerto y hubo que decírselo al operador.
   */
  @Column({ type: 'int', default: 5060 })
  puerto!: number;

  @Column({ type: 'varchar', length: 16, default: 'ip' })
  autenticacion!: AutenticacionTroncal;

  @Column({ type: 'varchar', length: 120, nullable: true })
  usuario?: string | null;

  /** Cifrada en reposo. Nunca sale hacia el navegador. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  clave?: string | null;

  /**
   * Las subredes del operador desde las que puede llegar una llamada, en
   * CIDR y separadas por coma o salto de línea. Es lo que va al `identify`
   * de pjsip con autenticación por IP.
   *
   * Un error aquí no degrada: deja la planta sin arrancar. Ver `revisarRedes`.
   */
  @Column({ type: 'text', nullable: true })
  redes?: string | null;

  /**
   * Cuántas llamadas simultáneas admite el contrato. Se guarda para poder
   * decir «la troncal está llena» en vez de dejar que el operador rechace la
   * llamada 11 sin que nadie sepa por qué.
   */
  @Column({ type: 'int', default: 10 })
  canales!: number;

  /** 1 es la principal; las demás, respaldo en orden ascendente. */
  @Column({ type: 'int', default: 1 })
  prioridad!: number;

  @Column({ type: 'boolean', default: true })
  activa!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}

/** Las redes escritas en el campo, una por elemento y sin vacíos. */
export function redesDe(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .split(/[\s,;]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * Por qué esas redes no sirven, o null si sirven.
 *
 * Esto se valida ANTES de escribir el `pjsip.conf` por una razón concreta y
 * desagradable: un `match` inválido en una sección `identify` hace que
 * Asterisk rechace **todo** el módulo pjsip al cargar. No es que entre mal
 * una troncal: es que el municipio se queda sin troncal Y sin softphones, y
 * el mensaje queda enterrado en `/var/log/asterisk/messages`. Un CIDR mal
 * escrito en un formulario no puede costar eso.
 */
export function revisarRedes(texto: string | null | undefined): string | null {
  const redes = redesDe(texto);
  if (!redes.length) return null;
  for (const red of redes) {
    if (!esIpOCidr(red)) {
      return `«${red}» no es una dirección ni una subred válida (ejemplo: 81.23.252.0/24).`;
    }
  }
  return null;
}

function esIpOCidr(valor: string): boolean {
  const [ip, prefijo, ...resto] = valor.split('/');
  if (resto.length) return false;
  if (prefijo !== undefined) {
    if (!/^\d{1,2}$/.test(prefijo)) return false;
    const n = Number(prefijo);
    if (n < 0 || n > 32) return false;
  }
  const partes = ip.split('.');
  if (partes.length !== 4) return false;
  return partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}
