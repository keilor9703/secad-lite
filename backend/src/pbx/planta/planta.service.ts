import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { cifrar, descifrar } from '../../common/secretos';
import { TenantsService } from '../../tenants/tenants.service';
import { UsuariosService } from '../../usuarios/usuarios.service';
import { PbxConfigService } from '../pbx-config.service';
import { PbxCredencialesService } from '../pbx-credenciales.service';
import {
  EstadoPlanta,
  ipInternaDe,
  ipPublicaDe,
  nombreContenedor,
  PlantaAsteriskEntity,
  urlAri,
  urlWss,
} from './planta-asterisk.entity';
import {
  AutenticacionTroncal,
  PbxTroncalEntity,
  redesDe,
  revisarRedes,
} from './pbx-troncal.entity';
import {
  normalizarNumero,
  PbxNumeroEntity,
  TipoNumero,
} from './pbx-numero.entity';
import {
  asignarRanura,
  PLAN_POR_DEFECTO,
  RanuraPuertos,
  revisarChoques,
} from './asignador-puertos';
import {
  ArchivoGenerado,
  DatosPlanta,
  generarConfiguracion,
} from './generador';

/**
 * PROVISIONAR LA PLANTA DE UN MUNICIPIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE SERVICIO EXISTE PARA EVITAR
 *
 * Hoy dar de alta un municipio es: entrar por SSH, mirar qué puertos están
 * libres, escribir cinco archivos con los números a mano, inventar claves,
 * copiarlas a FALCON una por una y reiniciar. Son veinte minutos si todo va
 * bien y una tarde si un número se repite. Y no escala: a la tercera
 * instancia, los puertos se pisan.
 *
 * Aquí es una fila y un botón. Lo que decide los puertos es el asignador; lo
 * que escribe los archivos, el generador; y lo que queda registrado para que
 * FALCON sepa hablarle a esa planta, `config_pbx` — escrito por este
 * servicio y no a mano, porque un dominio escrito dos veces se desincroniza
 * el día que se migra de servidor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS CLAVES LAS PONE EL SISTEMA, NO UNA PERSONA
 *
 * Tres credenciales hacen falta para que una planta funcione: la clave SIP de
 * cada operador, la de ARI y la API key con la que la central avisa a FALCON.
 * Ninguna la teclea nadie:
 *
 *  - **Las SIP** se generan para el funcionario que tiene extensión y no
 *    tiene clave. NUNCA se sobrescribe una que ya existe: si el operador
 *    tiene un teléfono físico registrado con ella, cambiarla lo deja sin
 *    línea y el síntoma aparece en la próxima emergencia, no ahora.
 *  - **La de ARI** se genera una vez y queda cifrada en `config_pbx`. Se
 *    reutiliza en los siguientes provisionamientos: rotarla sin motivo
 *    rompería el botón «Llamar» hasta volver a aplicar.
 *  - **La API key de la instancia** NO se puede reutilizar, y eso no es un
 *    defecto: FALCON guarda su digest, no la clave, así que nadie —ni
 *    nosotros— puede volver a leerla. Aplicar la configuración la ROTA y
 *    escribe la nueva en el archivo de la planta. Por eso aplicar avisa: la
 *    central vieja deja de poder avisar hasta que se instalen los archivos
 *    nuevos.
 *
 * Esa última consecuencia es la razón de que haya DOS operaciones: `previa`,
 * que muestra en pantalla cómo van a quedar los archivos sin tocar nada, y
 * `aplicar`, que entrega los archivos de verdad y rota lo que haya que rotar.
 */

/** Lo que se puede enseñar de una troncal: nunca su clave, ni truncada. */
export interface VistaTroncal {
  id: string;
  nombre: string;
  proveedor: string;
  servidor: string;
  puerto: number;
  autenticacion: AutenticacionTroncal;
  usuario: string | null;
  clavePuesta: boolean;
  redes: string[];
  canales: number;
  prioridad: number;
  activa: boolean;
}

export interface VistaNumero {
  id: string;
  numero: string;
  tipo: TipoNumero;
  troncalId: string | null;
  destino: string;
  descripcion: string | null;
  activo: boolean;
}

export interface VistaPlanta {
  tenant: string;
  servidor: string;
  ipPublica: string;
  /** Por dónde alcanza nginx a esta planta; `127.0.0.1` si no se fijó otra. */
  ipInterna: string;
  dominioSip: string;
  contenedor: string;
  puertoSip: number;
  rtpDesde: number;
  rtpHasta: number;
  puertoHttp: number;
  estado: EstadoPlanta;
  notas: string | null;
  /** Lo que el navegador del operador va a usar; sale de la planta, no se teclea. */
  wss: string;
  ari: string;
  troncales: VistaTroncal[];
  numeros: VistaNumero[];
  /** Cuántos funcionarios de la instancia tienen extensión. */
  operadores: number;
  /** Cuántos de ellos ya tienen clave SIP: sin clave no hay softphone. */
  operadoresConClave: number;
  /**
   * Qué le falta para atender una llamada, en el orden en que conviene
   * resolverlo. Vacío significa que puede atender.
   */
  faltan: string[];
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
}

export interface CrearPlantaDto {
  tenant?: string;
  servidor?: string;
  ipPublica?: string | null;
  ipInterna?: string | null;
  /** Si no viene, se deriva: `<tenant>-pbx.<dominio base>`. */
  dominioSip?: string | null;
  notas?: string | null;
}

export interface ActualizarPlantaDto {
  servidor?: string;
  ipPublica?: string | null;
  ipInterna?: string | null;
  dominioSip?: string | null;
  notas?: string | null;
  estado?: EstadoPlanta;
  /** Solo para registrar una planta que ya existe con otros puertos. */
  puertoSip?: number;
  rtpDesde?: number;
  rtpHasta?: number;
  puertoHttp?: number;
}

export interface GuardarTroncalDto {
  id?: string;
  nombre?: string;
  proveedor?: string;
  servidor?: string;
  puerto?: number;
  autenticacion?: AutenticacionTroncal;
  usuario?: string | null;
  /** Solo de escritura: si no viene, se conserva la guardada. */
  clave?: string | null;
  redes?: string | null;
  canales?: number;
  prioridad?: number;
  activa?: boolean;
}

export interface GuardarNumeroDto {
  id?: string;
  numero?: string;
  tipo?: TipoNumero;
  troncalId?: string | null;
  destino?: string | null;
  descripcion?: string | null;
  activo?: boolean;
}

/** Lo que devuelve generar la configuración. */
export interface ConfiguracionPlanta {
  tenant: string;
  /** La carpeta del servidor donde van estos archivos. */
  carpeta: string;
  archivos: ArchivoGenerado[];
  /** Lo que quien aplica tiene que saber ANTES de instalar. */
  advertencias: string[];
  /** Si es una vista previa, los secretos van sustituidos. */
  previa: boolean;
}

/** El relleno que va en lugar de un secreto en la vista previa. */
export const SECRETO_OCULTO = '«se genera al aplicar»';

const ESTADOS: EstadoPlanta[] = [
  'borrador',
  'provisionada',
  'activa',
  'suspendida',
];
const USUARIO_ARI = 'falcon';

@Injectable()
export class PlantaService {
  private readonly log = new Logger(PlantaService.name);

  constructor(
    @InjectRepository(PlantaAsteriskEntity)
    private readonly repo: Repository<PlantaAsteriskEntity>,
    @InjectRepository(PbxTroncalEntity)
    private readonly troncales: Repository<PbxTroncalEntity>,
    @InjectRepository(PbxNumeroEntity)
    private readonly numeros: Repository<PbxNumeroEntity>,
    private readonly config: PbxConfigService,
    private readonly cred: PbxCredencialesService,
    private readonly usuarios: UsuariosService,
    private readonly tenants: TenantsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // CONSULTA
  // ───────────────────────────────────────────────────────────────────────────

  async listar(): Promise<VistaPlanta[]> {
    const plantas = await this.repo.find({
      order: { servidor: 'ASC', puertoSip: 'ASC' },
    });
    return Promise.all(plantas.map((p) => this.vista(p)));
  }

  async ver(tenant: string): Promise<VistaPlanta> {
    return this.vista(await this.exigir(tenant));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ALTA Y EDICIÓN
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Da de alta la planta de un municipio: reserva sus puertos y deja escrito
   * en `config_pbx` cómo le habla FALCON.
   *
   * Queda en `borrador`: la fila existe y los puertos están reservados —nadie
   * se los puede llevar— pero el contenedor todavía no. Esa separación es a
   * propósito: quien vende puede dar de alta la instancia sin esperar a quien
   * monta el servidor.
   */
  async crear(dto: CrearPlantaDto, actor: string): Promise<VistaPlanta> {
    const tenant = (dto.tenant ?? '').trim().toLowerCase();
    if (!tenant) throw new BadRequestException('Indique la instancia.');
    const servidor = (dto.servidor ?? '').trim();
    if (!servidor)
      throw new BadRequestException(
        'Indique el servidor donde va a correr la planta.',
      );

    if (await this.repo.findOne({ where: { tenant } })) {
      throw new ConflictException(
        `La instancia «${tenant}» ya tiene planta propia.`,
      );
    }

    const dominioSip =
      (dto.dominioSip ?? '').trim().toLowerCase() || this.dominioDe(tenant);
    if (await this.repo.findOne({ where: { dominioSip } })) {
      throw new ConflictException(
        `El nombre «${dominioSip}» ya lo usa otra planta. Es lo que nginx mira para decidir a ` +
          'qué centralita entra cada operador, así que no puede repetirse.',
      );
    }

    const ranura = asignarRanura(
      await this.ocupadasEn(servidor),
      PLAN_POR_DEFECTO,
    );
    if (!ranura.ok) throw new ConflictException(ranura.error);

    const fila = this.repo.create({
      tenant,
      servidor,
      ipPublica: dto.ipPublica?.trim() || null,
      ipInterna: this.limpiarIpInterna(dto.ipInterna),
      dominioSip,
      ...ranura.ranura,
      estado: 'borrador',
      notas: dto.notas?.trim() || null,
      actualizadoPor: actor,
    });
    const guardada = await this.repo.save(fila);
    await this.escribirConfigPbx(guardada, actor);
    return this.vista(guardada);
  }

  /**
   * Valida la IP interna, y rechaza `0.0.0.0` por nombre.
   *
   * `0.0.0.0` «funciona» —de hecho funciona en los dos casos, por eso es la
   * tentación cuando algo no conecta—, y lo que hace es dejar ARI escuchando
   * en todas las interfaces del host. Hoy eso está tapado por el cortafuegos;
   * el día que alguien abra ese puerto en la nube para depurar, queda ARI
   * expuesto a internet con solo su clave. Así que se rechaza aquí, donde se
   * escribe, y no se confía en que nadie lo teclee.
   */
  private limpiarIpInterna(valor?: string | null): string | null {
    const ip = valor?.trim();
    if (!ip) return null;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
      throw new BadRequestException(
        `«${ip}» no es una dirección IPv4. La IP interna es la del host por la ` +
          'que nginx alcanza a la planta: 127.0.0.1 si nginx corre en el host, ' +
          'o la del puente de Docker (ip -4 addr show docker0) si corre en un ' +
          'contenedor en red bridge.',
      );
    if (ip.split('.').some((o) => Number(o) > 255))
      throw new BadRequestException(`«${ip}» no es una dirección IPv4.`);
    if (ip === '0.0.0.0')
      throw new BadRequestException(
        'La IP interna no puede ser 0.0.0.0: eso deja ARI escuchando en todas ' +
          'las interfaces del host. Use 127.0.0.1 si nginx corre en el host, o ' +
          'la IP del puente de Docker si corre en un contenedor.',
      );
    return ip;
  }

  async actualizar(
    tenant: string,
    dto: ActualizarPlantaDto,
    actor: string,
  ): Promise<VistaPlanta> {
    const fila = await this.exigir(tenant);

    if (dto.servidor !== undefined) {
      const servidor = dto.servidor.trim();
      if (!servidor)
        throw new BadRequestException('El servidor no puede quedar vacío.');
      fila.servidor = servidor;
    }
    if (dto.ipPublica !== undefined)
      fila.ipPublica = dto.ipPublica?.trim() || null;
    if (dto.ipInterna !== undefined)
      fila.ipInterna = this.limpiarIpInterna(dto.ipInterna);
    if (dto.dominioSip !== undefined) {
      const dominioSip = (dto.dominioSip ?? '').trim().toLowerCase();
      if (!dominioSip)
        throw new BadRequestException(
          'El nombre de la planta no puede quedar vacío.',
        );
      const otra = await this.repo.findOne({ where: { dominioSip } });
      if (otra && otra.tenant !== fila.tenant) {
        throw new ConflictException(
          `El nombre «${dominioSip}» ya lo usa la planta de «${otra.tenant}».`,
        );
      }
      fila.dominioSip = dominioSip;
    }
    if (dto.notas !== undefined) fila.notas = dto.notas?.trim() || null;
    if (dto.estado !== undefined) {
      if (!ESTADOS.includes(dto.estado))
        throw new BadRequestException('Estado no reconocido.');
      fila.estado = dto.estado;
    }

    // Los puertos a mano: para REGISTRAR lo que ya existe (la centralita que
    // escucha en el 3478 porque no se pudo abrir el 5060), no para repartir.
    const puertos: RanuraPuertos = {
      puertoSip: dto.puertoSip ?? fila.puertoSip,
      rtpDesde: dto.rtpDesde ?? fila.rtpDesde,
      rtpHasta: dto.rtpHasta ?? fila.rtpHasta,
      puertoHttp: dto.puertoHttp ?? fila.puertoHttp,
    };
    const cambioPuertos = (
      ['puertoSip', 'rtpDesde', 'rtpHasta', 'puertoHttp'] as const
    ).some((k) => puertos[k] !== fila[k]);
    if (cambioPuertos) {
      const choque = revisarChoques(
        puertos,
        await this.ocupadasEn(fila.servidor, fila.tenant),
      );
      if (choque) throw new ConflictException(choque);
      Object.assign(fila, puertos);
    }

    fila.actualizadoPor = actor;
    const guardada = await this.repo.save(fila);
    // El dominio y los puertos viven también en `config_pbx`, que es lo que
    // lee el navegador. Si no se reescribe, el softphone sigue apuntando al
    // sitio viejo y el síntoma es «se queda conectando».
    await this.escribirConfigPbx(guardada, actor);
    return this.vista(guardada);
  }

  /**
   * Borra una planta que nunca se montó.
   *
   * Solo en `borrador`: una planta provisionada tiene un contenedor corriendo
   * y operadores registrados contra ella, y borrar la fila no apaga nada —
   * dejaría una centralita viva que FALCON ya no conoce, con sus puertos
   * «libres» para la siguiente. Para dar de baja una que existe, primero se
   * suspende.
   */
  async eliminar(tenant: string, actor: string): Promise<{ tenant: string }> {
    const fila = await this.exigir(tenant);
    if (fila.estado !== 'borrador') {
      throw new ConflictException(
        'Esta planta ya está montada en un servidor. Suspéndala primero: borrar la fila no apaga ' +
          'el contenedor, y dejaría una centralita viva que FALCON ya no conoce.',
      );
    }
    await this.numeros.delete({ tenant });
    await this.troncales.delete({ tenant });
    await this.repo.delete({ tenant });
    this.log.warn(
      `Planta de «${tenant}» eliminada por ${actor} (estaba en borrador).`,
    );
    return { tenant };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TRONCALES Y NÚMEROS
  // ───────────────────────────────────────────────────────────────────────────

  async guardarTroncal(
    tenant: string,
    dto: GuardarTroncalDto,
    actor: string,
  ): Promise<VistaTroncal> {
    await this.exigir(tenant);
    const fila = dto.id
      ? await this.troncales.findOne({ where: { id: dto.id, tenant } })
      : // Los valores por defecto se escriben aquí y no se dejan a la columna:
        // una fila recién creada tiene que estar completa ANTES de guardarse,
        // porque de ella sale la configuración que se genera.
        this.troncales.create({
          tenant,
          proveedor: 'INFOBIP',
          autenticacion: 'ip',
          puerto: 5060,
          canales: 10,
          prioridad: 1,
          activa: true,
        });
    if (!fila)
      throw new NotFoundException('Esa troncal no es de esta instancia.');

    if (dto.nombre !== undefined) fila.nombre = dto.nombre.trim();
    if (dto.proveedor !== undefined)
      fila.proveedor = dto.proveedor.trim().toUpperCase();
    if (dto.servidor !== undefined) fila.servidor = dto.servidor.trim();
    if (dto.puerto !== undefined) fila.puerto = Number(dto.puerto);
    if (dto.autenticacion !== undefined) fila.autenticacion = dto.autenticacion;
    if (dto.usuario !== undefined) fila.usuario = dto.usuario?.trim() || null;
    if (dto.canales !== undefined) fila.canales = Number(dto.canales);
    if (dto.prioridad !== undefined) fila.prioridad = Number(dto.prioridad);
    if (dto.activa !== undefined) fila.activa = !!dto.activa;
    if (dto.redes !== undefined) {
      const mal = revisarRedes(dto.redes);
      if (mal) throw new BadRequestException(mal);
      fila.redes = dto.redes?.trim() || null;
    }
    // Solo de escritura: si no viene, se conserva la que había. Así se puede
    // cambiar el puerto de una troncal sin volver a teclear su clave —ni que
    // el navegador la haya recibido nunca para poder reenviarla—.
    if (dto.clave) fila.clave = cifrar(dto.clave, this.llave());

    if (!fila.nombre)
      throw new BadRequestException('Póngale un nombre a la troncal.');
    if (!fila.servidor)
      throw new BadRequestException('Indique el servidor (SBC) del operador.');
    if (!fila.puerto || fila.puerto < 1 || fila.puerto > 65535) {
      throw new BadRequestException('El puerto de la troncal no es válido.');
    }
    if (fila.autenticacion !== 'ip' && !fila.usuario) {
      throw new BadRequestException(
        'Una troncal con registro o con DIGEST necesita usuario y clave; si el operador autentica ' +
          'por IP, elija «por IP» y registre sus subredes.',
      );
    }

    fila.actualizadoPor = actor;
    return this.vistaTroncal(await this.troncales.save(fila));
  }

  async eliminarTroncal(
    tenant: string,
    id: string,
    actor: string,
  ): Promise<{ id: string }> {
    const fila = await this.troncales.findOne({ where: { id, tenant } });
    if (!fila)
      throw new NotFoundException('Esa troncal no es de esta instancia.');
    await this.troncales.delete({ id, tenant });
    this.log.warn(
      `Troncal «${fila.nombre}» de «${tenant}» eliminada por ${actor}.`,
    );
    return { id };
  }

  async guardarNumero(
    tenant: string,
    dto: GuardarNumeroDto,
    actor: string,
  ): Promise<VistaNumero> {
    await this.exigir(tenant);
    const fila = dto.id
      ? await this.numeros.findOne({ where: { id: dto.id, tenant } })
      : this.numeros.create({
          tenant,
          tipo: 'did',
          destino: 'cola',
          activo: true,
        });
    if (!fila)
      throw new NotFoundException('Ese número no es de esta instancia.');

    if (dto.tipo !== undefined) fila.tipo = dto.tipo;
    if (dto.numero !== undefined) {
      // Se normaliza ANTES de guardar: un número con un guion no casa con
      // ningún patrón del dialplan, y el síntoma —«el número está puesto y la
      // llamada no entra»— no se parece a su causa.
      const numero = normalizarNumero(dto.numero, fila.tipo);
      if (!numero) throw new BadRequestException('Ese no es un número válido.');
      fila.numero = numero;
    }
    if (dto.troncalId !== undefined) {
      const id = dto.troncalId?.trim() || null;
      if (id && !(await this.troncales.findOne({ where: { id, tenant } }))) {
        throw new BadRequestException('Esa troncal no es de esta instancia.');
      }
      fila.troncalId = id;
    }
    if (dto.destino !== undefined) fila.destino = dto.destino?.trim() || 'cola';
    if (dto.descripcion !== undefined)
      fila.descripcion = dto.descripcion?.trim() || null;
    if (dto.activo !== undefined) fila.activo = !!dto.activo;
    if (!fila.numero) throw new BadRequestException('Indique el número.');

    fila.actualizadoPor = actor;
    try {
      return this.vistaNumero(await this.numeros.save(fila));
    } catch (e) {
      // El único parcial de la base: un DID es único en el planeta, así que si
      // otra instancia dice tener este, una de las dos se equivocó — y el
      // precio de no verlo es una emergencia timbrando en el municipio vecino.
      if (String((e as { code?: string })?.code) === '23505') {
        throw new ConflictException(
          `El número ${fila.numero} ya está registrado. Si es un DID, solo puede pertenecer a una ` +
            'instancia: revise en cuál quedó.',
        );
      }
      throw e;
    }
  }

  async eliminarNumero(
    tenant: string,
    id: string,
    actor: string,
  ): Promise<{ id: string }> {
    const fila = await this.numeros.findOne({ where: { id, tenant } });
    if (!fila)
      throw new NotFoundException('Ese número no es de esta instancia.');
    await this.numeros.delete({ id, tenant });
    this.log.warn(
      `Número ${fila.numero} de «${tenant}» eliminado por ${actor}.`,
    );
    return { id };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GENERAR LA CONFIGURACIÓN
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Los archivos TAL COMO van a quedar, pero con los secretos sustituidos.
   *
   * Sirve para revisarlos en pantalla antes de tocar nada y para compararlos
   * contra lo que hay instalado cuando algo no funciona. No rota nada: una
   * vista previa que invalidara la API key de la instancia sería una trampa.
   */
  async previa(tenant: string): Promise<ConfiguracionPlanta> {
    const planta = await this.exigir(tenant);
    const datos = await this.datosDe(planta, {
      apiKey: SECRETO_OCULTO,
      ariClave:
        this.cred.enClaro(await this.cred.configDe(tenant)).ariClave ||
        SECRETO_OCULTO,
      clavesSip: false,
    });
    return {
      tenant,
      carpeta: this.carpetaDe(planta),
      archivos: generarConfiguracion(datos),
      advertencias: await this.advertencias(planta, true),
      previa: true,
    };
  }

  /**
   * Los archivos de verdad, listos para instalar.
   *
   * Hace tres cosas que cambian estado, y las tres son necesarias para que la
   * planta pueda funcionar sin que nadie teclee una clave:
   *
   *  1. Genera la clave SIP de los operadores que no tengan (nunca sustituye
   *     una existente).
   *  2. Genera la de ARI si es la primera vez, y la guarda cifrada.
   *  3. ROTA la API key de la instancia, porque FALCON solo guarda su digest
   *     y no hay forma de volver a leer la actual. Hasta que estos archivos
   *     estén instalados, la central vieja no podrá avisar.
   */
  async aplicar(tenant: string, actor: string): Promise<ConfiguracionPlanta> {
    const planta = await this.exigir(tenant);
    const ip = ipPublicaDe(planta);
    if (!ip) {
      throw new BadRequestException(
        'Registre la IP pública del servidor: sin ella Asterisk anuncia su IP privada y la llamada ' +
          'entra con audio de una sola vía.',
      );
    }

    const claves = await this.asegurarClavesSip(tenant, actor);
    const ariClave = await this.asegurarAri(tenant, actor);
    const apiKey = await this.tenants.rotarApiKey(tenant);

    const datos = await this.datosDe(planta, {
      apiKey,
      ariClave,
      clavesSip: true,
    });
    const archivos = generarConfiguracion(datos);

    if (planta.estado === 'borrador') {
      planta.estado = 'provisionada';
      planta.actualizadoPor = actor;
      await this.repo.save(planta);
    }

    const advertencias = await this.advertencias(planta, false);
    advertencias.unshift(
      'Se renovó la API key de la instancia: la central no podrá avisar a FALCON hasta que estos ' +
        'archivos queden instalados y Asterisk reiniciado.',
    );
    if (claves.length) {
      advertencias.push(
        `Se generó la clave SIP de ${claves.length} funcionario(s): ${claves.join(', ')}. ` +
          'No hay que copiarla a ninguna parte: el navegador la recibe al encender la barra.',
      );
    }
    return {
      tenant,
      carpeta: this.carpetaDe(planta),
      archivos,
      advertencias,
      previa: false,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ADENTRO
  // ───────────────────────────────────────────────────────────────────────────

  private async exigir(tenant: string): Promise<PlantaAsteriskEntity> {
    const fila = await this.repo.findOne({
      where: { tenant: (tenant ?? '').trim().toLowerCase() },
    });
    if (!fila)
      throw new NotFoundException('Esa instancia no tiene planta propia.');
    return fila;
  }

  /** Las ranuras tomadas en un servidor, sin contar la de la propia planta. */
  private async ocupadasEn(
    servidor: string,
    exceptoTenant?: string,
  ): Promise<RanuraPuertos[]> {
    const filas = await this.repo.find({ where: { servidor } });
    return filas
      .filter((f) => f.tenant !== exceptoTenant)
      .map((f) => ({
        puertoSip: f.puertoSip,
        rtpDesde: f.rtpDesde,
        rtpHasta: f.rtpHasta,
        puertoHttp: f.puertoHttp,
      }));
  }

  /**
   * El nombre de la planta de una instancia.
   *
   * Derivado y no teclado: así dar de alta un municipio no exige inventar un
   * subdominio, y el comodín del certificado los cubre todos.
   */
  private dominioDe(tenant: string): string {
    const base = (process.env.PBX_DOMINIO_BASE ?? 'falconcad.com.co').trim();
    return `${tenant}-pbx.${base}`;
  }

  private carpetaDe(planta: PlantaAsteriskEntity): string {
    const base = (process.env.PBX_CARPETA_BASE ?? '/opt/falcon-pbx').replace(
      /\/+$/,
      '',
    );
    return `${base}/${planta.tenant}`;
  }

  private llave(): string {
    return process.env.JWT_SECRET ?? '';
  }

  /** Una clave que nadie tiene que recordar ni teclear. */
  private claveNueva(): string {
    return randomBytes(18).toString('base64url');
  }

  /**
   * Deja escrito en `config_pbx` cómo le habla FALCON a esta planta.
   *
   * Es lo que evita las dos verdades: la dirección WSS y el dominio SIP salen
   * de la planta, no de un campo que alguien copió. Lo único que no se toca
   * aquí es la clave de ARI, que se genera al aplicar.
   */
  private async escribirConfigPbx(
    planta: PlantaAsteriskEntity,
    actor: string,
  ): Promise<void> {
    await this.config.guardar(
      {
        tenant: planta.tenant,
        proveedor: 'ASTERISK',
        credenciales: {
          wss: urlWss(planta),
          dominio: planta.dominioSip,
          ariUrl: urlAri(planta),
          ariUsuario: USUARIO_ARI,
          contextoSaliente: 'salientes',
        },
      },
      actor,
    );
  }

  /** La clave de ARI: se genera una vez y se reutiliza. */
  private async asegurarAri(tenant: string, actor: string): Promise<string> {
    const fila = await this.cred.configDe(tenant);
    const actual = this.cred.enClaro(fila).ariClave;
    if (actual) return actual;
    const nueva = this.claveNueva();
    await this.config.guardar(
      { tenant, credenciales: { ariClave: nueva } },
      actor,
    );
    return nueva;
  }

  /**
   * Le da clave SIP a quien tenga extensión y no tenga.
   *
   * Nunca sustituye una existente: si el operador tiene un teléfono físico
   * registrado con ella, cambiarla lo deja sin línea y eso se descubre en la
   * próxima emergencia.
   */
  private async asegurarClavesSip(
    tenant: string,
    actor: string,
  ): Promise<string[]> {
    const nuevas: string[] = [];
    for (const u of await this.usuarios.conExtension(tenant)) {
      if (this.usuarios.claveSipDe(u)) continue;
      await this.usuarios.registrarClaveSip(u.id, this.claveNueva());
      nuevas.push(`${u.username} (${u.extension})`);
    }
    if (nuevas.length) {
      this.log.log(
        `Claves SIP generadas en «${tenant}» por ${actor}: ${nuevas.join(', ')}`,
      );
    }
    return nuevas;
  }

  /** Reúne todo lo que el generador necesita. */
  private async datosDe(
    planta: PlantaAsteriskEntity,
    secretos: { apiKey: string; ariClave: string; clavesSip: boolean },
  ): Promise<DatosPlanta> {
    const [troncales, numeros, operadores] = await Promise.all([
      this.troncales.find({
        where: { tenant: planta.tenant },
        order: { prioridad: 'ASC' },
      }),
      this.numeros.find({
        where: { tenant: planta.tenant },
        order: { numero: 'ASC' },
      }),
      this.usuarios.conExtension(planta.tenant),
    ]);
    const activas = troncales.filter((t) => t.activa);
    const presentado =
      numeros.find((n) => n.tipo === 'did' && n.activo)?.numero ?? null;

    return {
      tenant: planta.tenant,
      dominioSip: planta.dominioSip,
      puertoSip: planta.puertoSip,
      rtpDesde: planta.rtpDesde,
      rtpHasta: planta.rtpHasta,
      puertoHttp: planta.puertoHttp,
      ipPublica: ipPublicaDe(planta),
      ipInterna: ipInternaDe(planta),
      operadores: operadores
        .filter((u) => (u.extension ?? '').trim())
        .map((u) => ({
          extension: (u.extension ?? '').trim(),
          nombre: u.nombre || u.username,
          clave: secretos.clavesSip
            ? this.usuarios.claveSipDe(u)
            : SECRETO_OCULTO,
        })),
      troncales: activas.map((t) => ({
        nombre: t.nombre,
        servidor: t.servidor,
        puerto: t.puerto,
        autenticacion: t.autenticacion,
        usuario: t.usuario,
        clave: secretos.clavesSip ? this.claveTroncal(t) : SECRETO_OCULTO,
        redes: t.redes,
        // El número que presenta al salir: el DID de la instancia. Sin él,
        // toda saliente por esa troncal es un 403.
        numeroPresentado: presentado,
      })),
      numeros: numeros
        .filter((n) => n.activo)
        .map((n) => ({ numero: n.numero, tipo: n.tipo, destino: n.destino })),
      falconUrl: (
        process.env.FALCON_URL_PUBLICA ?? 'https://falconcad.com.co'
      ).trim(),
      carpeta: this.carpetaDe(planta),
      apiKey: secretos.apiKey,
      ariClave: secretos.ariClave,
    };
  }

  private claveTroncal(t: PbxTroncalEntity): string {
    if (!t.clave) return '';
    try {
      return descifrar(t.clave, this.llave());
    } catch {
      // Igual que con las credenciales de proveedor: vacío y anotado, no una
      // excepción. Vacío hace que la troncal no registre y eso se ve en
      // «pjsip show registrations»; reventar aquí dejaría sin generar la
      // configuración entera por una clave vieja.
      this.log.error(
        `No se pudo descifrar la clave de la troncal «${t.nombre}» de «${t.tenant}»: la llave de ` +
          'cifrado del servidor cambió. Vuelva a guardarla.',
      );
      return '';
    }
  }

  /**
   * Lo que le falta a la planta para atender una llamada, en orden de
   * importancia. Es lo que convierte la pantalla en algo que se puede seguir
   * sin saber de telefonía.
   */
  private async advertencias(
    planta: PlantaAsteriskEntity,
    previa: boolean,
  ): Promise<string[]> {
    const avisos: string[] = [];
    if (!ipPublicaDe(planta)) {
      avisos.push(
        'Falta la IP pública del servidor: sin ella la llamada entra con audio de una sola vía.',
      );
    }
    if (previa) {
      avisos.push(
        'Esta es una vista previa: las claves aparecen sustituidas. Al aplicar se generan y se ' +
          'escriben en los archivos.',
      );
    }
    return avisos;
  }

  private async vista(p: PlantaAsteriskEntity): Promise<VistaPlanta> {
    const [troncales, numeros, operadores] = await Promise.all([
      this.troncales.find({
        where: { tenant: p.tenant },
        order: { prioridad: 'ASC' },
      }),
      this.numeros.find({
        where: { tenant: p.tenant },
        order: { numero: 'ASC' },
      }),
      this.usuarios.conExtension(p.tenant),
    ]);
    const conClave = operadores.filter((u) => !!this.usuarios.claveSipDe(u));

    const faltan: string[] = [];
    if (!ipPublicaDe(p)) faltan.push('la IP pública del servidor');
    if (!troncales.some((t) => t.activa)) {
      faltan.push(
        'una troncal activa (por dónde entra la llamada del ciudadano)',
      );
    }
    for (const t of troncales.filter(
      (x) => x.activa && x.autenticacion === 'ip',
    )) {
      if (!redesDe(t.redes).length) {
        faltan.push(
          `las subredes del SBC de «${t.nombre}» (sin ellas no recibe llamadas)`,
        );
      }
    }
    if (!numeros.some((n) => n.activo))
      faltan.push('el número que marca el ciudadano');
    if (!operadores.length)
      faltan.push('al menos un funcionario con extensión');
    else if (!conClave.length)
      faltan.push('la clave SIP de los operadores (se genera al aplicar)');
    if (p.estado === 'borrador')
      faltan.push('aplicar la configuración en el servidor');
    if (p.estado === 'suspendida') faltan.push('la planta está suspendida');

    return {
      tenant: p.tenant,
      servidor: p.servidor,
      ipPublica: ipPublicaDe(p),
      ipInterna: ipInternaDe(p),
      dominioSip: p.dominioSip,
      contenedor: nombreContenedor(p.tenant),
      puertoSip: p.puertoSip,
      rtpDesde: p.rtpDesde,
      rtpHasta: p.rtpHasta,
      puertoHttp: p.puertoHttp,
      estado: p.estado,
      notas: p.notas ?? null,
      wss: urlWss(p),
      ari: urlAri(p),
      troncales: troncales.map((t) => this.vistaTroncal(t)),
      numeros: numeros.map((n) => this.vistaNumero(n)),
      operadores: operadores.length,
      operadoresConClave: conClave.length,
      faltan,
      actualizadoPor: p.actualizadoPor ?? null,
      actualizadoEn: p.actualizadoEn ?? null,
    };
  }

  private vistaTroncal(t: PbxTroncalEntity): VistaTroncal {
    return {
      id: t.id,
      nombre: t.nombre,
      proveedor: t.proveedor,
      servidor: t.servidor,
      puerto: t.puerto,
      autenticacion: t.autenticacion,
      usuario: t.usuario ?? null,
      // Un sí o un no. Nunca la clave, ni sus últimos cuatro caracteres: eso
      // es un cuarto de la clave regalado a quien mire la pantalla.
      clavePuesta: !!t.clave,
      redes: redesDe(t.redes),
      canales: t.canales,
      prioridad: t.prioridad,
      activa: t.activa,
    };
  }

  private vistaNumero(n: PbxNumeroEntity): VistaNumero {
    return {
      id: n.id,
      numero: n.numero,
      tipo: n.tipo,
      troncalId: n.troncalId ?? null,
      destino: n.destino,
      descripcion: n.descripcion ?? null,
      activo: n.activo,
    };
  }
}
