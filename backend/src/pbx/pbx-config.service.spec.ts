import { Repository } from 'typeorm';
import { ConfigPbxEntity } from './config-pbx.entity';
import { PbxConfigService } from './pbx-config.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { descifrar } from '../common/secretos';

/**
 * Guardar la planta telefónica de una instancia.
 *
 * La prueba que faltaba y que costó una sesión: **elegir el proveedor tenía
 * que ser posible antes de tener sus credenciales**. El servicio se negaba a
 * guardar `ZADARMA` sin secreto, pero el campo donde se escribe el secreto
 * solo aparece en pantalla DESPUÉS de que el proveedor sea Zadarma.
 * Resultado: un callejón sin salida, con el selector mostrando «Zadarma» (su
 * estado local) mientras los datos seguían en YACO y los campos de llaves no
 * salían nunca.
 *
 * La regla correcta no es «no se puede elegir», es «no se puede ENCENDER». Y
 * ahora no está escrita para Zadarma: sale de los campos `requerido` del
 * descriptor del proveedor, así que vale para el que venga.
 */
function armar() {
  process.env.JWT_SECRET = 'llave-de-prueba';
  const filas: ConfigPbxEntity[] = [];
  const repo = {
    find: async () => filas,
    findOne: async (o: { where: { tenant: string } }) =>
      filas.find((f) => f.tenant === o.where.tenant) ?? null,
    create: (v: Partial<ConfigPbxEntity>) => ({ ...v }) as ConfigPbxEntity,
    save: async (f: ConfigPbxEntity) => {
      const i = filas.findIndex((x) => x.tenant === f.tenant);
      if (i >= 0) filas[i] = f; else filas.push(f);
      return f;
    },
  } as unknown as Repository<ConfigPbxEntity>;
  const svc = new PbxConfigService(repo, new PbxCredencialesService(repo));
  return { filas, svc };
}

/** Lo guardado en crudo, para comprobar el cifrado en reposo. */
const crudas = (f: ConfigPbxEntity) => JSON.parse(f.credenciales ?? '{}') as Record<string, string>;

describe('PbxConfigService', () => {
  it('se puede elegir Zadarma sin tener todavía el secreto', async () => {
    const { svc } = armar();
    const v = await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');

    expect(v.proveedor).toBe('ZADARMA');
    // Elegida, pero apagada: sin secreto no se puede verificar nada.
    expect(v.activo).toBe(false);
    expect(v.credencialesPuestas).toEqual([]);
    // Y la pantalla puede decir exactamente qué falta, con su etiqueta.
    expect(v.faltan).toEqual(['Key de la API', 'Secret de la API']);
  });

  it('y después, con las credenciales, se puede encender', async () => {
    const { svc } = armar();
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
    await svc.guardar({
      tenant: 'itagui',
      credenciales: { key: '71278d8e6746cb220a36', secreto: '02c715f8970408240309' },
    }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', activo: true }, 'superadmin');

    expect(v.activo).toBe(true);
    expect(v.faltan).toEqual([]);
  });

  it('encenderla a ciegas sí se rechaza, y el motivo dice qué falta', async () => {
    const { svc } = armar();
    await expect(svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA', activo: true }, 'superadmin'))
      .rejects.toThrow(/Secret de la API/);
  });

  describe('lo secreto', () => {
    it('se guarda cifrado y no sale en la vista, ni truncado', async () => {
      const { svc, filas } = armar();
      await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
      const v = await svc.guardar({
        tenant: 'itagui', credenciales: { key: 'abc', secreto: 'secreto-real' },
      }, 'superadmin');

      expect(JSON.stringify(v)).not.toContain('secreto-real');
      expect(v.credencialesPuestas).toContain('secreto');
      expect(crudas(filas[0]).secreto).toContain('enc1:');
      expect(descifrar(crudas(filas[0]).secreto, 'llave-de-prueba')).toBe('secreto-real');
    });

    it('lo NO secreto sí vuelve: es lo que el superadmin necesita ver para comparar', async () => {
      const { svc } = armar();
      const v = await svc.guardar({
        tenant: 'itagui', proveedor: 'ZADARMA',
        credenciales: { key: '71278d8e6746cb220a36', secreto: 'x' },
      }, 'superadmin');

      expect(v.credenciales.key).toBe('71278d8e6746cb220a36');
      expect(v.credenciales.secreto).toBeUndefined();
    });

    it('qué se cifra lo decide el descriptor, no una lista escrita en el servicio', async () => {
      // Es el punto de todo el puerto: un proveedor nuevo declara sus campos y
      // el cifrado sale de ahí. Si `key` se cifrara por error, no se podría
      // volver a mostrar en pantalla; si `secreto` NO se cifrara, estaría en
      // claro en la base.
      const { svc, filas } = armar();
      await svc.guardar({
        tenant: 'itagui', proveedor: 'ZADARMA', credenciales: { key: 'K', secreto: 'S' },
      }, 'superadmin');

      expect(crudas(filas[0]).key).toBe('K');
      expect(crudas(filas[0]).secreto).not.toBe('S');
    });
  });

  it('guardar otra cosa NO borra lo que ya estaba', async () => {
    // El formulario nunca recibe el secreto, así que no puede reenviarlo: sin
    // esto, cambiar el número de entrada lo borraría sin avisar.
    const { svc } = armar();
    await svc.guardar({
      tenant: 'itagui', proveedor: 'ZADARMA', credenciales: { key: 'k', secreto: 'abc' },
    }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', numeroEntrante: '+576012345678' }, 'superadmin');

    expect(v.credencialesPuestas).toEqual(expect.arrayContaining(['key', 'secreto']));
    expect(v.numeroEntrante).toBe('+576012345678');
  });

  it('un campo mandado vacío sí se borra: es un borrado explícito', async () => {
    const { svc } = armar();
    await svc.guardar({
      tenant: 'itagui', proveedor: 'ZADARMA', credenciales: { key: 'k', secreto: 'abc' },
    }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', credenciales: { key: '' } }, 'superadmin');

    expect(v.credencialesPuestas).not.toContain('key');
    expect(v.credencialesPuestas).toContain('secreto');
    // Y al faltar un requerido, se apaga sola: no puede quedar encendida a medias.
    expect(v.activo).toBe(false);
  });

  it('volver a YACO no exige nada ni toca lo guardado de Zadarma', async () => {
    const { svc } = armar();
    await svc.guardar({
      tenant: 'itagui', proveedor: 'ZADARMA', credenciales: { key: 'k', secreto: 'abc' },
    }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', proveedor: 'YACO', activo: true }, 'superadmin');

    expect(v.proveedor).toBe('YACO');
    expect(v.activo).toBe(true);
    // YACO no pide credenciales nuestras: no hay nada que falte.
    expect(v.faltan).toEqual([]);
    // Y las de Zadarma siguen guardadas para cuando se vuelva.
    const vuelta = await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
    expect(vuelta.credencialesPuestas).toEqual(expect.arrayContaining(['key', 'secreto']));
  });

  it('la vista dice lo que el proveedor sabe hacer', async () => {
    // Es lo que le permite a la pantalla no ofrecer lo imposible.
    const { svc } = armar();
    const v = await svc.guardar({ tenant: 'itagui', proveedor: 'YACO' }, 'superadmin');
    expect(v.capacidades).toContain('entrantes');
  });

  it('sin instancia no guarda nada', async () => {
    const { svc } = armar();
    await expect(svc.guardar({ proveedor: 'ZADARMA' }, 'superadmin')).rejects.toThrow(/instancia/i);
  });

  it('un proveedor que no está en el registro se rechaza', async () => {
    const { svc } = armar();
    await expect(svc.guardar({ tenant: 'itagui', proveedor: 'TWILIO' }, 'superadmin'))
      .rejects.toThrow(/no reconocido/i);
  });
});

/**
 * Lo que pasa cuando por fin llegan las credenciales.
 *
 * Quedó apagada porque sin ellas no podía verificar nada. Cuando llegan, esa
 * razón desaparece — y dejarla apagada esperando a que alguien mueva «Estado»
 * hace que la planta se quede muda sin que nada lo explique. Pasó en la
 * primera configuración real.
 */
describe('PbxConfigService · las credenciales que llegan después', () => {
  it('guardarlas enciende la planta que estaba apagada por faltarle', async () => {
    const { svc, filas } = armar();
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
    expect(filas[0].activo).toBe(false);

    const v = await svc.guardar({ tenant: 'itagui', credenciales: { key: 'k', secreto: 'abc' } }, 'superadmin');

    expect(v.activo).toBe(true);
  });

  it('a medias no enciende: con la key y sin el secreto sigue apagada', async () => {
    const { svc } = armar();
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', credenciales: { key: 'k' } }, 'superadmin');

    expect(v.activo).toBe(false);
    expect(v.faltan).toEqual(['Secret de la API']);
  });

  it('pero si se pide apagada explícitamente, se respeta', async () => {
    const { svc } = armar();
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');

    const v = await svc.guardar({
      tenant: 'itagui', credenciales: { key: 'k', secreto: 'abc' }, activo: false,
    }, 'superadmin');

    expect(v.activo).toBe(false);
  });

  it('rotar una credencial que YA estaba no reenciende una planta apagada a propósito', async () => {
    // Se apagó por una migración, un corte, lo que sea. Rotar la credencial no
    // puede devolverle llamadas a una instancia que alguien apagó queriendo.
    const { svc } = armar();
    await svc.guardar({
      tenant: 'itagui', proveedor: 'ZADARMA', credenciales: { key: 'k', secreto: 'viejo' },
    }, 'superadmin');
    await svc.guardar({ tenant: 'itagui', activo: false }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', credenciales: { secreto: 'nuevo' } }, 'superadmin');

    expect(v.activo).toBe(false);
  });

  it('y con YACO, un secreto de Zadarma no enciende nada ni se guarda', async () => {
    const { svc, filas } = armar();
    await svc.guardar({ tenant: 'itagui', proveedor: 'YACO', activo: false }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', credenciales: { secreto: 'abc' } }, 'superadmin');

    expect(v.activo).toBe(false);
    // YACO no declara ese campo: no se guarda basura de otro proveedor.
    expect(crudas(filas[0]).secreto).toBeUndefined();
  });
});
