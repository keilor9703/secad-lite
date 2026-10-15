import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CasosService } from '../casos/casos.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { PbxService } from './pbx.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { puede } from './proveedores/proveedor';
import { descriptor as descriptorDe, proveedor as proveedorDe } from './proveedores/registro';

/** Lo que se le cuenta al operador después de pedir la llamada. */
export interface ResultadoLlamar {
  ok: boolean;
  /** Una frase para la pantalla: qué va a pasar ahora, o por qué no pasó. */
  mensaje: string;
  /** La extensión a la que va a timbrar. Sirve para que el operador la mire. */
  extension?: string;
  /**
   * El número tal como se marcó, ya normalizado.
   *
   * Es lo que se anota en la bitácora: lo que escribió el operador puede
   * llevar espacios y paréntesis, y lo que de verdad se le pidió a la central
   * es esto. Anotar el crudo deja un registro que no coincide con el de la
   * central, y cruzarlos es justo para lo que sirve la bitácora.
   */
  numero?: string;
}

/**
 * LLAMAR DESDE EL CASO.
 *
 * No es FALCON llamando al ciudadano: es FALCON pidiéndole a la central que
 * llame **primero a la extensión del operador** y, cuando descuelgue, al
 * ciudadano. Por eso funciona sin softphone y sin WebRTC: el audio nunca pasa
 * por el navegador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA EXTENSIÓN NO LA ELIGE EL NAVEGADOR
 *
 * Sale del usuario que pide la llamada (`usuarios.extension`), nunca del
 * cuerpo de la petición. Si viniera del cliente, cualquiera con `pbx.usar`
 * podría hacer timbrar el teléfono de otro operador —o de la extensión de la
 * sala de supervisión— y dejar la llamada atribuida a él en el registro de la
 * central. Es una llamada facturable que queda a nombre de alguien.
 *
 * Los frenos son esos tres, y son suficientes sin inventar un permiso nuevo
 * que nadie tendría: solo puede hacer timbrar SU propia extensión, cada
 * intento queda en la bitácora de administración con el número, y el
 * controlador acota la frecuencia.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PbxSalienteService {
  private readonly log = new Logger(PbxSalienteService.name);

  constructor(
    private readonly cred: PbxCredencialesService,
    private readonly usuarios: UsuariosService,
    private readonly casos: CasosService,
  ) {}

  async marcar(
    tenant: string, actor: string, orden: { numero?: string; casoId?: string },
  ): Promise<ResultadoLlamar> {
    const crudo = orden.numero?.trim();
    if (!crudo) throw new BadRequestException('Indique el número al que se va a llamar.');
    const numero = PbxService.normalizarNumero(crudo);
    if (!PbxService.esNumeroMarcable(numero)) {
      // Pasa de verdad: para los contactos de WhatsApp la central manda un
      // identificador de sesión (`+CO.1744934636794102`) que parece un número
      // y no se puede marcar.
      throw new BadRequestException(
        `«${crudo}» no es un número que se pueda marcar. Pídale el número al ciudadano.`,
      );
    }

    // El usuario de la instancia; con `tenant: null` se cubre al superadmin,
    // cuya cuenta no pertenece a ningún municipio pero puede tener extensión.
    const usuario = (await this.usuarios.buscarPorUsernameYTenant(actor, tenant))
      ?? (await this.usuarios.buscarPorUsernameYTenant(actor, null));
    const extension = usuario?.extension?.trim();
    if (!extension) {
      throw new BadRequestException(
        'Su usuario no tiene extensión asignada, así que no hay a dónde timbrarle primero. '
        + 'Pídale a un administrador que la registre en Administración → Usuarios.',
      );
    }

    const fila = await this.cred.configDe(tenant);
    const clave = this.cred.claveProveedor(fila);
    const d = descriptorDe(clave);
    const impl = proveedorDe(clave);
    if (!d || !impl) throw new BadRequestException('Esta instancia no tiene una planta telefónica reconocida.');
    if (fila && !fila.activo) {
      throw new BadRequestException(`La planta telefónica (${d.nombre}) está apagada para esta instancia.`);
    }
    if (!puede(d, 'marcar') || !impl.marcar) {
      // La pantalla no debería haber ofrecido el botón, pero el servidor no
      // puede confiar en eso.
      throw new BadRequestException(
        `${d.nombre} no permite originar llamadas desde FALCON: la llamada la controla su plataforma.`,
      );
    }

    const r = await impl.marcar(this.cred.enClaro(fila), { extension, numero });
    if (!r.ok) {
      this.log.warn(`No se pudo originar la llamada a ${numero} para ${actor} (${tenant}): ${r.error}`);
      return { ok: false, mensaje: r.error ?? 'No fue posible originar la llamada.', extension, numero };
    }

    // La nota en el caso es aparte y no puede tumbar nada: la llamada YA se
    // pidió, y perderla por no poder escribir la nota sería lo peor de los dos
    // mundos. Queda en el log del proceso si falla.
    if (orden.casoId) {
      await this.casos
        .agregarNota(tenant, orden.casoId, `Llamada saliente a ${numero} solicitada desde FALCON.`, actor)
        .catch((e: Error) => this.log.warn(`Llamada pedida, pero sin nota en el caso ${orden.casoId}: ${e.message}`));
    }

    return {
      ok: true,
      extension,
      numero,
      mensaje: `Va a timbrar su extensión ${extension}. Al descolgar, la central llama a ${numero}.`,
    };
  }
}
