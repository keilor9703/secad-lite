import * as bcrypt from 'bcryptjs';
import { UsuariosService } from './usuarios.service';
import { UsuarioEntity } from './usuario.entity';

/**
 * El alta por invitación. Lo que se protege:
 *
 *  - Una cuenta sin contraseña inicial NO se puede abrir con nada.
 *  - La contraseña JAMÁS sale por correo.
 *  - Que el proveedor de correo falle no impide crear la cuenta.
 *  - Usar el enlace es lo que VERIFICA la dirección.
 *  - «Olvidé mi contraseña» no revela si una cuenta existe.
 */
describe('alta por invitación', () => {
  let filas: UsuarioEntity[];
  let enviados: { para: string; asunto: string; html: string; texto: string }[];
  let fallarEnvio: boolean;
  let anulados: string[];
  let servicio: UsuariosService;

  const repo = () => ({
    create: (v: Partial<UsuarioEntity>) => ({ ...v }) as UsuarioEntity,
    save: async (u: UsuarioEntity) => {
      const existente = filas.find((f) => f.id === u.id);
      if (existente) Object.assign(existente, u);
      else { u.id = u.id ?? `u${filas.length + 1}`; filas.push(u); }
      return u;
    },
    // Coincidencia EXACTA, como la base: con username vacío no hay filas.
    find: async (o: { where: { username?: string } }) =>
      filas.filter((f) => f.activo && f.username === o.where.username),
    findOne: async (o: { where: { id?: string; username?: string } }) =>
      filas.find((f) => (o.where.id ? f.id === o.where.id : f.username === o.where.username)) ?? null,
    findOneOrFail: async (o: { where: { id: string } }) => filas.find((f) => f.id === o.where.id)!,
    update: async () => ({ affected: 0 }),
  });

  const credenciales = () => ({
    emitir: async (usuarioId: string) => ({ token: `tok-${usuarioId}`, venceEn: new Date(Date.now() + 3.6e6) }),
    validar: async (t: string) => (t.startsWith('tok-') ? { usuarioId: t.slice(4), tipo: 'invitacion' } : null),
    consumir: async (t: string) => (t.startsWith('tok-') ? { usuarioId: t.slice(4), tipo: 'invitacion' } : null),
    anularVivos: async (id: string) => { anulados.push(id); },
  });

  const correo = () => ({
    enviar: async (m: { para: string; asunto: string; html: string; texto: string }) => {
      enviados.push(m);
      return fallarEnvio ? { ok: false, error: 'HTTP 500 proveedor caído' } : { ok: true, id: 'm1' };
    },
  });

  const roles = { existe: async () => true, resolver: async () => true } as never;

  function crearServicio(): UsuariosService {
    const s = new UsuariosService(
      repo() as never, roles, {} as never, credenciales() as never, correo() as never,
    );
    // `resolverAmbito` y `resolverAdscripcion` consultan roles y catálogos
    // reales; aquí interesa el flujo de credenciales, así que se cortan.
    (s as unknown as Record<string, unknown>).resolverAmbito =
      async (_a: unknown, rol: string, tenant: string) => ({ rol: rol ?? 'operador', tenant: tenant ?? 'demo' });
    (s as unknown as Record<string, unknown>).resolverAdscripcion =
      async () => ({ agenciaId: null, canales: [] });
    (s as unknown as Record<string, unknown>).resolverExtension = async () => null;
    (s as unknown as Record<string, unknown>).resolverWhatsappHandle = async () => null;
    return s;
  }

  const actor = { sub: 'admin', rol: 'admin', tenant: 'demo' };

  beforeEach(() => {
    filas = []; enviados = []; anulados = []; fallarEnvio = false;
    servicio = crearServicio();
  });

  it('sin correo y sin contraseña no deja crear la cuenta', async () => {
    await expect(servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador' } as never))
      .rejects.toThrow(/correo|contraseña/i);
  });

  it('con correo crea la cuenta y manda la invitación', async () => {
    const u = await servicio.crear(
      actor, { username: 'ana', nombre: 'Ana Ruiz', rol: 'operador', correo: 'Ana@Muni.GOV.co' } as never,
    );
    expect(u.correo).toBe('ana@muni.gov.co');          // normalizado
    expect(u.correoVerificadoEn).toBeNull();            // nadie la verificó todavía
    expect(u.invitacionEnviadaEn).toBeInstanceOf(Date);
    expect(enviados.length).toBe(1);
    expect(enviados[0].para).toBe('ana@muni.gov.co');
  });

  it('la cuenta nace SIN contraseña utilizable', async () => {
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    const guardada = filas[0];
    expect(guardada.passwordHash).toBeTruthy();
    // Ni vacía, ni el username, ni nada adivinable abre esa cuenta.
    for (const intento of ['', ' ', 'ana', 'Ana', '12345678', 'password', 'a@b.co']) {
      expect(await bcrypt.compare(intento, guardada.passwordHash)).toBe(false);
    }
  });

  it('el correo NO lleva ninguna contraseña, solo el enlace', async () => {
    await servicio.crear(
      actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co', contrasena: 'Secreta2026' } as never,
    );
    const cuerpo = `${enviados[0].html} ${enviados[0].texto}`;
    expect(cuerpo).not.toContain('Secreta2026');
    expect(cuerpo).toContain('/activar/');
  });

  it('si el proveedor falla, la cuenta se crea igual y queda el motivo', async () => {
    fallarEnvio = true;
    const u = await servicio.crear(
      actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never,
    );
    expect(u.username).toBe('ana');
    expect(u.invitacionError).toContain('proveedor caído');
  });

  it('cuando el envío falla, el administrador recibe el enlace para entregarlo', async () => {
    fallarEnvio = true;
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    const r = await servicio.invitar(actor, filas[0].id, true);
    expect(r.ok).toBe(false);
    expect(r.enlace).toContain('/activar/');
  });

  it('cuando el envío funciona, el enlace NO vuelve al administrador', async () => {
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    const r = await servicio.invitar(actor, filas[0].id, true);
    expect(r.ok).toBe(true);
    expect(r.enlace).toBeUndefined();
  });

  it('usar el enlace fija la contraseña y VERIFICA el correo', async () => {
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    const id = filas[0].id;
    await servicio.establecerPorToken(`tok-${id}`, 'MiClaveLarga1');
    expect(await bcrypt.compare('MiClaveLarga1', filas[0].passwordHash)).toBe(true);
    expect(filas[0].correoVerificadoEn).toBeInstanceOf(Date);
    expect(filas[0].invitacionError).toBeNull();
    expect(anulados).toContain(id);
  });

  it('el enlace no acepta una contraseña corta', async () => {
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    await expect(servicio.establecerPorToken(`tok-${filas[0].id}`, 'corta'))
      .rejects.toThrow(/8 caracteres/i);
  });

  it('un enlace inválido no dice por qué', async () => {
    await expect(servicio.establecerPorToken('basura', 'MiClaveLarga1'))
      .rejects.toThrow(/no es válido, ya se usó o venció/i);
  });

  it('recuperar no revela nada: ni si el usuario existe, ni si tiene correo', async () => {
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    await expect(servicio.solicitarRecuperacion('ana')).resolves.toBeUndefined();
    await expect(servicio.solicitarRecuperacion('no-existe')).resolves.toBeUndefined();
    await expect(servicio.solicitarRecuperacion('')).resolves.toBeUndefined();
    // Y solo salió correo para la que sí existe y tiene dirección.
    expect(enviados.filter((e) => e.asunto.includes('Restablecer')).length).toBe(1);
  });

  it('un correo con forma inválida se rechaza al crear', async () => {
    await expect(
      servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'no-es-correo' } as never),
    ).rejects.toThrow(/forma válida/i);
  });

  it('cambiar el correo borra la verificación anterior', async () => {
    await servicio.crear(actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'a@b.co' } as never);
    const id = filas[0].id;
    await servicio.establecerPorToken(`tok-${id}`, 'MiClaveLarga1');
    expect(filas[0].correoVerificadoEn).toBeInstanceOf(Date);

    await servicio.actualizar(actor, id, { correo: 'otra@b.co' });
    expect(filas[0].correo).toBe('otra@b.co');
    expect(filas[0].correoVerificadoEn).toBeNull();
  });

  // ── Cuentas que ya existían, sin correo ────────────────────────────────
  //
  // Son las anteriores a que FALCON tuviera correos: contraseña puesta por un
  // administrador y ninguna forma de recuperarla solas. Lo que se protege aquí
  // es que registrar el correo y mandar la invitación sean UNA cosa: el estado
  // intermedio —correo puesto, invitación sin mandar— no se ve en ninguna
  // pantalla, porque la fila deja de decir «sin correo» y nadie vuelve a
  // mirarla, con la persona igual de bloqueada que antes.
  describe('registrar el correo de una cuenta vieja', () => {
    /** Una cuenta como las que quedaron de antes: con clave, sin correo. */
    async function cuentaVieja(): Promise<string> {
      const u = await servicio.crear(
        actor,
        { username: 'jperez', nombre: 'Juan Pérez', rol: 'operador', contrasena: 'ClaveInicial1' } as never,
      );
      enviados.length = 0;
      return u.id;
    }

    it('pone el correo y manda la invitación de una sola vez', async () => {
      const id = await cuentaVieja();

      const r = await servicio.registrarCorreo(actor, id, '  JPerez@Muni.GOV.co ');

      expect(r.ok).toBe(true);
      expect(r.correo).toBe('jperez@muni.gov.co');   // normalizado
      expect(r.yaTenia).toBe(false);
      expect(enviados.length).toBe(1);
      expect(enviados[0].para).toBe('jperez@muni.gov.co');
      expect(filas[0].correo).toBe('jperez@muni.gov.co');
      expect(filas[0].invitacionEnviadaEn).toBeInstanceOf(Date);
    });

    it('la contraseña vieja sigue sirviendo hasta que la persona use el enlace', async () => {
      // Importa: la cuenta está EN USO. Si registrar el correo cerrara la
      // sesión o invalidara la clave, el operador se queda fuera del turno por
      // algo que hizo un administrador en otra pantalla.
      const id = await cuentaVieja();
      await servicio.registrarCorreo(actor, id, 'jperez@muni.gov.co');
      expect(await bcrypt.compare('ClaveInicial1', filas[0].passwordHash)).toBe(true);
    });

    it('si el envío falla, lo dice y devuelve el enlace para entregarlo a mano', async () => {
      const id = await cuentaVieja();
      fallarEnvio = true;

      const r = await servicio.registrarCorreo(actor, id, 'jperez@muni.gov.co');

      expect(r.ok).toBe(false);
      expect(r.error).toContain('proveedor caído');
      expect(r.enlace).toContain('/activar/');
      // Y el correo SÍ queda registrado: el problema fue el envío, no el dato.
      expect(filas[0].correo).toBe('jperez@muni.gov.co');
    });

    it('con enviar:false devuelve el enlace sin mandar nada', async () => {
      const id = await cuentaVieja();

      const r = await servicio.registrarCorreo(actor, id, 'jperez@muni.gov.co', false);

      expect(r.ok).toBe(true);
      expect(r.enlace).toContain('/activar/');
      expect(enviados.length).toBe(0);
    });

    it('un correo mal escrito no toca la cuenta', async () => {
      const id = await cuentaVieja();

      await expect(servicio.registrarCorreo(actor, id, 'jperez@')).rejects.toThrow(/correo/i);

      expect(filas[0].correo).toBeFalsy();
      expect(enviados.length).toBe(0);
    });

    it('sobre una cuenta que YA tenía correo, lo dice y anula los enlaces viejos', async () => {
      const u = await servicio.crear(
        actor, { username: 'ana', nombre: 'Ana', rol: 'operador', correo: 'viejo@muni.gov.co' } as never,
      );
      enviados.length = 0; anulados.length = 0;

      const r = await servicio.registrarCorreo(actor, u.id, 'nuevo@muni.gov.co');

      expect(r.yaTenia).toBe(true);
      expect(r.correo).toBe('nuevo@muni.gov.co');
      // Un enlace vivo que viajó al buzón anterior deja de valer ahora mismo.
      expect(anulados).toContain(u.id);
      expect(enviados[0].para).toBe('nuevo@muni.gov.co');
    });

    it('no deja tocar una cuenta de otra instancia', async () => {
      const id = await cuentaVieja();
      const intruso = { sub: 'otro', rol: 'admin', tenant: 'otra-alcaldia' };

      await expect(servicio.registrarCorreo(intruso, id, 'a@b.co')).rejects.toThrow(/tenant/i);

      expect(filas[0].correo).toBeFalsy();
      expect(enviados.length).toBe(0);
    });
  });
});
