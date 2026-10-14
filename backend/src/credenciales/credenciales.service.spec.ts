import { CredencialesService, HORAS_INVITACION, HORAS_RECUPERACION } from './credenciales.service';
import { CredencialTokenEntity } from './credencial-token.entity';

/**
 * Lo que se protege aquí es un enlace que pone una contraseña sin pedir nada
 * más. Si falla cualquiera de estas garantías, un correo reenviado o una
 * captura de pantalla vieja abren una cuenta del 123.
 */
describe('enlaces de un solo uso', () => {
  let filas: CredencialTokenEntity[];
  let servicio: CredencialesService;

  /**
   * Repositorio en memoria con la semántica que el servicio necesita: el
   * UPDATE condicionado tiene que contar cuántas filas tocó, que es lo que
   * hace imposible consumir el mismo enlace dos veces a la vez.
   */
  function repoFalso() {
    return {
      create: (v: Partial<CredencialTokenEntity>) => ({ ...v }) as CredencialTokenEntity,
      save: async (v: CredencialTokenEntity) => {
        const f = { ...v } as CredencialTokenEntity;
        f.id = `t${filas.length + 1}`;
        f.creadoEn = f.creadoEn ?? new Date();
        filas.push(f);
        return f;
      },
      findOne: async (o: { where: { tokenHash: string } }) =>
        filas.find((f) => f.tokenHash === o.where.tokenHash) ?? null,
      count: async (o: { where: { usuarioId: string } }) =>
        filas.filter((f) => f.usuarioId === o.where.usuarioId && !f.usadoEn && !f.anuladoEn).length,
      delete: async () => ({ affected: 0 }),
      createQueryBuilder: () => {
        const q: Record<string, unknown> = {};
        const api = {
          update: () => api,
          set: (v: Record<string, unknown>) => { q.set = v; return api; },
          // Se guarda el WHERE TAL CUAL lo escribe el servicio. Si el doble
          // aplicara por su cuenta la condición de «todavía viva», estaría
          // garantizando él lo que debe garantizar el código, y la prueba
          // pasaría aunque la condición desapareciera del SQL.
          where: (clausula: string, p: Record<string, string>) => {
            q.where = clausula; q.params = p; return api;
          },
          execute: async () => {
            const p = q.params as { id?: string; usuarioId?: string };
            const clausula = String(q.where ?? '');
            const exigeViva = clausula.includes('"usadoEn" IS NULL')
              && clausula.includes('"anuladoEn" IS NULL');
            const vivas = filas.filter(
              (f) => (p.id ? f.id === p.id : f.usuarioId === p.usuarioId)
                && (!exigeViva || (!f.usadoEn && !f.anuladoEn)),
            );
            const campo = 'usadoEn' in (q.set as object) ? 'usadoEn' : 'anuladoEn';
            for (const f of vivas) (f as unknown as Record<string, Date>)[campo] = new Date();
            return { affected: vivas.length };
          },
        };
        return api;
      },
    };
  }

  beforeEach(() => {
    filas = [];
    servicio = new CredencialesService(repoFalso() as never);
  });

  it('guarda el hash, nunca el token', async () => {
    const { token } = await servicio.emitir('u1', 'invitacion', 'admin');
    expect(token.length).toBeGreaterThan(20);
    expect(filas[0].tokenHash).not.toContain(token);
    expect(filas[0].tokenHash).toBe(CredencialesService.hash(token));
    // Y nada de la fila, serializada entera, deja ver el token.
    expect(JSON.stringify(filas)).not.toContain(token);
  });

  it('cada token es distinto', async () => {
    const a = await servicio.emitir('u1', 'invitacion');
    const b = await servicio.emitir('u2', 'invitacion');
    expect(a.token).not.toBe(b.token);
  });

  it('un token válido resuelve a su cuenta', async () => {
    const { token } = await servicio.emitir('u1', 'invitacion');
    expect((await servicio.validar(token))?.usuarioId).toBe('u1');
  });

  it('solo sirve UNA vez', async () => {
    const { token } = await servicio.emitir('u1', 'invitacion');
    expect(await servicio.consumir(token)).not.toBeNull();
    expect(await servicio.consumir(token)).toBeNull();
    expect(await servicio.validar(token)).toBeNull();
  });

  it('dos usos simultáneos: solo uno gana', async () => {
    // El doble clic de siempre. Sin el UPDATE condicionado, los dos pasarían.
    const { token } = await servicio.emitir('u1', 'invitacion');
    const [a, b] = await Promise.all([servicio.consumir(token), servicio.consumir(token)]);
    expect([a, b].filter(Boolean).length).toBe(1);
  });

  it('vencido no vale, aunque nadie lo haya usado', async () => {
    const { token } = await servicio.emitir('u1', 'recuperacion');
    filas[0].venceEn = new Date(Date.now() - 1000);
    expect(await servicio.validar(token)).toBeNull();
    expect(await servicio.consumir(token)).toBeNull();
  });

  it('emitir uno nuevo mata el anterior', async () => {
    // Un administrador reenvía porque sospecha que el primero se filtró: el
    // primero tiene que morir en ese instante, o no sirvió de nada.
    const primero = await servicio.emitir('u1', 'invitacion');
    const segundo = await servicio.emitir('u1', 'invitacion');
    expect(await servicio.validar(primero.token)).toBeNull();
    expect(await servicio.validar(segundo.token)).not.toBeNull();
  });

  it('anular no toca los enlaces de otra cuenta', async () => {
    const ajeno = await servicio.emitir('u2', 'invitacion');
    await servicio.emitir('u1', 'invitacion');
    await servicio.anularVivos('u1');
    expect(await servicio.validar(ajeno.token)).not.toBeNull();
  });

  it('un token inventado no resuelve a nada', async () => {
    await servicio.emitir('u1', 'invitacion');
    for (const basura of ['', '   ', 'no-existe', 'a'.repeat(43)]) {
      expect(await servicio.validar(basura)).toBeNull();
    }
  });

  it('la invitación dura más que la recuperación', async () => {
    const inv = await servicio.emitir('u1', 'invitacion');
    const rec = await servicio.emitir('u2', 'recuperacion');
    expect(inv.venceEn.getTime()).toBeGreaterThan(rec.venceEn.getTime());
    const horas = (d: Date) => Math.round((d.getTime() - Date.now()) / 3_600_000);
    expect(horas(inv.venceEn)).toBe(HORAS_INVITACION);
    expect(horas(rec.venceEn)).toBe(HORAS_RECUPERACION);
  });

  it('cuenta los enlaces vivos de una cuenta', async () => {
    const { token } = await servicio.emitir('u1', 'invitacion');
    expect(await servicio.contarVivos('u1')).toBe(1);
    await servicio.consumir(token);
    expect(await servicio.contarVivos('u1')).toBe(0);
  });
});
