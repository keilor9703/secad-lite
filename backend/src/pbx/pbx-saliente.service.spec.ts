import { BadRequestException } from '@nestjs/common';
import { PbxSalienteService } from './pbx-saliente.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { CasosService } from '../casos/casos.service';
import { ConfigPbxEntity } from './config-pbx.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { proveedor } from './proveedores/registro';

/**
 * Llamar desde el caso.
 *
 * Lo que se protege, en orden de importancia:
 *
 *  1. **La extensión sale del usuario, nunca del navegador.** Es una llamada
 *     facturable que queda a nombre de alguien en el registro de la central:
 *     si el cliente pudiera elegirla, cualquiera con `pbx.usar` haría timbrar
 *     el teléfono de otro operador y la llamada quedaría atribuida a él.
 *  2. Que un número que no se puede marcar se rechace ANTES de gastar una
 *     llamada — la central manda identificadores de WhatsApp que parecen
 *     números y no lo son.
 *  3. Que no se ofrezca lo que el proveedor no sabe hacer.
 *  4. Que la nota en el caso no pueda tumbar una llamada ya pedida.
 */
describe('PbxSalienteService', () => {
  let marcadas: Array<{ cred: Record<string, string>; orden: { extension: string; numero: string } }>;
  let notas: Array<{ casoId: string; texto: string }>;
  let resultado: { ok: boolean; error?: string; id?: string };
  let fila: Partial<ConfigPbxEntity> | null;
  let usuario: Partial<UsuarioEntity> | null;
  let svc: PbxSalienteService;

  /** El registro de proveedores de verdad, con el `marcar` de Zadarma sustituido. */
  function armar() {
    marcadas = [];
    notas = [];
    resultado = { ok: true, id: 'llamada-42' };
    fila = { tenant: 'itagui', proveedor: 'ZADARMA', activo: true };
    usuario = { username: 'pedro', extension: '102' };

    const cred = {
      configDe: async () => fila as ConfigPbxEntity | null,
      claveProveedor: () => fila?.proveedor ?? 'YACO',
      enClaro: () => ({ key: 'k', secreto: 's' }),
    } as unknown as PbxCredencialesService;
    const usuarios = {
      buscarPorUsernameYTenant: async () => usuario as UsuarioEntity | null,
    } as unknown as UsuariosService;
    const casos = {
      agregarNota: async (_t: string, casoId: string, texto: string) => { notas.push({ casoId, texto }); },
    } as unknown as CasosService;

    svc = new PbxSalienteService(cred, usuarios, casos);

    // Se sustituye SOLO el acto de pedir la llamada —el resto del camino
    // (capacidades, credenciales, encendido) es el de verdad, que es
    // justamente lo que hay que probar— y con un espía restaurable, no
    // asignando encima del registro: Jest le da a cada archivo de pruebas su
    // propio registro de módulos, pero una asignación cruda sí se ve entre
    // las pruebas de ESTE archivo, y eso ya ha escondido fallos antes.
    const zadarma = proveedor('ZADARMA')!;
    jest.spyOn(zadarma, 'marcar').mockImplementation(async (c, o) => {
      marcadas.push({ cred: c as Record<string, string>, orden: o });
      return resultado;
    });
  }

  beforeEach(armar);
  afterEach(() => jest.restoreAllMocks());

  it('pide la llamada a la extensión del usuario, no a la que diga el cliente', async () => {
    const r = await svc.marcar('itagui', 'pedro', { numero: '3001234567' });

    expect(r.ok).toBe(true);
    expect(marcadas[0].orden).toEqual({ extension: '102', numero: '3001234567' });
    // Y se le dice al operador qué va a pasar: su teléfono timbra primero.
    expect(r.mensaje).toContain('102');
    expect(r.mensaje).toContain('3001234567');
  });

  it('aunque el cliente mande una extensión, se usa la del usuario', async () => {
    // ESTA es la prueba que faltaba, y la descubrió un sabotaje: quitar la
    // regla no rompía ninguna prueba, porque ninguna mandaba una extensión en
    // el cuerpo. Es la propiedad más importante de toda la función: si el
    // navegador pudiera elegirla, cualquiera con `pbx.usar` haría timbrar el
    // teléfono de otro operador y la llamada —facturable— quedaría atribuida
    // a él en el registro de la central.
    await svc.marcar('itagui', 'pedro', {
      numero: '3001234567', extension: '999',
    } as { numero: string; extension: string });

    expect(marcadas[0].orden.extension).toBe('102');
  });

  it('normaliza el número igual que al entrar, para no marcar adornos', async () => {
    const r = await svc.marcar('itagui', 'pedro', { numero: '+57 300 123 4567' });

    expect(marcadas[0].orden.numero).toBe('+573001234567');
    // Y devuelve el normalizado: es lo que se anota en la bitácora, para que
    // el registro coincida con el de la central.
    expect(r.numero).toBe('+573001234567');
  });

  it('un identificador que no se puede marcar se rechaza antes de gastar una llamada', async () => {
    // La central manda esto para los contactos de WhatsApp: parece un número
    // y no lo es.
    await expect(svc.marcar('itagui', 'pedro', { numero: '+CO.1744934636794102' }))
      .rejects.toThrow(BadRequestException);
    expect(marcadas).toEqual([]);
  });

  it('sin número no hace nada', async () => {
    await expect(svc.marcar('itagui', 'pedro', {})).rejects.toThrow(/número/i);
  });

  it('un usuario sin extensión no puede llamar, y se le dice qué pedir', async () => {
    usuario = { username: 'pedro', extension: null };

    await expect(svc.marcar('itagui', 'pedro', { numero: '3001234567' }))
      .rejects.toThrow(/extensión/i);
    expect(marcadas).toEqual([]);
  });

  it('con la planta apagada no se marca', async () => {
    fila = { tenant: 'itagui', proveedor: 'ZADARMA', activo: false };

    await expect(svc.marcar('itagui', 'pedro', { numero: '3001234567' }))
      .rejects.toThrow(/apagada/i);
    expect(marcadas).toEqual([]);
  });

  describe('un proveedor que no sabe marcar', () => {
    it('se rechaza: el servidor no confía en la pantalla', async () => {
      // El botón no debería haberse dibujado, pero el servidor lo comprueba
      // igual: la pantalla puede estar vieja, o la petición venir de otro sitio.
      fila = { tenant: 'itagui', proveedor: 'YACO', activo: true };

      await expect(svc.marcar('itagui', 'pedro', { numero: '3001234567' }))
        .rejects.toThrow(/no permite originar llamadas/i);
    });

    it('y lo que decide es la CAPACIDAD declarada, no que exista el método', async () => {
      // Otro hueco que encontró un sabotaje: la prueba de arriba pasaba igual
      // sin comprobar las capacidades, porque YACO tampoco tiene el método.
      // Un proveedor a medio implementar —con el método escrito pero sin
      // declararlo, que es justo el estado en que se deja algo en pruebas— se
      // habría colado y habría facturado llamadas de verdad.
      fila = { tenant: 'itagui', proveedor: 'YACO', activo: true };
      const yaco = proveedor('YACO') as { marcar?: unknown };
      yaco.marcar = async () => ({ ok: true });
      try {
        await expect(svc.marcar('itagui', 'pedro', { numero: '3001234567' }))
          .rejects.toThrow(/no permite originar llamadas/i);
      } finally {
        delete yaco.marcar;
      }
    });
  });

  it('si la central no pudo, se devuelve el motivo sin inventar que salió', async () => {
    resultado = { ok: false, error: 'Not enough money on the balance' };

    const r = await svc.marcar('itagui', 'pedro', { numero: '3001234567' });

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain('Not enough money');
  });

  describe('la nota en el caso', () => {
    it('queda cuando se pide desde un caso', async () => {
      await svc.marcar('itagui', 'pedro', { numero: '3001234567', casoId: 'caso-1' });

      expect(notas[0].casoId).toBe('caso-1');
      expect(notas[0].texto).toContain('3001234567');
    });

    it('no se escribe si la llamada no salió', async () => {
      resultado = { ok: false, error: 'sin saldo' };
      await svc.marcar('itagui', 'pedro', { numero: '3001234567', casoId: 'caso-1' });
      expect(notas).toEqual([]);
    });

    it('y si no se puede escribir, la llamada YA está pedida: no se tumba', async () => {
      // Perder la llamada por no poder escribir la nota sería lo peor de los
      // dos mundos.
      const casos = { agregarNota: async () => { throw new Error('caso inexistente'); } } as unknown as CasosService;
      const cred = {
        configDe: async () => fila as ConfigPbxEntity,
        claveProveedor: () => 'ZADARMA',
        enClaro: () => ({ key: 'k', secreto: 's' }),
      } as unknown as PbxCredencialesService;
      const usuarios = { buscarPorUsernameYTenant: async () => usuario as UsuarioEntity } as unknown as UsuariosService;

      const otro = new PbxSalienteService(cred, usuarios, casos);
      const r = await otro.marcar('itagui', 'pedro', { numero: '3001234567', casoId: 'no-existe' });

      expect(r.ok).toBe(true);
    });

    it('sin caso, no hay nota que escribir', async () => {
      await svc.marcar('itagui', 'pedro', { numero: '3001234567' });
      expect(notas).toEqual([]);
    });
  });
});
