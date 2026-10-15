import { Repository } from 'typeorm';
import { ConfigPbxEntity } from './config-pbx.entity';
import { PbxConfigService } from './pbx-config.service';
import { descifrar } from '../common/secretos';

/**
 * Guardar la planta telefónica de una instancia.
 *
 * La prueba que faltaba y que costó una sesión: **elegir Zadarma tenía que ser
 * posible antes de tener el secreto**. El servicio se negaba a guardar
 * `ZADARMA` sin secreto, pero el campo donde se escribe el secreto solo
 * aparece en pantalla DESPUÉS de que el proveedor sea Zadarma. Resultado: un
 * callejón sin salida, con el selector mostrando «Zadarma» (su estado local)
 * mientras los datos seguían en YACO y los campos de llaves no salían nunca.
 *
 * La regla correcta no es «no se puede elegir», es «no se puede ENCENDER».
 */
describe('PbxConfigService', () => {
  let filas: ConfigPbxEntity[];
  let svc: PbxConfigService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'llave-de-prueba';
    filas = [];
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
    svc = new PbxConfigService(repo);
  });

  it('se puede elegir Zadarma sin tener todavía el secreto', async () => {
    const v = await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');

    expect(v.proveedor).toBe('ZADARMA');
    // Elegida, pero apagada: sin secreto no se puede verificar nada.
    expect(v.activo).toBe(false);
    expect(v.tieneCredenciales).toBe(false);
  });

  it('y después, con el secreto, se puede encender', async () => {
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
    await svc.guardar({ tenant: 'itagui', zadarmaSecreto: '02c715f8970408240309' }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', activo: true }, 'superadmin');

    expect(v.activo).toBe(true);
    expect(v.tieneCredenciales).toBe(true);
  });

  it('encenderla a ciegas sí se rechaza, y el motivo dice qué falta', async () => {
    await expect(svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA', activo: true }, 'superadmin'))
      .rejects.toThrow(/secreto de la API/);
  });

  it('el secreto se guarda cifrado y no sale en la vista', async () => {
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
    const v = await svc.guardar({ tenant: 'itagui', zadarmaSecreto: 'secreto-real' }, 'superadmin');

    expect(JSON.stringify(v)).not.toContain('secreto-real');
    expect(v.tieneCredenciales).toBe(true);
    expect(filas[0].zadarmaSecreto).toContain('enc1:');
    expect(descifrar(filas[0].zadarmaSecreto!, 'llave-de-prueba')).toBe('secreto-real');
  });

  it('guardar otra cosa NO borra el secreto que ya estaba', async () => {
    // El formulario nunca recibe el secreto, así que no puede reenviarlo: sin
    // esto, cambiar el número de entrada lo borraría sin avisar.
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA', zadarmaSecreto: 'abc' }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', numeroEntrante: '+576012345678' }, 'superadmin');

    expect(v.tieneCredenciales).toBe(true);
    expect(v.numeroEntrante).toBe('+576012345678');
  });

  it('volver a YACO no exige nada ni toca lo guardado de Zadarma', async () => {
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA', zadarmaSecreto: 'abc' }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', proveedor: 'YACO', activo: true }, 'superadmin');

    expect(v.proveedor).toBe('YACO');
    expect(v.activo).toBe(true);
    // El secreto sigue ahí para cuando se vuelva a Zadarma.
    expect(v.tieneCredenciales).toBe(true);
  });

  it('sin instancia no guarda nada', async () => {
    await expect(svc.guardar({ proveedor: 'ZADARMA' }, 'superadmin')).rejects.toThrow(/instancia/i);
  });

  it('un proveedor inventado se rechaza', async () => {
    await expect(svc.guardar({ tenant: 'itagui', proveedor: 'TWILIO' as never }, 'superadmin'))
      .rejects.toThrow(/no reconocido/i);
  });
});

/**
 * Lo que pasa cuando por fin llega el secreto.
 *
 * Quedó apagada porque sin secreto no podía verificar nada. Cuando el secreto
 * llega, esa razón desaparece — y dejarla apagada esperando a que alguien
 * mueva «Estado» hace que la planta se quede muda sin que nada lo explique.
 * Pasó en la primera configuración real.
 */
describe('PbxConfigService · el secreto que llega después', () => {
  let filas: ConfigPbxEntity[];
  let svc: PbxConfigService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'llave-de-prueba';
    filas = [];
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
    svc = new PbxConfigService(repo);
  });

  it('guardar el secreto enciende la planta que estaba apagada por faltarle', async () => {
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');
    expect(filas[0].activo).toBe(false);

    const v = await svc.guardar({ tenant: 'itagui', zadarmaSecreto: 'abc' }, 'superadmin');

    expect(v.activo).toBe(true);
    expect(v.tieneCredenciales).toBe(true);
  });

  it('pero si se pide apagada explícitamente, se respeta', async () => {
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA' }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', zadarmaSecreto: 'abc', activo: false }, 'superadmin');

    expect(v.activo).toBe(false);
  });

  it('cambiar un secreto que YA estaba no reenciende una planta apagada a propósito', async () => {
    // Se apagó por una migración, un corte, lo que sea. Rotar la credencial no
    // puede devolverle llamadas a una instancia que alguien apagó queriendo.
    await svc.guardar({ tenant: 'itagui', proveedor: 'ZADARMA', zadarmaSecreto: 'viejo' }, 'superadmin');
    await svc.guardar({ tenant: 'itagui', activo: false }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', zadarmaSecreto: 'nuevo' }, 'superadmin');

    expect(v.activo).toBe(false);
  });

  it('y con YACO el secreto de Zadarma no enciende nada', async () => {
    await svc.guardar({ tenant: 'itagui', proveedor: 'YACO', activo: false }, 'superadmin');

    const v = await svc.guardar({ tenant: 'itagui', zadarmaSecreto: 'abc' }, 'superadmin');

    expect(v.activo).toBe(false);
  });
});
