import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DiagnosticoService, InformeDiagnostico } from '../../core/diagnostico.service';
import { RespuestaTicket, SoporteService } from '../../core/soporte.service';
import { ToastService } from '../toast/toast.service';
import { SoporteComponent } from './soporte';

/**
 * El diálogo de soporte se abre cuando algo YA está roto. Lo que se protege
 * aquí es que nunca deje a la persona peor de como llegó:
 *
 *  1. Si el reporte sale, muestra el número — es lo único que se lleva.
 *  2. Si NO sale, lo dice, no muestra número, y conserva copiar y descargar.
 *     Un diálogo que se cierra diciendo «listo» cuando nada salió es peor que
 *     uno que no manda nada.
 *  3. Lo que viaja es exactamente lo que se mostró en pantalla.
 */
describe('diálogo de soporte', () => {
  const INFORME = {
    generadoEn: '2026-10-15T12:00:00.000Z',
    version: { commit: '2ee819c', publicado: '2026-10-15T11:00:00Z' },
    sesion: { usuario: 'jperez', nombre: 'Juan Pérez', rol: 'despachador', tenant: '63001', agencia: 'policia' },
    donde: { ruta: '/despacho' },
    navegador: {
      agente: 'Chrome', idioma: 'es-CO', zonaHoraria: 'America/Bogota',
      ventana: '1280×900', pantalla: '1280×900', enLinea: true,
    },
    canales: { casosEnVivo: 'conectado', planta: 'conectada' },
    errores: [],
  } as unknown as InformeDiagnostico;

  const CONTEXTO = '── FALCON CAD · contexto técnico ──\nVersión 2ee819c\nPantalla /despacho';
  const OK: RespuestaTicket = {
    id: 'FC-261015-7K3Q', enviado: true, acuse: 'enviado', mesa: 'soporte@falconcad.com.co',
  };

  let abrirTicket: jasmine.Spy;
  let avisos: string[];

  function crear(): SoporteComponent {
    abrirTicket = jasmine.createSpy('abrirTicket').and.resolveTo(OK);
    avisos = [];
    const toast = {
      exito: (m: string) => avisos.push(`exito:${m}`),
      error: (m: string) => avisos.push(`error:${m}`),
      advertencia: (m: string) => avisos.push(`adv:${m}`),
      info: (m: string) => avisos.push(`info:${m}`),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SoporteService, useValue: { abrirTicket } },
        {
          provide: DiagnosticoService,
          useValue: {
            armar: () => Promise.resolve(INFORME),
            comoTexto: () => CONTEXTO,
          },
        },
        { provide: ToastService, useValue: toast },
      ],
    });
    return TestBed.createComponent(SoporteComponent).componentInstance;
  }

  /** Deja el diálogo como queda tras abrirlo y escribir el relato. */
  async function listo(relato = 'El mapa no carga en el puesto 3.'): Promise<SoporteComponent> {
    const c = crear();
    c.ngOnInit();
    await Promise.resolve();
    c.relato.set(relato);
    return c;
  }

  it('no deja enviar sin un relato de verdad', async () => {
    const c = await listo('no');
    expect(c.listo()).toBeFalse();

    await c.enviar();

    expect(abrirTicket).not.toHaveBeenCalled();
  });

  it('manda lo mismo que mostró en pantalla, y nada más', async () => {
    const c = await listo();

    await c.enviar();

    expect(abrirTicket).toHaveBeenCalledWith({
      severidad: 'S3',
      relato: 'El mapa no carga en el puesto 3.',
      contexto: CONTEXTO,
      pantalla: '/despacho',
    });
  });

  it('con el reporte enviado, muestra el número y no deja fallo a la vista', async () => {
    const c = await listo();

    await c.enviar();

    expect(c.ticket()?.id).toBe('FC-261015-7K3Q');
    expect(c.fallo()).toBe('');
    expect(c.enviando()).toBeFalse();
  });

  it('si el servidor dice que el correo no salió, NO muestra número', async () => {
    const c = await listo();
    abrirTicket.and.resolveTo({
      id: 'FC-261015-ZZZZ', enviado: false, acuse: 'sin-correo',
      mesa: 'soporte@falconcad.com.co', error: 'HTTP 402 sin crédito',
    } as RespuestaTicket);

    await c.enviar();

    // Un número que no está en ningún buzón es peor que ningún número.
    expect(c.ticket()).toBeNull();
    expect(c.fallo()).toContain('no pudo enviar');
    expect(c.fallo()).toContain('402');
    expect(c.fallo()).toContain('Copie o descargue');
  });

  it('sin conexión, lo dice y ofrece el respaldo', async () => {
    const c = await listo();
    abrirTicket.and.rejectWith(new HttpErrorResponse({ status: 0 }));

    await c.enviar();

    expect(c.ticket()).toBeNull();
    expect(c.fallo()).toContain('No hubo conexión');
    expect(c.fallo()).toContain('Copie o descargue');
  });

  it('con el tope de envíos alcanzado, explica que espere', async () => {
    const c = await listo();
    abrirTicket.and.rejectWith(new HttpErrorResponse({ status: 429 }));

    await c.enviar();

    expect(c.fallo()).toContain('Espere unos minutos');
  });

  it('si la sesión expiró, avisa que el texto se pierde al volver a entrar', async () => {
    // Para esta ruta el interceptor no navega al login: botar la pantalla se
    // llevaría el relato que la persona acaba de escribir.
    const c = await listo();
    abrirTicket.and.rejectWith(new HttpErrorResponse({ status: 401 }));

    await c.enviar();

    expect(c.fallo()).toContain('sesión expiró');
    expect(c.fallo()).toContain('se pierde');
  });

  it('dos clics seguidos no abren dos reportes del mismo problema', async () => {
    const c = await listo();
    let soltar: (r: RespuestaTicket) => void = () => undefined;
    abrirTicket.and.returnValue(new Promise<RespuestaTicket>((res) => { soltar = res; }));

    const primero = c.enviar();
    expect(c.enviando()).toBeTrue();
    await c.enviar();          // el segundo clic, mientras el primero vuela
    soltar(OK);
    await primero;

    expect(abrirTicket).toHaveBeenCalledTimes(1);
  });

  it('un reintento borra el fallo anterior en vez de acumularlo', async () => {
    const c = await listo();
    abrirTicket.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    await c.enviar();
    expect(c.fallo()).not.toBe('');

    abrirTicket.and.resolveTo(OK);
    await c.enviar();

    expect(c.fallo()).toBe('');
    expect(c.ticket()?.id).toBe('FC-261015-7K3Q');
  });

  it('el reporte para copiar lleva la severidad, el relato y el contexto', async () => {
    const c = await listo();

    const texto = c.reporte();

    expect(texto).toContain('S3');
    expect(texto).toContain('El mapa no carga en el puesto 3.');
    expect(texto).toContain('Versión 2ee819c');
  });
});

/**
 * Y lo que se ve, medido en el navegador de verdad: `src/styles.scss` se carga
 * en las pruebas (ver `angular.json`), así que los tokens resuelven y lo que
 * informa `getComputedStyle` aquí es lo que se pinta en la pantalla.
 *
 * Esto existe porque una prueba de DOM puede decir «visible» sobre algo que no
 * se está pintando: ya pasó con el menú «Más» de la barra superior, que estaba
 * en el árbol y recortado por un `overflow: hidden`. Aquí se miden colores y
 * tamaños reales, no la presencia de una clase.
 */
describe('la confirmación del reporte, medida', () => {
  const OK: RespuestaTicket = {
    id: 'FC-261015-7K3Q', enviado: true, acuse: 'enviado', mesa: 'soporte@falconcad.com.co',
  };

  function montar(): ComponentFixture<SoporteComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SoporteService, useValue: { abrirTicket: () => Promise.resolve(OK) } },
        {
          provide: DiagnosticoService,
          useValue: { armar: () => Promise.resolve({} as InformeDiagnostico), comoTexto: () => 'ctx' },
        },
        {
          provide: ToastService,
          useValue: { exito: () => undefined, error: () => undefined, advertencia: () => undefined, info: () => undefined },
        },
      ],
    });
    const f = TestBed.createComponent(SoporteComponent);
    f.detectChanges();
    return f;
  }

  /** Luminancia relativa y contraste WCAG a partir de un `rgb(...)` calculado. */
  function contraste(a: string, b: string): number {
    const canal = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'])
      .slice(0, 3).map(Number)
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [la, lb] = [canal(a), canal(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  it('el número se pinta: fondo propio, texto legible y nada recortado', () => {
    const f = montar();
    f.componentInstance.ticket.set(OK);
    f.detectChanges();

    const el = f.nativeElement.querySelector('.numero') as HTMLElement;
    expect(el).withContext('el número tiene que estar en pantalla').toBeTruthy();
    expect(el.textContent?.trim()).toBe('FC-261015-7K3Q');

    const css = getComputedStyle(el);
    // Fondo propio: sin él el número no se distingue del resto del diálogo.
    expect(css.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    // Legible de verdad, no «en teoría»: AA pide 4,5 para texto normal, y este
    // es grande, pero se dicta por teléfono leyéndolo, así que se le exige todo.
    expect(contraste(css.color, css.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    // Y grande: es lo único que la persona se lleva de aquí.
    expect(parseFloat(css.fontSize)).toBeGreaterThanOrEqual(24);
    // Catorce caracteres en monoespaciada a 28 px dentro de un diálogo mediano:
    // si algún día no caben, esto lo dice antes que un usuario.
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
  });

  it('el resumen muestra cada dato sin recortarlo', () => {
    const f = montar();
    f.componentInstance.ticket.set(OK);
    f.detectChanges();

    const datos = Array.from(f.nativeElement.querySelectorAll('.resumen dd')) as HTMLElement[];
    expect(datos.length).toBe(3);
    for (const d of datos) {
      expect(d.textContent?.trim().length).toBeGreaterThan(0);
      expect(d.scrollWidth).toBeLessThanOrEqual(d.clientWidth + 1);
    }
    expect(datos[1].textContent).toContain('soporte@falconcad.com.co');
  });

  it('al confirmar, el formulario desaparece y queda una sola acción principal', () => {
    const f = montar();
    f.componentInstance.ticket.set(OK);
    f.detectChanges();

    const raiz = f.nativeElement as HTMLElement;
    expect(raiz.querySelector('textarea')).toBeNull();
    expect(raiz.querySelectorAll('.btn--primary').length).toBe(1);
    expect(raiz.querySelector('.btn--primary')?.textContent?.trim()).toBe('Entendido');
  });

  it('cuando el envío falla, el formulario SIGUE ahí con el respaldo', () => {
    // Es la razón de ser del respaldo: si se cerrara el formulario, el relato
    // que la persona escribió se perdería junto con la única forma de mandarlo.
    const f = montar();
    f.componentInstance.fallo.set('No hubo conexión con el servidor.');
    f.detectChanges();

    const raiz = f.nativeElement as HTMLElement;
    expect(raiz.querySelector('textarea')).not.toBeNull();
    expect(raiz.querySelector('.numero')).toBeNull();
    const avisos = raiz.querySelector('[role="alert"]') as HTMLElement;
    expect(avisos?.textContent).toContain('No hubo conexión');
    const botones = Array.from(raiz.querySelectorAll('.dialogo-acciones .btn'))
      .map((b) => b.textContent?.trim());
    expect(botones).toContain('Descargar');
    expect(botones).toContain('Copiar reporte');
  });

  it('el aviso del fallo también se lee: no es texto gris sobre gris', () => {
    const f = montar();
    f.componentInstance.fallo.set('No hubo conexión con el servidor.');
    f.detectChanges();

    const aviso = f.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    const css = getComputedStyle(aviso);
    expect(contraste(css.color, css.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });
});

