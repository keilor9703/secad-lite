import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * En qué punto de su vida está la planta de un municipio.
 *
 * No es decoración: el provisionador tiene que poder distinguir «esto todavía
 * no existe en ningún servidor» de «existe y está apagada». Son cosas
 * distintas y se arreglan de formas distintas.
 *
 *  - `borrador`     — la fila está, el contenedor no. Se le reservaron los
 *                     puertos; nadie puede tomarlos mientras.
 *  - `provisionada` — el contenedor existe y responde, pero la instancia
 *                     todavía no atiende llamadas (falta troncal o número).
 *  - `activa`       — atiende llamadas.
 *  - `suspendida`   — existe y está apagada a propósito (impago, migración).
 *                     Conserva sus puertos: al volver, vuelve igual.
 */
export type EstadoPlanta =
  'borrador' | 'provisionada' | 'activa' | 'suspendida';

/**
 * NUESTRA CENTRALITA, LA DE UN MUNICIPIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ GUARDA ESTA TABLA Y QUÉ NO
 *
 * Esta tabla es la **infraestructura**: qué contenedor corre en qué servidor,
 * con qué puertos y con qué nombre. Es lo que nosotros provisionamos.
 *
 * `config_pbx` sigue siendo otra cosa: **cómo le habla FALCON a una planta**,
 * sea nuestra o ajena. Esa distinción es la que permite que un municipio con
 * YACO y otro con planta nuestra convivan sin ramas por todas partes: el
 * módulo de recepción, la cola y los casos solo conocen `config_pbx`.
 *
 * Y para que no haya dos verdades: cuando una planta se provisiona, **ella
 * escribe** la fila de `config_pbx` de su instancia (proveedor `ASTERISK`,
 * dirección WSS, dominio, ARI). Nadie copia esos datos a mano de una pantalla
 * a la otra, porque un dominio escrito dos veces se desincroniza el día que
 * se migra de servidor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN CONTENEDOR POR INSTANCIA, SOBRE UN SERVIDOR COMPARTIDO
 *
 * Lo decisivo no es el ahorro: es que la configuración de un municipio no
 * pueda romper la de otro. Un Asterisk compartido con contextos separados
 * funciona hasta que alguien edita un `extensions.conf` común y se cae la
 * línea del 123 de otro municipio. Con un contenedor por instancia, el peor
 * caso de un error de configuración es un municipio sin teléfono, no todos.
 *
 * El costo es el reparto de puertos, que es finito en un host compartido, y
 * por eso no se hace a ojo (ver `asignador-puertos.ts`). Y es finito porque
 * el contenedor va en la **red del host**: publicar cientos de puertos RTP
 * por el NAT de Docker es inviable, y el SIP que ORIGINA la planta saldría
 * con un puerto de origen que el SBC del operador rechaza. El aislamiento
 * que buscamos es el de la configuración, no el de la red.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS CAMINOS DE RED QUE NO SE PARECEN
 *
 *  - **La troncal entra por UDP directo al `puertoSip` del host.** El SBC del
 *    operador manda SIP por UDP a una IP y un puerto; no sabe de nombres ni
 *    de TLS, y no hay proxy que valga.
 *  - **El navegador del operador entra por nginx en el 443, por NOMBRE**
 *    (`itagui-pbx.…` → su contenedor), con certificado comodín. Por eso NO
 *    hay un puerto WSS por instancia: un puerto por municipio obligaría a
 *    abrir un puerto en la nube y emitir un certificado cada vez que se vende
 *    una instancia. Un subdominio no cuesta nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN RLS, igual que `config_pbx` y por el mismo motivo: aquí no hay datos de
 * casos ni de ciudadanos, solo configuración que toca el superadmin, y el
 * aislamiento lo da la columna `tenant`.
 */
@Entity({ name: 'planta_asterisk' })
export class PlantaAsteriskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código del tenant. Una planta propia por instancia. */
  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  /**
   * El servidor donde corre el contenedor: nombre o IP, como se le habla por
   * SSH. Varias plantas comparten servidor, y es por servidor que los puertos
   * tienen que ser únicos.
   */
  @Index()
  @Column({ type: 'varchar', length: 180 })
  servidor!: string;

  /**
   * El nombre por el que el navegador llega a ESTA planta
   * (`itagui-pbx.falconcad.com.co`). Es también el dominio SIP con el que se
   * arma la identidad del operador (`sip:101@ese-dominio`).
   *
   * Único en toda la plataforma: es lo que usa nginx para decidir a qué
   * contenedor entregar la conexión. Dos plantas con el mismo nombre serían
   * una planta robándole los operadores a la otra.
   */
  @Column({ type: 'varchar', length: 180, unique: true })
  dominioSip!: string;

  /** Puerto UDP de señalización, por donde entra la troncal del operador. */
  @Column({ type: 'int' })
  puertoSip!: number;

  /** Tajada de puertos de audio, inclusive. Ver `asignador-puertos.ts`. */
  @Column({ type: 'int' })
  rtpDesde!: number;

  @Column({ type: 'int' })
  rtpHasta!: number;

  /**
   * El HTTP de Asterisk: por ahí entra el WebSocket del softphone y la
   * interfaz ARI. Escucha solo en 127.0.0.1 y lo publica nginx en el 443 por
   * nombre, así que NO se abre en la nube — pero es un puerto del host igual
   * que los otros, porque el contenedor comparte su red (ver
   * `asignador-puertos.ts`), y por eso también tiene que ser único.
   */
  @Column({ type: 'int' })
  puertoHttp!: number;

  @Column({ type: 'varchar', length: 16, default: 'borrador' })
  estado!: EstadoPlanta;

  /**
   * Lo que haya que saber de esta planta y no quepa en un campo: que escucha
   * en el 3478 porque el 5060 no se pudo abrir, que su servidor está en
   * Virginia y no en Bogotá. Se lee cuando algo no cuadra.
   */
  @Column({ type: 'text', nullable: true })
  notas?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}

/**
 * El nombre del contenedor de una instancia.
 *
 * Se DERIVA del código del tenant en vez de guardarse, para que no puedan
 * discrepar: un nombre guardado se queda viejo el día que alguien renombra el
 * contenedor a mano, y entonces el provisionador reinicia uno que no es.
 */
export function nombreContenedor(tenant: string): string {
  return `asterisk-${tenant.trim().toLowerCase()}`;
}

/**
 * La dirección de señalización que recibe el navegador del operador.
 *
 * Sin puerto a propósito: va por el 443 de nginx, que es el único que una red
 * corporativa o un celular en datos deja pasar sin preguntar. Una barra CTI
 * que exige el 8089 abierto no funciona en la mitad de las salas de despacho.
 */
export function urlWss(
  planta: Pick<PlantaAsteriskEntity, 'dominioSip'>,
): string {
  return `wss://${planta.dominioSip}/ws`;
}

/** La interfaz REST de esa planta, por el mismo nombre y el mismo 443. */
export function urlAri(
  planta: Pick<PlantaAsteriskEntity, 'dominioSip'>,
): string {
  return `https://${planta.dominioSip}/ari`;
}
