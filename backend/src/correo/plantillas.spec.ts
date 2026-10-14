import { plantillaInvitacion, plantillaRecuperacion } from './plantillas';

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
