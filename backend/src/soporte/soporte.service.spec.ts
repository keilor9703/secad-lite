import { Repository } from 'typeorm';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { CorreoService, MensajeCorreo, ResultadoEnvio } from '../correo/correo.service';
import { TenantEntity } from '../tenants/tenant.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import type { JwtPayload } from '../auth/auth.service';
import { SoporteService, nuevoId } from './soporte.service';
import { TicketDto } from './dto/ticket.dto';

/**
 * Lo que se protege de este servicio no es el texto de los correos —eso se
 * mira renderizado— sino cuatro propiedades que, si se rompen, dejan al
 * usuario creyendo que reportó algo que nadie recibió:
 *
 *  1. El reporte va al buzón de la mesa, siempre.
 *  2. La copia va al correo de la CUENTA, nunca a uno que venga en la petición.
 *  3. Si el correo a la mesa no sale, NO se acusa recibo y se dice que falló.
 *  4. Pase lo que pase, queda rastro en la bitácora con el relato completo,
 *     que hoy es el único registro durable que existe del reporte.
 */
describe('SoporteService', () => {
  const ACTOR: JwtPayload = {
    sub: 'u-1', tipo: 'institucional', nombre: 'Juan Pérez', rol: 'despachador',
    permisos: [], tenant: '63001', agencia: 'policia',
  };

  const DTO: TicketDto = {
    severidad: 'S2',
    relato: 'La videollamada no conecta con el ciudadano del caso 4120.',
    contexto: '── FALCON CAD · contexto técnico ──\nVersión 2ee819c\nPantalla /despacho',
    pantalla: '/despacho',
  };

  /** Armado del servicio con todo falso y observable. */
  function armar(opciones: {
    usuario?: Partial<UsuarioEntity> | null;
    tenant?: Partial<TenantEntity> | null;
    envios?: ResultadoEnvio[];
    mesa?: string;
  } = {}) {
    const usuario = opciones.usuario === undefined
      ? { id: 'u-1', username: 'jperez', nombre: 'Juan Pérez', correo: 'jperez@soacha.gov.co' }
      : opciones.usuario;
    const tenant = opciones.tenant === undefined
      ? { codigo: '63001', nombre: 'Alcaldía de Soacha' }
      : opciones.tenant;

    const mandados: MensajeCorreo[] = [];
    const resultados = opciones.envios ?? [{ ok: true, id: 'm1' }, { ok: true, id: 'm2' }];
    let i = 0;
    const correo = {
      enviar: jest.fn(async (m: MensajeCorreo) => {
        mandados.push(m);
        return resultados[Math.min(i++, resultados.length - 1)];
      }),
    } as unknown as CorreoService;

    // Tipada con los cuatro argumentos para poder leerlos del espía.
    const registrar = jest.fn(
      async (_tenant: string, _autor: string, _accion: string, _detalle: string) => undefined,
    );
    const auditoria = { registrar } as unknown as AuditoriaAdminService;

    const usuarios = { findOne: jest.fn(async () => usuario) } as unknown as Repository<UsuarioEntity>;
    const tenants = { findOne: jest.fn(async () => tenant) } as unknown as Repository<TenantEntity>;

    // El buzón se lee en el constructor: hay que fijarlo antes de armar.
    const previo = process.env.SOPORTE_CORREO;
    if (opciones.mesa) process.env.SOPORTE_CORREO = opciones.mesa;
    else delete process.env.SOPORTE_CORREO;
    const svc = new SoporteService(usuarios, tenants, correo, auditoria);
    if (previo === undefined) delete process.env.SOPORTE_CORREO;
    else process.env.SOPORTE_CORREO = previo;

    return { svc, mandados, registrar, correo };
  }

  it('manda el ticket a soporte@falconcad.com.co y la copia al correo de la cuenta', async () => {
    const { svc, mandados } = armar();

    const r = await svc.abrir(ACTOR, DTO);

    expect(r.enviado).toBe(true);
    expect(r.acuse).toBe('enviado');
    expect(mandados).toHaveLength(2);
    expect(mandados[0].para).toBe('soporte@falconcad.com.co');
    expect(mandados[1].para).toBe('jperez@soacha.gov.co');
  });

  it('el buzón de la mesa se puede cambiar sin tocar el código', async () => {
    // El día que haya herramienta de tickets, su dirección entra por aquí.
    const { svc, mandados } = armar({ mesa: 'tickets@mesa.example' });

    const r = await svc.abrir(ACTOR, DTO);

    expect(mandados[0].para).toBe('tickets@mesa.example');
    expect(r.mesa).toBe('tickets@mesa.example');
  });

  it('el aviso a la mesa se puede responder: contesta a quien reportó', async () => {
    const { svc, mandados } = armar();

    await svc.abrir(ACTOR, DTO);

    expect(mandados[0].responderA).toBe('jperez@soacha.gov.co');
    // Y al contrario: lo que quien reportó responda, llega a la mesa.
    expect(mandados[1].responderA).toBe('soporte@falconcad.com.co');
  });

  it('el ticket lleva el relato, el contexto, la instancia con nombre y quién reporta', async () => {
    const { svc, mandados } = armar();

    const r = await svc.abrir(ACTOR, DTO);

    const mesa = mandados[0];
    for (const texto of [mesa.html, mesa.texto]) {
      expect(texto).toContain('La videollamada no conecta');
      expect(texto).toContain('Alcaldía de Soacha (63001)');
      expect(texto).toContain('jperez');
      expect(texto).toContain(r.id);
    }
    // El contexto técnico solo va en el aviso a la mesa: quien reportó ya lo
    // vio en pantalla, y en el acuse sería un muro de cuarenta líneas.
    expect(mesa.texto).toContain('Versión 2ee819c');
    expect(mandados[1].texto).not.toContain('Versión 2ee819c');
  });

  it('ningún correo habla de ESTADO: no hay nada que lo mantenga todavía', async () => {
    const { svc, mandados } = armar();

    await svc.abrir(ACTOR, DTO);

    for (const m of mandados) {
      const visible = m.html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
      for (const texto of [visible, m.texto, m.asunto]) {
        expect(texto.toLowerCase()).not.toContain('estado');
        expect(texto.toLowerCase()).not.toContain('abierto');
        expect(texto.toLowerCase()).not.toContain('seguimiento');
      }
    }
  });

  it('sin correo en la cuenta, el ticket sale igual y lo dice', async () => {
    const { svc, mandados } = armar({
      usuario: { id: 'u-1', username: 'jperez', nombre: 'Juan Pérez', correo: null },
    });

    const r = await svc.abrir(ACTOR, DTO);

    expect(r.enviado).toBe(true);
    expect(r.acuse).toBe('sin-correo');
    expect(mandados).toHaveLength(1);
    // La mesa tiene que saber que no puede responder por correo.
    expect(mandados[0].responderA).toBeUndefined();
    expect(mandados[0].texto).toContain('no tiene correo');
  });

  it('si el correo a la mesa no sale, NO se acusa recibo y se devuelve el fallo', async () => {
    // Lo contrario sería lo peor posible: la persona se va tranquila con un
    // número que no existe en ningún buzón.
    const { svc, mandados } = armar({ envios: [{ ok: false, error: 'HTTP 402 sin crédito' }] });

    const r = await svc.abrir(ACTOR, DTO);

    expect(r.enviado).toBe(false);
    expect(r.error).toContain('402');
    expect(mandados).toHaveLength(1);
  });

  it('si solo falla el acuse, el ticket sigue siendo válido', async () => {
    const { svc } = armar({ envios: [{ ok: true, id: 'm1' }, { ok: false, error: 'rebotó' }] });

    const r = await svc.abrir(ACTOR, DTO);

    expect(r.enviado).toBe(true);
    expect(r.acuse).toBe('fallo');
  });

  it('deja rastro en la bitácora con el relato completo, salga o no el correo', async () => {
    for (const envios of [[{ ok: true }], [{ ok: false, error: 'sin crédito' }]]) {
      const { svc, registrar } = armar({ envios });

      const r = await svc.abrir(ACTOR, DTO);

      expect(registrar).toHaveBeenCalledTimes(1);
      const [tenant, autor, accion, detalle] = registrar.mock.calls[0];
      expect(tenant).toBe('63001');
      expect(autor).toBe('jperez');
      expect(accion).toBe('soporte.ticket');
      expect(detalle).toContain(r.id);
      expect(detalle).toContain(DTO.relato);
      expect(detalle).toContain(envios[0].ok ? 'enviado a' : 'NO SE PUDO ENVIAR');
    }
  });

  it('un error de la base al buscar la cuenta no impide reportar', async () => {
    // Quien reporta suele estar reportando justamente que algo no responde.
    const { svc, mandados } = armar();
    (svc as unknown as { usuarios: Repository<UsuarioEntity> }).usuarios = {
      findOne: jest.fn(async () => { throw new Error('ECONNREFUSED'); }),
    } as unknown as Repository<UsuarioEntity>;

    const r = await svc.abrir(ACTOR, DTO);

    expect(r.enviado).toBe(true);
    // Sin la fila no hay correo de la cuenta: no se inventa uno.
    expect(r.acuse).toBe('sin-correo');
    expect(mandados[0].texto).toContain('Juan Pérez');
  });

  it('el superadmin sin instancia elegida también puede reportar', async () => {
    const { svc, mandados, registrar } = armar({ tenant: null });

    const r = await svc.abrir({ ...ACTOR, tenant: null }, DTO);

    expect(r.enviado).toBe(true);
    expect(mandados[0].texto).toContain('plataforma');
    expect(registrar.mock.calls[0][0]).toBe('plataforma');
  });

  it('una severidad desconocida se atiende como S3 en vez de reventar', async () => {
    // El ValidationPipe la rechaza en el borde HTTP; esto cubre al servicio
    // llamado desde cualquier otro sitio.
    const { svc, mandados } = armar();

    await svc.abrir(ACTOR, { ...DTO, severidad: 'S9' });

    expect(mandados[0].asunto).toContain('S3');
  });
});

describe('el número del reporte', () => {
  it('tiene la forma FC-AAMMDD-XXXX', () => {
    expect(nuevoId()).toMatch(/^FC-\d{6}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('no usa caracteres que se confundan al dictarlo por teléfono', () => {
    // 300 tiradas: con 32 símbolos, si alguno prohibido estuviera en el
    // alfabeto, saldría con probabilidad práctica de 1.
    const cola = Array.from({ length: 300 }, () => nuevoId().slice(-4)).join('');
    expect(cola).not.toMatch(/[IO01]/);
  });

  it('usa la fecha de Colombia, no la del reloj UTC', () => {
    // 01:30 UTC del día 16 son las 20:30 del día 15 en Bogotá: el número tiene
    // que decir el día que vio quien reportó.
    expect(nuevoId(new Date('2026-10-16T01:30:00Z'))).toContain('FC-261015-');
  });

  it('no repite: dos reportes del mismo minuto son dos números distintos', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => nuevoId()));
    // 32⁴ = 1 048 576 combinaciones por día; 200 tiradas con alguna colisión
    // significaría un generador sesgado, no mala suerte.
    expect(vistos.size).toBe(200);
  });
});
