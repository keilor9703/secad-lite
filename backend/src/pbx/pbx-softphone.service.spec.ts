import { PbxSoftphoneService } from './pbx-softphone.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { ConfigPbxEntity } from './config-pbx.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';

/**
 * Lo que recibe el navegador para registrarse como teléfono.
 *
 * Lo que se protege:
 *
 *  1. **Que «no disponible» siempre diga POR QUÉ.** Son cinco razones
 *     distintas y todas son estados normales —instancia sin configurar,
 *     usuario sin extensión, sin clave, proveedor que no lo permite, planta
 *     apagada—. Un softphone que no arranca sin explicar nada manda al
 *     operador a buscar al administrador sin saber qué pedirle.
 *  2. **Que la clave sea la del que pide, descifrada**, y que no se entregue
 *     media configuración: sin WSS no hay registro posible, así que no se
 *     devuelve «disponible» con un hueco.
 */
describe('PbxSoftphoneService', () => {
  let fila: Partial<ConfigPbxEntity> | null;
  let usuario: Partial<UsuarioEntity> | null;
  let claveSip: string;
  let credenciales: Record<string, string>;
  let svc: PbxSoftphoneService;

  const CRED_COMPLETAS = {
    key: 'k', secreto: 's', sipCuenta: '598703',
    sipWss: 'wss://wss.ejemplo.com', sipDominio: 'sip.ejemplo.com',
  };

  beforeEach(() => {
    fila = { tenant: 'itagui', proveedor: 'ZADARMA', activo: true };
    usuario = { username: 'pedro', extension: '102' };
    claveSip = 'clave-sip-de-la-102';
    credenciales = { ...CRED_COMPLETAS };

    const cred = {
      configDe: async () => fila as ConfigPbxEntity | null,
      claveProveedor: () => fila?.proveedor ?? 'YACO',
      enClaro: () => credenciales,
    } as unknown as PbxCredencialesService;
    const usuarios = {
      buscarPorUsernameYTenant: async () => usuario as UsuarioEntity | null,
      claveSipDe: () => claveSip,
    } as unknown as UsuariosService;

    svc = new PbxSoftphoneService(cred, usuarios);
  });

  it('con todo en su sitio, entrega la configuración de ESE operador', async () => {
    const r = await svc.configDe('itagui', 'pedro');

    expect(r).toEqual({
      disponible: true,
      config: {
        wss: 'wss://wss.ejemplo.com',
        dominio: 'sip.ejemplo.com',
        // El usuario SIP lo compone el proveedor: cuenta + extensión.
        usuario: '598703-102',
        extension: '102',
        clave: 'clave-sip-de-la-102',
      },
    });
  });

  describe('no disponible, y siempre con su motivo', () => {
    it('la planta está apagada', async () => {
      fila = { tenant: 'itagui', proveedor: 'ZADARMA', activo: false };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
      if (r.disponible) return;
      expect(r.motivo).toContain('apagada');
    });

    it('el proveedor no permite contestar dentro de FALCON', async () => {
      // Con YACO la llamada la controla su plataforma. Y el motivo dice que la
      // telefonía sigue funcionando, que es lo que evita el susto.
      fila = { tenant: 'itagui', proveedor: 'YACO', activo: true };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
      if (r.disponible) return;
      expect(r.motivo).toContain('no permite contestar dentro de FALCON');
      expect(r.motivo).toContain('entran a la cola igual');
    });

    it('el usuario no tiene extensión, y se dice qué pedir', async () => {
      usuario = { username: 'pedro', extension: null };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
      if (r.disponible) return;
      expect(r.motivo).toContain('Administración → Usuarios');
    });

    it('falta la clave SIP de esa extensión, y se dice de cuál', async () => {
      claveSip = '';
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
      if (r.disponible) return;
      expect(r.motivo).toContain('102');
    });

    it('falta el WebSocket de la instancia: media configuración no sirve', async () => {
      // Registrarse contra una dirección vacía da un error de WebSocket que
      // nadie puede interpretar.
      credenciales = { ...CRED_COMPLETAS, sipWss: '' };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
      if (r.disponible) return;
      expect(r.motivo).toContain('Plataforma → Planta telefónica');
    });

    it('falta el dominio SIP, igual', async () => {
      credenciales = { ...CRED_COMPLETAS, sipDominio: '' };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
    });

    it('falta el número de cuenta: sin él el usuario SIP queda mal compuesto', async () => {
      credenciales = { ...CRED_COMPLETAS, sipCuenta: '' };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
    });

    it('una instancia con un proveedor que no está en el registro', async () => {
      fila = { tenant: 'itagui', proveedor: 'INVENTADO', activo: true };
      const r = await svc.configDe('itagui', 'pedro');
      expect(r.disponible).toBe(false);
    });
  });

  it('sin fila de configuración, la planta por defecto no da softphone', async () => {
    // YACO es el por defecto, y no lo permite. Lo importante es que lo diga en
    // vez de entregar una configuración a medias.
    fila = null;
    const r = await svc.configDe('itagui', 'pedro');
    expect(r.disponible).toBe(false);
  });
});
