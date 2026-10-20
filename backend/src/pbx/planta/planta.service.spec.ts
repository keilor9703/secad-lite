import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PlantaService, SECRETO_OCULTO } from './planta.service';
import { PlantaAsteriskEntity } from './planta-asterisk.entity';
import { PbxTroncalEntity } from './pbx-troncal.entity';
import { PbxNumeroEntity } from './pbx-numero.entity';
import { PbxConfigService } from '../pbx-config.service';
import { PbxCredencialesService } from '../pbx-credenciales.service';
import { UsuariosService } from '../../usuarios/usuarios.service';
import { TenantsService } from '../../tenants/tenants.service';
import { UsuarioEntity } from '../../usuarios/usuario.entity';

/**
 * Provisionar la planta de un municipio.
 *
 * Lo que se protege, que es lo que hoy se hace a mano y se equivoca:
 *
 *  1. **Que los puertos no se pisen** —ni al dar de alta, ni al registrar a
 *     mano una planta que ya existe—. Dos contenedores con el mismo puerto:
 *     el segundo no arranca y el municipio queda sin teléfono.
 *  2. **Que `config_pbx` lo escriba la planta y no una persona.** El dominio
 *     copiado a mano de una pantalla a otra se desincroniza el día que se
 *     migra de servidor, y el síntoma es un softphone «conectando» para
 *     siempre.
 *  3. **Que las claves las ponga el sistema**, y que NUNCA se sobrescriba una
 *     clave SIP que ya existe: si el operador tiene un teléfono físico
 *     registrado con ella, cambiarla lo deja sin línea y se descubre en la
 *     próxima emergencia.
 *  4. **Que la vista previa no rote nada.** Mirar no puede invalidar la API
 *     key de una instancia en producción.
 *  5. **Que aplicar avise de lo que rompe mientras no se instale.**
 *  6. **Que la pantalla diga qué falta** en vez de dejar al administrador
 *     adivinando por qué no entra una llamada.
 */
describe('PlantaService', () => {
  let plantas: PlantaAsteriskEntity[];
  let troncales: PbxTroncalEntity[];
  let numeros: PbxNumeroEntity[];
  let usuarios: Partial<UsuarioEntity>[];
  let credGuardadas: Record<string, string>;
  let guardados: {
    tenant?: string;
    proveedor?: string;
    credenciales?: Record<string, string>;
  }[];
  let rotada: number;
  let clavesPuestas: { id: string; clave: string | null }[];
  let svc: PlantaService;

  /** Un repositorio en memoria que basta para lo que usa el servicio. */
  function repo<T extends { id?: string }>(datos: T[]): Repository<T> {
    const casa = (f: T, where: Record<string, unknown> = {}): boolean =>
      Object.entries(where).every(
        ([k, v]) => (f as Record<string, unknown>)[k] === v,
      );
    return {
      find: async (o: { where?: Record<string, unknown> } = {}) =>
        datos.filter((f) => casa(f, o.where)),
      findOne: async (o: { where?: Record<string, unknown> } = {}) =>
        datos.find((f) => casa(f, o.where)) ?? null,
      create: (x: Partial<T> = {}) => ({ ...x }) as T,
      save: async (x: T) => {
        if (!x.id) {
          (x as { id?: string }).id = `id-${datos.length + 1}`;
          datos.push(x);
        } else if (!datos.includes(x)) {
          const i = datos.findIndex((f) => f.id === x.id);
          if (i >= 0) datos[i] = x;
          else datos.push(x);
        }
        return x;
      },
      delete: async (where: Record<string, unknown>) => {
        for (let i = datos.length - 1; i >= 0; i--) {
          if (casa(datos[i], where)) datos.splice(i, 1);
        }
        return { affected: 1 };
      },
    } as unknown as Repository<T>;
  }

  beforeEach(() => {
    plantas = [];
    troncales = [];
    numeros = [];
    usuarios = [];
    credGuardadas = {};
    guardados = [];
    rotada = 0;
    clavesPuestas = [];
    process.env.JWT_SECRET = 'llave-de-pruebas';
    process.env.PBX_DOMINIO_BASE = 'falconcad.com.co';
    process.env.FALCON_URL_PUBLICA = 'https://falconcad.com.co';

    const config = {
      guardar: async (dto: {
        tenant?: string;
        credenciales?: Record<string, string>;
      }) => {
        guardados.push(dto);
        Object.assign(credGuardadas, dto.credenciales ?? {});
        return {} as never;
      },
    } as unknown as PbxConfigService;

    const cred = {
      configDe: async () => ({ tenant: 'itagui' }),
      enClaro: () => ({ ...credGuardadas }),
    } as unknown as PbxCredencialesService;

    const usuariosSvc = {
      conExtension: async () => usuarios as UsuarioEntity[],
      claveSipDe: (u: UsuarioEntity | null) =>
        (u as { sipClave?: string })?.sipClave ?? '',
      registrarClaveSip: async (id: string, clave: string | null) => {
        clavesPuestas.push({ id, clave });
        const u = usuarios.find((x) => x.id === id) as
          { sipClave?: string } | undefined;
        if (u) u.sipClave = clave ?? undefined;
        return { tieneClaveSip: !!clave };
      },
    } as unknown as UsuariosService;

    const tenants = {
      rotarApiKey: async () => {
        rotada += 1;
        return `fk_nueva_${rotada}`;
      },
    } as unknown as TenantsService;

    svc = new PlantaService(
      repo(plantas),
      repo(troncales),
      repo(numeros),
      config,
      cred,
      usuariosSvc,
      tenants,
    );
  });

  const alta = (tenant: string, servidor = '129.80.243.118') =>
    svc.crear({ tenant, servidor }, 'admin');

  describe('dar de alta', () => {
    it('reserva la primera ranura libre del servidor y deja la planta en borrador', async () => {
      const v = await alta('itagui');
      expect(v.puertoSip).toBe(5060);
      expect(v.rtpDesde).toBe(20500);
      expect(v.rtpHasta).toBe(20999);
      expect(v.puertoHttp).toBe(8100);
      expect(v.estado).toBe('borrador');
      expect(v.contenedor).toBe('asterisk-itagui');
    });

    it('deriva el nombre de la planta: dar de alta no exige inventar un subdominio', async () => {
      const v = await alta('itagui');
      expect(v.dominioSip).toBe('itagui-pbx.falconcad.com.co');
      expect(v.wss).toBe('wss://itagui-pbx.falconcad.com.co/ws');
      expect(v.ari).toBe('https://itagui-pbx.falconcad.com.co/ari');
    });

    it('la IP pública sale del servidor cuando el servidor ya es una IP', async () => {
      expect((await alta('itagui')).ipPublica).toBe('129.80.243.118');
      const porNombre = await svc.crear(
        {
          tenant: 'envigado',
          servidor: 'pbx2.falconcad.com.co',
          ipPublica: '1.2.3.4',
        },
        'admin',
      );
      expect(porNombre.ipPublica).toBe('1.2.3.4');
    });

    it('escribe config_pbx ella misma: el dominio no se copia a mano de una pantalla a otra', async () => {
      await alta('itagui');
      expect(guardados).toHaveLength(1);
      expect(guardados[0]).toMatchObject({
        tenant: 'itagui',
        proveedor: 'ASTERISK',
      });
      expect(guardados[0].credenciales).toMatchObject({
        wss: 'wss://itagui-pbx.falconcad.com.co/ws',
        dominio: 'itagui-pbx.falconcad.com.co',
        ariUrl: 'https://itagui-pbx.falconcad.com.co/ari',
        ariUsuario: 'falcon',
        contextoSaliente: 'salientes',
      });
      // La clave de ARI NO se genera al dar de alta: se genera al aplicar.
      expect(guardados[0].credenciales?.ariClave).toBeUndefined();
    });

    it('la segunda planta del mismo servidor no pisa a la primera', async () => {
      await alta('itagui');
      const dos = await alta('envigado');
      expect(dos.puertoSip).toBe(5061);
      expect(dos.rtpDesde).toBe(21000);
      expect(dos.puertoHttp).toBe(8101);
    });

    it('en otro servidor los puertos vuelven a empezar: son de cada host', async () => {
      await alta('itagui');
      const otro = await alta('sabaneta', '157.137.211.196');
      expect(otro.puertoSip).toBe(5060);
      expect(otro.rtpDesde).toBe(20500);
    });

    it('una instancia no puede tener dos plantas', async () => {
      await alta('itagui');
      await expect(alta('itagui')).rejects.toThrow(ConflictException);
    });

    it('dos plantas no pueden compartir nombre: es lo que nginx mira para enrutar', async () => {
      await alta('itagui');
      await expect(
        svc.crear(
          {
            tenant: 'otro',
            servidor: 'otro-host',
            dominioSip: 'itagui-pbx.falconcad.com.co',
          },
          'admin',
        ),
      ).rejects.toThrow(/ya lo usa otra planta/);
    });

    it('cuando el servidor se llena lo dice, en vez de repartir un puerto repetido', async () => {
      for (let i = 0; i < 24; i++) await alta(`m${i}`);
      await expect(alta('uno-mas')).rejects.toThrow(
        /ya no tiene puertos libres/,
      );
    });

    it('sin instancia o sin servidor no da de alta nada', async () => {
      await expect(svc.crear({ servidor: 'x' }, 'admin')).rejects.toThrow(
        /instancia/,
      );
      await expect(svc.crear({ tenant: 'x' }, 'admin')).rejects.toThrow(
        /servidor/,
      );
    });
  });

  describe('editar', () => {
    it('acepta los puertos de una planta que ya existe fuera de la banda', async () => {
      await alta('itagui');
      const v = await svc.actualizar('itagui', { puertoSip: 3478 }, 'admin');
      expect(v.puertoSip).toBe(3478);
    });

    it('no deja pisar el puerto de otra planta del mismo servidor', async () => {
      await alta('itagui');
      await alta('envigado');
      await expect(
        svc.actualizar('envigado', { puertoSip: 5060 }, 'admin'),
      ).rejects.toThrow(/ya lo usa otra planta/);
    });

    it('rechaza 127.0.0.1 como IP privada: es justo la avería que arregla', async () => {
      await alta('itagui');
      await expect(
        svc.actualizar('itagui', { ipPrivada: '127.0.0.1' }, 'admin'),
      ).rejects.toThrow(/127\.0\.0\.1/);
      await expect(
        svc.actualizar('itagui', { ipPrivada: '10.0.0.999' }, 'admin'),
      ).rejects.toThrow(/IPv4/);
    });

    it('vacía es válida: hay servidores que no la necesitan', async () => {
      const v = await alta('itagui');
      expect(v.ipPrivada).toBe('');
      const r = await svc.actualizar('itagui', { ipPrivada: '' }, 'admin');
      expect(r.ipPrivada).toBe('');
    });

    it('la IP interna por defecto es 127.0.0.1, que es la más cerrada', async () => {
      const v = await alta('itagui');
      expect(v.ipInterna).toBe('127.0.0.1');
    });

    it('acepta la IP del puente de Docker, que es el caso del nginx en contenedor', async () => {
      await alta('itagui');
      const v = await svc.actualizar(
        'itagui',
        { ipInterna: '172.17.0.1' },
        'admin',
      );
      expect(v.ipInterna).toBe('172.17.0.1');
    });

    it('rechaza 0.0.0.0 por nombre: es ARI escuchando en todas las interfaces', async () => {
      // «Funciona» en los dos casos, y por eso es la tentación cuando algo no
      // conecta. Lo que deja es ARI —con solo su clave— escuchando en todas
      // las interfaces del host: hoy tapado por el cortafuegos, abierto a
      // internet el día que alguien abra ese puerto en la nube para depurar.
      await alta('itagui');
      await expect(
        svc.actualizar('itagui', { ipInterna: '0.0.0.0' }, 'admin'),
      ).rejects.toThrow(/0\.0\.0\.0/);
    });

    it('rechaza lo que no sea una IPv4, y dice dónde se saca la buena', async () => {
      await alta('itagui');
      await expect(
        svc.actualizar('itagui', { ipInterna: 'docker0' }, 'admin'),
      ).rejects.toThrow(/docker0/);
      await expect(
        svc.actualizar('itagui', { ipInterna: '999.1.1.1' }, 'admin'),
      ).rejects.toThrow(/IPv4/);
    });

    it('vaciar el campo vuelve al valor cerrado, no deja la planta sin IP', async () => {
      await alta('itagui');
      await svc.actualizar('itagui', { ipInterna: '172.17.0.1' }, 'admin');
      const v = await svc.actualizar('itagui', { ipInterna: '' }, 'admin');
      expect(v.ipInterna).toBe('127.0.0.1');
    });

    it('no choca consigo misma al guardar sin cambiar los puertos', async () => {
      await alta('itagui');
      await expect(
        svc.actualizar('itagui', { notas: 'escucha en el 3478' }, 'admin'),
      ).resolves.toBeTruthy();
    });

    it('al cambiar el nombre reescribe config_pbx: si no, el softphone apunta al sitio viejo', async () => {
      await alta('itagui');
      guardados.length = 0;
      const v = await svc.actualizar(
        'itagui',
        { dominioSip: 'itagui.pbx.ejemplo.com' },
        'admin',
      );
      expect(v.wss).toBe('wss://itagui.pbx.ejemplo.com/ws');
      expect(guardados[0].credenciales?.wss).toBe(
        'wss://itagui.pbx.ejemplo.com/ws',
      );
    });

    it('solo borra una planta que nunca se montó', async () => {
      await alta('itagui');
      await svc.actualizar('itagui', { estado: 'activa' }, 'admin');
      await expect(svc.eliminar('itagui', 'admin')).rejects.toThrow(
        /Suspéndala primero/,
      );
      await svc.actualizar('itagui', { estado: 'borrador' }, 'admin');
      await expect(svc.eliminar('itagui', 'admin')).resolves.toEqual({
        tenant: 'itagui',
      });
      expect(plantas).toHaveLength(0);
    });
  });

  describe('troncales y números', () => {
    beforeEach(async () => {
      await alta('itagui');
    });

    const troncalInfobip = {
      nombre: 'Infobip Bogotá',
      proveedor: 'infobip',
      servidor: 'sbc.infobip.com',
      autenticacion: 'ip' as const,
      redes: '81.23.252.0/24, 81.23.253.0/24',
      canales: 10,
    };

    it('guarda la troncal y devuelve sus redes, nunca su clave', async () => {
      const t = await svc.guardarTroncal(
        'itagui',
        { ...troncalInfobip },
        'admin',
      );
      expect(t.proveedor).toBe('INFOBIP');
      expect(t.redes).toEqual(['81.23.252.0/24', '81.23.253.0/24']);
      expect(t.clavePuesta).toBe(false);
      expect(JSON.stringify(t)).not.toContain('clave"');
    });

    it('rechaza una subred inválida: tumbaría el módulo pjsip completo', async () => {
      await expect(
        svc.guardarTroncal(
          'itagui',
          { ...troncalInfobip, redes: '81.23.252.0/99' },
          'admin',
        ),
      ).rejects.toThrow(/no es una dirección ni una subred válida/);
    });

    it('una troncal con registro exige usuario', async () => {
      await expect(
        svc.guardarTroncal(
          'itagui',
          { ...troncalInfobip, autenticacion: 'registro' },
          'admin',
        ),
      ).rejects.toThrow(/usuario y clave/);
    });

    it('la clave de la troncal es solo de escritura: se conserva si no viene', async () => {
      const t = await svc.guardarTroncal(
        'itagui',
        {
          ...troncalInfobip,
          autenticacion: 'registro',
          usuario: 'u',
          clave: 'secreta',
        },
        'admin',
      );
      expect(t.clavePuesta).toBe(true);
      const sinClave = await svc.guardarTroncal(
        'itagui',
        { id: t.id, canales: 20 },
        'admin',
      );
      expect(sinClave.clavePuesta).toBe(true);
      expect(sinClave.canales).toBe(20);
    });

    it('normaliza el número antes de guardarlo: con un guion no casa con ningún patrón', async () => {
      const n = await svc.guardarNumero(
        'itagui',
        { numero: '300-123 4567' },
        'admin',
      );
      expect(n.numero).toBe('+573001234567');
      expect(n.destino).toBe('cola');
      const corto = await svc.guardarNumero(
        'itagui',
        { numero: '123', tipo: 'corto' },
        'admin',
      );
      expect(corto.numero).toBe('123');
    });

    it('una troncal de otra instancia no se puede enlazar a un número', async () => {
      await expect(
        svc.guardarNumero(
          'itagui',
          { numero: '+573001234567', troncalId: 'de-otro' },
          'admin',
        ),
      ).rejects.toThrow(/no es de esta instancia/);
    });
  });

  describe('la vista previa', () => {
    beforeEach(async () => {
      await alta('itagui');
      await svc.guardarTroncal(
        'itagui',
        {
          nombre: 'Infobip',
          proveedor: 'INFOBIP',
          servidor: 'sbc.infobip.com',
          autenticacion: 'ip',
          redes: '81.23.252.0/24',
        },
        'admin',
      );
      await svc.guardarNumero('itagui', { numero: '+18335308128' }, 'admin');
      usuarios.push({
        id: 'u1',
        username: 'ana',
        nombre: 'Ana',
        extension: '101',
      });
    });

    it('la IP privada llega a pjsip y a rtp: es lo que da audio al navegador', async () => {
      // Sin ella, el socket de audio del operador abre en 127.0.0.1 —porque
      // Asterisk hereda la dirección del transporte del WebSocket— y la
      // llamada se contesta sin que se oiga nada de ningún lado.
      await svc.actualizar('itagui', { ipPrivada: '10.0.0.112' }, 'admin');
      const c = await svc.previa('itagui');
      const texto = (fin: string) =>
        c.archivos.find((a) => a.ruta.endsWith(fin))!.contenido;
      expect(texto('pjsip.conf')).toContain('bind_rtp_to_media_address = yes');
      expect(texto('rtp.conf')).toContain('[ice_host_candidates]');
      expect(texto('rtp.conf')).toContain('include_local_address');
    });

    it('la IP interna guardada llega a http.conf y a nginx', async () => {
      // Este es el tramo que puede romperse en silencio: el campo se guarda
      // bien, la pantalla lo muestra bien, y la configuración generada sigue
      // saliendo con 127.0.0.1 porque nadie lo pasó a los datos del
      // generador. El síntoma sería un 502 en el softphone y una pantalla
      // que dice que todo está correcto.
      await svc.actualizar('itagui', { ipInterna: '172.17.0.1' }, 'admin');
      const c = await svc.previa('itagui');
      const texto = (fin: string) =>
        c.archivos.find((a) => a.ruta.endsWith(fin))!.contenido;
      expect(texto('http.conf')).toContain('bindaddr = 172.17.0.1');
      const sitio = c.archivos.find((a) => a.ruta.startsWith('nginx/'))!;
      expect(sitio.contenido).toContain('http://172.17.0.1:');
      expect(sitio.contenido).not.toContain('127.0.0.1');
    });

    it('no rota la API key ni crea claves: mirar no puede romper nada', async () => {
      const c = await svc.previa('itagui');
      expect(rotada).toBe(0);
      expect(clavesPuestas).toHaveLength(0);
      expect(c.previa).toBe(true);
    });

    it('sustituye los secretos y lo avisa', async () => {
      const c = await svc.previa('itagui');
      const webhook = c.archivos.find((a) =>
        a.ruta.endsWith('falcon-webhook.conf'),
      )!;
      expect(webhook.contenido).toContain(SECRETO_OCULTO);
      expect(c.advertencias.join(' ')).toContain('vista previa');
    });

    it('dice en qué carpeta del servidor van los archivos', async () => {
      expect((await svc.previa('itagui')).carpeta).toBe(
        '/opt/falcon-pbx/itagui',
      );
    });
  });

  describe('aplicar', () => {
    beforeEach(async () => {
      await alta('itagui');
      await svc.guardarTroncal(
        'itagui',
        {
          nombre: 'Infobip',
          proveedor: 'INFOBIP',
          servidor: 'sbc.infobip.com',
          autenticacion: 'ip',
          redes: '81.23.252.0/24',
        },
        'admin',
      );
      await svc.guardarNumero('itagui', { numero: '+18335308128' }, 'admin');
      usuarios.push({
        id: 'u1',
        username: 'ana',
        nombre: 'Ana',
        extension: '101',
      });
    });

    it('rota la API key y la escribe en el archivo de la planta', async () => {
      const c = await svc.aplicar('itagui', 'admin');
      expect(rotada).toBe(1);
      const webhook = c.archivos.find((a) =>
        a.ruta.endsWith('falcon-webhook.conf'),
      )!;
      expect(webhook.contenido).toContain('fk_nueva_1');
      expect(webhook.secreto).toBe(true);
    });

    it('avisa de que la central vieja deja de poder avisar hasta instalar', async () => {
      const c = await svc.aplicar('itagui', 'admin');
      expect(c.advertencias[0]).toContain('API key');
      expect(c.advertencias[0]).toContain(
        'hasta que estos archivos queden instalados',
      );
    });

    it('le genera clave SIP a quien no tiene, y lo dice', async () => {
      const c = await svc.aplicar('itagui', 'admin');
      expect(clavesPuestas).toHaveLength(1);
      expect(clavesPuestas[0].clave).toBeTruthy();
      expect(c.advertencias.join(' ')).toContain('ana (101)');
      const pjsip = c.archivos.find((a) => a.ruta.endsWith('pjsip.conf'))!;
      expect(pjsip.contenido).toContain(`password = ${clavesPuestas[0].clave}`);
    });

    it('NUNCA sobrescribe una clave SIP que ya existe: dejaría sin línea un teléfono físico', async () => {
      usuarios.push({
        id: 'u2',
        username: 'luis',
        nombre: 'Luis',
        extension: '102',
        sipClave: 'la-de-siempre',
      });
      await svc.aplicar('itagui', 'admin');
      expect(clavesPuestas.map((c) => c.id)).toEqual(['u1']);
    });

    it('genera la clave de ARI una vez y la reutiliza: rotarla rompería el botón «Llamar»', async () => {
      const uno = await svc.aplicar('itagui', 'admin');
      const ari1 = uno.archivos.find((a) =>
        a.ruta.endsWith('ari.conf'),
      )!.contenido;
      const dos = await svc.aplicar('itagui', 'admin');
      const ari2 = dos.archivos.find((a) =>
        a.ruta.endsWith('ari.conf'),
      )!.contenido;
      expect(ari1).toEqual(ari2);
      expect(credGuardadas.ariClave).toBeTruthy();
    });

    it('la planta pasa de borrador a provisionada', async () => {
      await svc.aplicar('itagui', 'admin');
      expect((await svc.ver('itagui')).estado).toBe('provisionada');
    });

    it('sin IP pública no genera nada: entraría con audio de una sola vía', async () => {
      await svc.crear(
        { tenant: 'envigado', servidor: 'pbx2.ejemplo.com' },
        'admin',
      );
      await expect(svc.aplicar('envigado', 'admin')).rejects.toThrow(
        /IP pública/,
      );
    });

    it('el DID activo es el número que la troncal presenta al salir', async () => {
      const c = await svc.aplicar('itagui', 'admin');
      const troncal = c.archivos.find((a) =>
        a.ruta.endsWith('pjsip-troncal.conf'),
      )!;
      expect(troncal.contenido).toContain('from_user = 18335308128');
    });
  });

  describe('qué le falta a la planta', () => {
    it('lo enumera en orden, para poder seguirlo sin saber de telefonía', async () => {
      const v = await alta('itagui');
      expect(v.faltan).toEqual([
        'una troncal activa (por dónde entra la llamada del ciudadano)',
        'el número que marca el ciudadano',
        'al menos un funcionario con extensión',
        'aplicar la configuración en el servidor',
      ]);
    });

    it('señala la troncal por IP sin subredes, que es la que no recibe llamadas', async () => {
      await alta('itagui');
      await svc.guardarTroncal(
        'itagui',
        {
          nombre: 'Infobip',
          proveedor: 'INFOBIP',
          servidor: 'sbc.infobip.com',
          autenticacion: 'ip',
        },
        'admin',
      );
      const v = await svc.ver('itagui');
      expect(v.faltan.join(' ')).toContain('las subredes del SBC de «Infobip»');
    });

    it('señala al operador sin clave SIP, que es el que no puede contestar', async () => {
      await alta('itagui');
      usuarios.push({
        id: 'u1',
        username: 'ana',
        nombre: 'Ana',
        extension: '101',
      });
      const v = await svc.ver('itagui');
      expect(v.operadores).toBe(1);
      expect(v.operadoresConClave).toBe(0);
      expect(v.faltan.join(' ')).toContain('clave SIP');
    });

    it('no falta nada cuando está todo y la planta está activa', async () => {
      await alta('itagui');
      await svc.guardarTroncal(
        'itagui',
        {
          nombre: 'Infobip',
          proveedor: 'INFOBIP',
          servidor: 'sbc.infobip.com',
          autenticacion: 'ip',
          redes: '81.23.252.0/24',
        },
        'admin',
      );
      await svc.guardarNumero('itagui', { numero: '+18335308128' }, 'admin');
      usuarios.push({
        id: 'u1',
        username: 'ana',
        nombre: 'Ana',
        extension: '101',
        sipClave: 'x',
      });
      await svc.actualizar('itagui', { estado: 'activa' }, 'admin');
      expect((await svc.ver('itagui')).faltan).toEqual([]);
    });

    it('una instancia sin planta propia no se inventa: lo dice y punto', async () => {
      await expect(svc.ver('nadie')).rejects.toThrow(/no tiene planta propia/);
    });
  });
});
