import {
  plantillaInvitacion,
  plantillaRecuperacion,
  plantillaTicketAcuse,
  plantillaTicketMesa,
  PALETA_CORREO,
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
    expect(m.html).toContain('Hola, Juan<');
    expect(m.html).not.toContain('Juan Carlos Pérez Gómez');
    // Y también en la versión de texto, que es la que leen los filtros.
    expect(m.texto).toContain('Hola, Juan');
  });

  it('el titular va en dos líneas: la segunda dice qué hay que hacer', () => {
    // Es lo que se lee antes de decidir si el correo importa. La segunda línea
    // va en turquesa sobre la franja; si alguien la quita, el correo deja de
    // tener una frase que explique la acción.
    const m = plantillaInvitacion('Juan', 'jperez', URL, 72);
    expect(m.html).toContain('Su acceso está listo.');
    expect(m.html).toContain('Falta su contraseña.');
    expect(m.texto).toContain('SU ACCESO ESTÁ LISTO. FALTA SU CONTRASEÑA.');
  });

  describe('el águila de la franja', () => {
    const previo = { logo: process.env.CORREO_LOGO_URL, base: process.env.URL_PUBLICA };
    afterEach(() => {
      restaurar('CORREO_LOGO_URL', previo.logo);
      restaurar('URL_PUBLICA', previo.base);
    });

    it('se sirve desde el propio dominio, con alt vacío', () => {
      process.env.URL_PUBLICA = 'https://falconcad.com.co/';
      delete process.env.CORREO_LOGO_URL;
      const m = plantillaInvitacion('Juan', 'jperez', URL, 72);
      // Absoluta y en el dominio propio: un `data:` lo descartan Gmail y
      // Outlook, y una ruta relativa no resuelve en ningún buzón.
      expect(m.html).toContain('src="https://falconcad.com.co/kit-marca-aguila/aguila-correo.png"');
      // Sin anunciarse a los lectores de pantalla: el nombre está escrito al lado.
      expect(m.html).toMatch(/<img[^>]*alt=""/);
    });

    it('sin origen público configurado no se emite ninguna imagen rota', () => {
      delete process.env.URL_PUBLICA;
      delete process.env.CORREO_LOGO_URL;
      const m = plantillaInvitacion('Juan', 'jperez', URL, 72);
      expect(m.html).not.toContain('<img');
    });

    it('la franja dice de quién es el correo aunque la imagen no cargue', () => {
      // Outlook bloquea las imágenes por defecto. Si el membrete dependiera del
      // águila, la primera impresión sería un recuadro vacío — y esa primera
      // impresión es la que decide si el mensaje parece legítimo.
      process.env.URL_PUBLICA = 'https://falconcad.com.co';
      const sinImagenes = plantillaInvitacion('Juan', 'jperez', URL, 72)
        .html.replace(/<img[^>]*>/g, '');
      expect(sinImagenes).toContain('FALCON');
      expect(sinImagenes).toContain('CAD');
    });
  });

  /** Deja la variable como estaba, exista o no. */
  function restaurar(nombre: string, valor: string | undefined): void {
    if (valor === undefined) delete process.env[nombre];
    else process.env[nombre] = valor;
  }
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

/**
 * El contraste del correo, medido.
 *
 * Mismo criterio que `scripts/contraste.mjs` para la aplicación: WCAG 2.1 AA
 * pide 4,5:1 para texto normal. Aquí importa más que en pantalla — un correo
 * se abre en el turno de noche, en el teléfono, a veces con el brillo al
 * mínimo — y nadie va a revisarlo cuando alguien aclare un gris «porque se ve
 * mejor» en su monitor.
 */
describe('contraste de la paleta del correo', () => {
  const P = PALETA_CORREO;

  const luminancia = (hex: string): number =>
    ([0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16)))
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);

  const contraste = (a: string, b: string): number => {
    const [la, lb] = [luminancia(a), luminancia(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const pares: Array<[string, string, string]> = [
    ['titular sobre la franja', P.BLANCO, P.MARINO],
    ['segunda línea del titular', P.TURQUESA, P.MARINO],
    ['saludo sobre la franja', P.SOBRE_MARINO, P.MARINO],
    ['«central de despacho»', P.SOBRE_MARINO, P.MARINO],
    ['párrafo del cuerpo', P.TINTA_SUAVE, P.PAPEL],
    ['dato destacado', P.TINTA, P.PAPEL],
    ['rótulos y nota al pie', P.APAGADO, P.PAPEL],
    ['pie, fuera de la tarjeta', P.APAGADO, P.FONDO],
    ['texto dentro de una caja', P.TINTA_SUAVE, P.FONDO],
    ['enlace de respaldo', P.ACENTO, P.PAPEL],
    ['texto del botón', P.BLANCO, P.ACENTO],
  ];

  for (const [que, texto, fondo] of pares) {
    it(`${que}: llega a 4,5:1`, () => {
      const v = contraste(texto, fondo);
      // El mensaje lleva la medida: quien rompa esto tiene que saber por cuánto.
      expect(`${que}: ${v.toFixed(2)}:1 (${texto} sobre ${fondo})`)
        .toBe(`${que}: ${Math.max(v, 4.5).toFixed(2)}:1 (${texto} sobre ${fondo})`);
    });
  }

  it('no hay colores sueltos fuera de la paleta', () => {
    // La otra mitad: medir la paleta no sirve de nada si el HTML trae un gris
    // escrito a mano que no está en ella.
    process.env.URL_PUBLICA = 'https://falconcad.com.co';
    const permitidos = new Set<string>([
      ...Object.values(P).map((c) => c.toLowerCase()),
      // Los del bloque de modo oscuro, que solo aplican cuando el cliente lo pide.
      '#0a131c', '#16222e', '#e8eef4', '#c3d0dc', '#9fb0c0', '#24323f', '#101a24', '#56cfe0',
    ]);
    const enlace = 'https://falconcad.com.co/activar/TOKEN';
    const html = plantillaInvitacion('Juan', 'jperez', enlace, 72).html
      + plantillaRecuperacion('Ana', 'aruiz', enlace, 1).html;
    const usados = new Set((html.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase()));
    const sueltos = [...usados].filter((c) => !permitidos.has(c));
    expect(sueltos).toEqual([]);
  });
});

/**
 * A dónde contesta quien recibe. Un `no-reply` deja sin salida a la persona
 * que responde «no me llegó nada», y los buzones grandes puntúan peor a un
 * remitente al que nadie puede contestar.
 */
describe('las respuestas tienen a dónde ir', () => {
  const previo = { resp: process.env.CORREO_RESPONDER_A, sop: process.env.SOPORTE_CORREO };
  const ENLACE = 'https://falconcad.com.co/activar/TOKEN';

  afterEach(() => {
    if (previo.resp === undefined) delete process.env.CORREO_RESPONDER_A;
    else process.env.CORREO_RESPONDER_A = previo.resp;
    if (previo.sop === undefined) delete process.env.SOPORTE_CORREO;
    else process.env.SOPORTE_CORREO = previo.sop;
  });

  it('por defecto, a la mesa de ayuda, y el pie lo dice', () => {
    delete process.env.CORREO_RESPONDER_A;
    delete process.env.SOPORTE_CORREO;
    const m = plantillaInvitacion('Juan', 'jperez', ENLACE, 72);
    expect(m.responderA).toBe('soporte@falconcad.com.co');
    expect(m.html).toContain('responda a este correo');
    expect(m.html).not.toContain('No responda a este correo');
  });

  it('sigue al buzón de soporte cuando se cambia', () => {
    delete process.env.CORREO_RESPONDER_A;
    process.env.SOPORTE_CORREO = 'tickets@mesa.example';
    expect(plantillaRecuperacion('Ana', 'aruiz', ENLACE, 1).responderA).toBe('tickets@mesa.example');
  });

  it('declarada vacía, se vuelve al «no responda» de antes', () => {
    // Coherencia: si no hay a dónde contestar, el correo no puede invitar a
    // hacerlo. Las dos cosas se deciden en el mismo sitio justamente por esto.
    process.env.CORREO_RESPONDER_A = '';
    const m = plantillaInvitacion('Juan', 'jperez', ENLACE, 72);
    expect(m.responderA).toBeUndefined();
    expect(m.html).toContain('No responda a este correo');
    expect(m.texto).toContain('No responda a este correo');
  });
});
