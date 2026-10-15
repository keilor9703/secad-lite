import {
  plantillaInvitacion,
  plantillaRecuperacion,
  plantillaTicketAcuse,
  plantillaTicketMesa,
  TicketCorreo,
} from './plantillas';

/**
 * Lo que se protege de los correos. No la estética —eso se mira renderizado—
 * sino lo que no puede fallar nunca: que no viaje una contraseña, que el
 * enlace esté, que el nombre de otra persona no pueda inyectar marcado, y que
 * la versión en texto plano exista (sin ella varios filtros puntúan peor y el
 * correo acaba en spam).
 */
describe('plantillas de correo', () => {
  const URL = 'https://falconcad.com.co/activar/TOKEN-DE-PRUEBA';

  const ambas = [
    { nombre: 'invitación', hacer: () => plantillaInvitacion('Juan Pérez', 'jperez', URL, 72) },
    { nombre: 'recuperación', hacer: () => plantillaRecuperacion('Ana Ruiz', 'aruiz', URL, 1) },
  ];

  for (const c of ambas) {
    describe(c.nombre, () => {
      it('lleva el enlace, en el HTML y en el texto', () => {
        const m = c.hacer();
        expect(m.html).toContain(URL);
        expect(m.texto).toContain(URL);
      });

      it('tiene versión en texto plano con contenido real', () => {
        const m = c.hacer();
        expect(m.texto.length).toBeGreaterThan(200);
        expect(m.texto).toContain('FALCON CAD');
        // Sin marcado colado desde las frases que el HTML sí formatea.
        expect(m.texto).not.toContain('<strong>');
        expect(m.texto).not.toContain('&amp;');
      });

      it('nombra el usuario y el asunto lo identifica', () => {
        const m = c.hacer();
        expect(m.html).toContain(c.nombre === 'invitación' ? 'jperez' : 'aruiz');
        expect(m.asunto).toContain('FALCON CAD');
        expect(m.asunto.length).toBeLessThan(80);
      });

      it('trae preencabezado, para que el buzón no muestre una frase cualquiera', () => {
        // Sin él, el cliente rellena ese espacio con el primer texto que
        // encuentra — «O copie esta dirección…», que da pésima impresión.
        const m = c.hacer();
        expect(m.html).toMatch(/mso-hide:all">[^<]{20,}</);
      });

      it('no lleva emoji ni signos de admiración', () => {
        const m = c.hacer();
        // Hay que quitar el <style> ANTES de las etiquetas: su contenido no es
        // una etiqueta, sobrevive al barrido, y sus `!important` se cuentan
        // como signos de admiración del texto visible.
        const visible = m.html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
        expect(visible).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
        expect(visible).not.toContain('!');
        expect(visible).not.toContain('¡');
      });

      it('define color de texto en cada bloque, para no depender del cliente', () => {
        // Un cliente en modo oscuro pinta el fondo y deja el texto en negro si
        // nadie lo declaró: así se pierden párrafos enteros.
        const m = c.hacer();
        const parrafos = m.html.match(/<p [^>]*>/g) ?? [];
        expect(parrafos.length).toBeGreaterThan(0);
        for (const p of parrafos) expect(p).toContain('color:');
      });
    });
  }

  it('escapa el nombre: un administrador no puede inyectar marcado', () => {
    const m = plantillaInvitacion('<script>alert(1)</script>', 'jperez', URL, 72);
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('escapa también el nombre de usuario donde se muestra', () => {
    const m = plantillaRecuperacion('Ana', '<b>admin</b>', URL, 1);
    expect(m.html).not.toContain('<b>admin</b>');
  });

  it('redacta la vigencia en español correcto', () => {
    expect(plantillaInvitacion('A', 'a', URL, 1).html).toContain('1 hora<');
    expect(plantillaInvitacion('A', 'a', URL, 72).html).toContain('72 horas<');
  });

  it('saluda con el nombre de pila, no con el nombre completo', () => {
    const m = plantillaInvitacion('Juan Carlos Pérez Gómez', 'jcperez', URL, 72);
    expect(m.html).toContain('Juan, se creó');
    expect(m.html).not.toContain('Juan Carlos Pérez Gómez, se creó');
  });
});

/**
 * Los correos del ticket. Lo que se protege aquí: que el relato —texto libre
 * de otra persona— no pueda inyectar nada, que el asunto no se pueda usar para
 * meter cabeceras, y que ninguno de los dos prometa un estado que no existe.
 */
describe('plantillas del ticket de soporte', () => {
  const TICKET: TicketCorreo = {
    id: 'FC-261015-7K3Q',
    severidad: 'S2',
    severidadTitulo: 'Funciona, pero mal',
    compromiso: 'Respuesta en 1 hora dentro del horario',
    relato: 'El mapa no carga en el puesto 3 desde las 7 de la mañana.',
    contexto: '── FALCON CAD · contexto técnico ──\nVersión 2ee819c\nPantalla /despacho',
    instancia: 'Alcaldía de Soacha (63001)',
    quien: 'Juan Pérez (jperez)',
    correoQuien: 'jperez@soacha.gov.co',
    pantalla: '/despacho',
  };
  const MESA = 'soporte@falconcad.com.co';

  const ambos = [
    { nombre: 'aviso a la mesa', hacer: (t = TICKET) => plantillaTicketMesa(t) },
    { nombre: 'acuse', hacer: (t = TICKET) => plantillaTicketAcuse(t, MESA) },
  ];

  for (const c of ambos) {
    describe(c.nombre, () => {
      it('lleva el número, en el HTML y en el texto', () => {
        const m = c.hacer();
        expect(m.html).toContain(TICKET.id);
        expect(m.texto).toContain(TICKET.id);
        expect(m.asunto).toContain(TICKET.id);
      });

      it('lleva el relato y la versión en texto plano tiene contenido real', () => {
        const m = c.hacer();
        expect(m.html).toContain('El mapa no carga');
        expect(m.texto).toContain('El mapa no carga');
        expect(m.texto.length).toBeGreaterThan(200);
        expect(m.texto).toContain('FALCON CAD');
        expect(m.texto).not.toContain('<strong>');
      });

      it('no lleva botón ni enlace: no hay nada que consultar todavía', () => {
        // Es lo que distingue estos correos de la invitación. Un botón que no
        // lleva a ningún lado es peor que ninguno.
        const m = c.hacer();
        expect(m.html).not.toContain('<a href');
        expect(m.html).not.toContain('O copie esta dirección');
      });

      it('trae preencabezado, para que el buzón no muestre una frase cualquiera', () => {
        const m = c.hacer();
        expect(m.html).toMatch(/mso-hide:all">[^<]{20,}</);
      });

      it('el asunto cabe en lo que muestra un cliente de correo', () => {
        const largo = { ...TICKET, relato: 'El mapa no carga '.repeat(40) };
        expect(c.hacer(largo).asunto.length).toBeLessThanOrEqual(80);
      });

      it('el asunto no se puede usar para inyectar cabeceras', () => {
        // Un relato con saltos de línea llega al asunto por el resumen. Si
        // sobrevivieran, un relato podría agregar un Bcc: al correo.
        const malo = { ...TICKET, relato: 'falla\r\nBcc: alguien@example.com\r\n\r\nhola' };
        const m = c.hacer(malo);
        expect(m.asunto).not.toMatch(/[\r\n]/);
      });

      it('escapa el relato: quien reporta no puede inyectar marcado', () => {
        const malo = { ...TICKET, relato: '<script>alert(1)</script> y <b>negrita</b>' };
        const m = c.hacer(malo);
        expect(m.html).not.toContain('<script>');
        expect(m.html).not.toContain('<b>negrita</b>');
        expect(m.html).toContain('&lt;script&gt;');
      });

      it('escapa también el nombre de quien reporta y la instancia', () => {
        const malo = { ...TICKET, quien: '<b>admin</b>', instancia: '<i>x</i>' };
        const m = c.hacer(malo);
        expect(m.html).not.toContain('<b>admin</b>');
        expect(m.html).not.toContain('<i>x</i>');
      });

      it('define color de texto en cada bloque, para no depender del cliente', () => {
        const m = c.hacer();
        const parrafos = m.html.match(/<p [^>]*>/g) ?? [];
        expect(parrafos.length).toBeGreaterThan(0);
        for (const p of parrafos) expect(p).toContain('color:');
      });
    });
  }

  it('el aviso a la mesa lleva el contexto técnico; el acuse, no', () => {
    expect(plantillaTicketMesa(TICKET).texto).toContain('Versión 2ee819c');
    expect(plantillaTicketAcuse(TICKET, MESA).texto).not.toContain('Versión 2ee819c');
  });

  it('el aviso a la mesa recuerda que la severidad la confirma la mesa', () => {
    // La regla está en docs/mesa-de-ayuda.md; el correo la repite donde se decide.
    expect(plantillaTicketMesa(TICKET).texto).toContain('la confirma la mesa');
  });

  it('el acuse de un reporte crítico insiste en llamar por teléfono', () => {
    const s1 = { ...TICKET, severidad: 'S1', severidadTitulo: 'La operación está detenida' };
    expect(plantillaTicketAcuse(s1, MESA).texto).toContain('por teléfono');
    // Y el de un S3 no: un aviso que sale siempre deja de leerse.
    expect(plantillaTicketAcuse(TICKET, MESA).texto).not.toContain('por teléfono');
  });

  it('el contexto técnico conserva los saltos de línea en el HTML', () => {
    // Sin `pre-wrap`, las cuarenta líneas del informe llegan como un párrafo
    // continuo y deja de poder leerse de un vistazo, que es su único propósito.
    expect(plantillaTicketMesa(TICKET).html).toContain('white-space:pre-wrap');
  });

  it('el preencabezado no delata más de lo que hace falta', () => {
    // Lo que se ve en la lista del buzón sin abrir el correo: el número y un
    // resumen, nunca el contexto técnico entero.
    const m = plantillaTicketMesa(TICKET);
    const pre = /mso-hide:all">([^<]*)</.exec(m.html)?.[1] ?? '';
    expect(pre).toContain(TICKET.id);
    expect(pre.length).toBeLessThan(160);
  });
});
