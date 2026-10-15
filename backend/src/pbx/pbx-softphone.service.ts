import { Injectable } from '@nestjs/common';
import { UsuariosService } from '../usuarios/usuarios.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { ConfigSoftphone, puede } from './proveedores/proveedor';
import { descriptor as descriptorDe, proveedor as proveedorDe } from './proveedores/registro';

/**
 * Lo que recibe el navegador del operador.
 *
 * `disponible: false` con su motivo es un resultado NORMAL y frecuente, no un
 * error: la telefonía funciona igual sin softphone —se contesta en MicroSIP,
 * en el teléfono web del panel o en el móvil— y lo único que cambia es que
 * atender en FALCON sigue siendo un segundo gesto. La pantalla lo dice en vez
 * de intentar registrarse contra una dirección vacía y mostrar un error de
 * WebSocket que nadie puede interpretar.
 */
export type RespuestaSoftphone =
  | { disponible: true; config: ConfigSoftphone }
  | { disponible: false; motivo: string };

/**
 * CONTESTAR DENTRO DE FALCON: la configuración, y nada más.
 *
 * Esto no habla SIP. Solo reúne lo que el navegador necesita para registrarse
 * como teléfono —la dirección de señalización y el dominio de la instancia, la
 * extensión del operador y su clave— y se lo entrega a ÉL, nunca a otro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOBRE LA CLAVE SIP VIAJANDO AL NAVEGADOR
 *
 * Viaja, y es inevitable: en un softphone web el que se registra contra la
 * central es el navegador. No es un descuido, es la forma de la cosa. Lo que
 * sí se puede acotar es el alcance, y se acota:
 *
 *  - solo la clave del usuario que la pide, resuelta de su sesión;
 *  - solo por esta ruta, que exige `pbx.usar`;
 *  - nunca en un listado de administración, donde solo se dice si está puesta;
 *  - nunca en un registro del proceso ni en la bitácora.
 *
 * Quien quiera un softphone sin esto tiene que contestar por fuera de FALCON,
 * que es exactamente la alternativa que esto viene a reemplazar.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PbxSoftphoneService {
  constructor(
    private readonly cred: PbxCredencialesService,
    private readonly usuarios: UsuariosService,
  ) {}

  async configDe(tenant: string, actor: string): Promise<RespuestaSoftphone> {
    const fila = await this.cred.configDe(tenant);
    const clave = this.cred.claveProveedor(fila);
    const d = descriptorDe(clave);
    const impl = proveedorDe(clave);
    if (!d || !impl) return { disponible: false, motivo: 'Esta instancia no tiene una planta telefónica reconocida.' };
    if (fila && !fila.activo) {
      return { disponible: false, motivo: `La planta telefónica (${d.nombre}) está apagada para esta instancia.` };
    }
    if (!puede(d, 'softphone') || !impl.softphone) {
      return {
        disponible: false,
        motivo: `${d.nombre} no permite contestar dentro de FALCON. Las llamadas entran a la cola igual, `
          + 'pero se contestan en el teléfono de siempre.',
      };
    }

    const usuario = (await this.usuarios.buscarPorUsernameYTenant(actor, tenant))
      ?? (await this.usuarios.buscarPorUsernameYTenant(actor, null));
    const extension = usuario?.extension?.trim();
    if (!extension) {
      return {
        disponible: false,
        motivo: 'Su usuario no tiene extensión asignada. Pídale a un administrador que la registre '
          + 'en Administración → Usuarios.',
      };
    }
    const claveSip = this.usuarios.claveSipDe(usuario);
    if (!claveSip) {
      return {
        disponible: false,
        motivo: `Falta la clave SIP de la extensión ${extension}. Un administrador la registra en `
          + 'Administración → Usuarios; se consigue en el panel de la centralita, con los datos de esa extensión.',
      };
    }

    const config = impl.softphone(this.cred.enClaro(fila), extension, claveSip);
    if (!config) {
      return {
        disponible: false,
        motivo: `Falta configurar el WebSocket SIP y el dominio de ${d.nombre} para esta instancia `
          + '(Plataforma → Planta telefónica).',
      };
    }
    return { disponible: true, config };
  }
}
