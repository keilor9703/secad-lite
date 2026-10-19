import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ArchivoCaso, ArchivosService, grabacionesDeLlamada, tamanoLegible } from '../../core/archivos.service';
import { ToastService } from '../../shared/toast/toast.service';
import { GrabacionLlamadaComponent } from './grabacion-llamada';

/**
 * La grabación de la llamada en la ficha del caso.
 *
 * Lo que se protege:
 *
 *  1. **Que una grabación FUERA DE LÍNEA no se confunda con una perdida.**
 *     Está íntegra en el archivo permanente y lo que el operador necesita es
 *     el nombre con el que pedirla. «No se pudo descargar» le haría creer que
 *     se perdió, y eso es lo que no puede pasar con la grabación de una
 *     llamada al 123.
 *  2. **Que no se bajen megabytes al abrir un caso.** Se lista —eso es
 *     texto— y los bytes solo cuando alguien los pide.
 *  3. **Que no se mezcle con la grabación de videollamada**, que también es
 *     un archivo con `origen = GRABACION`: si se mezclaran, aparecería dos
 *     veces o ninguna.
 *  4. **Que al cambiar de caso no quede la grabación del anterior.** La ruta
 *     del detalle se reutiliza, así que el componente no se vuelve a crear.
 */
describe('GrabacionLlamadaComponent', () => {
  const LLAMADA: ArchivoCaso = {
    id: 'a-llamada', casoId: 'caso-1', nombre: 'llamada.mp3', tipoMime: 'audio/mpeg',
    bytes: 240_000, estado: 'COMPLETO', origen: 'GRABACION',
    descripcion: 'Llamada de +573001234567 a la extensión 101 · 1 min 35 s',
    llamadaId: 'll-1', videoSesionId: null, creadoEn: '2026-10-18T10:00:00Z',
  };
  const VIDEO: ArchivoCaso = {
    ...LLAMADA, id: 'a-video', nombre: 'video.webm', tipoMime: 'video/webm',
    llamadaId: null, videoSesionId: 'vs-1', descripcion: null,
  };
  const ADJUNTO: ArchivoCaso = {
    ...LLAMADA, id: 'a-adjunto', nombre: 'foto.jpg', tipoMime: 'image/jpeg',
    origen: 'ADJUNTO', llamadaId: null, descripcion: null,
  };

  let archivos: ArchivoCaso[];
  let contenido: jasmine.Spy;
  let listar: jasmine.Spy;
  let errores: string[];
  let fixture: ComponentFixture<GrabacionLlamadaComponent>;

  function montar(casoId = 'caso-1'): GrabacionLlamadaComponent {
    errores = [];
    listar = jasmine.createSpy('listarDeCaso').and.callFake(() => of(archivos));
    contenido = jasmine.createSpy('contenido')
      .and.callFake(() => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GrabacionLlamadaComponent],
      providers: [
        { provide: ArchivosService, useValue: { listarDeCaso: listar, contenido } },
        {
          provide: ToastService,
          useValue: {
            error: (m: string) => errores.push(m),
            exito: () => undefined, info: () => undefined, advertencia: () => undefined,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(GrabacionLlamadaComponent);
    fixture.componentRef.setInput('casoId', casoId);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const texto = (): string => fixture.nativeElement.textContent ?? '';

  beforeEach(() => { archivos = [LLAMADA, VIDEO, ADJUNTO]; });

  describe('qué se lista', () => {
    it('solo las grabaciones de LLAMADA, no las de videollamada ni los adjuntos', () => {
      const c = montar();
      expect(c.grabaciones().map((g) => g.id)).toEqual(['a-llamada']);
    });

    it('de la más reciente a la más vieja', () => {
      const vieja = { ...LLAMADA, id: 'vieja', llamadaId: 'll-0', creadoEn: '2026-10-01T08:00:00Z' };
      archivos = [vieja, LLAMADA];
      expect(montar().grabaciones().map((g) => g.id)).toEqual(['a-llamada', 'vieja']);
    });

    it('sin grabaciones no dibuja nada: es un extra de la ficha, no su contenido', () => {
      archivos = [ADJUNTO];
      montar();
      expect(texto().trim()).toBe('');
    });

    it('si el listado falla, la ficha sigue sirviendo y no grita', () => {
      listar = jasmine.createSpy('listarDeCaso').and.returnValue(throwError(() => new Error('red')));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [GrabacionLlamadaComponent],
        providers: [
          { provide: ArchivosService, useValue: { listarDeCaso: listar, contenido: jasmine.createSpy() } },
          { provide: ToastService, useValue: { error: () => undefined } },
        ],
      });
      const f = TestBed.createComponent(GrabacionLlamadaComponent);
      f.componentRef.setInput('casoId', 'caso-1');
      f.detectChanges();
      expect(f.componentInstance.grabaciones()).toEqual([]);
    });

    it('enseña la descripción que armó el servidor, con el número y la duración', () => {
      montar();
      expect(texto()).toContain('+573001234567');
      expect(texto()).toContain('1 min 35 s');
    });
  });

  describe('bajarla', () => {
    it('no baja nada al abrir el caso: solo cuando se pide', () => {
      montar();
      expect(listar).toHaveBeenCalledWith('caso-1');
      expect(contenido).not.toHaveBeenCalled();
    });

    it('la baja una vez y la reutiliza', async () => {
      const c = montar();
      await c.oir(LLAMADA);
      await c.oir(LLAMADA);
      expect(contenido).toHaveBeenCalledTimes(1);
      expect(c.urls()['a-llamada']).toBeTruthy();
    });

    it('ya bajada, se reproduce en la propia ficha', async () => {
      const c = montar();
      await c.oir(LLAMADA);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('audio')).toBeTruthy();
    });
  });

  describe('cuando no está en línea', () => {
    const custodia = {
      error: { motivo: 'EN_CUSTODIA', archivo: '2026/10/itagui/llamada.mp3', sha256: 'abc123' },
    };

    it('dice que está en el archivo permanente, con el nombre que hay que pedir', async () => {
      const c = montar();
      contenido.and.returnValue(Promise.reject(custodia));
      await c.oir(LLAMADA);
      fixture.detectChanges();
      expect(c.custodia()['a-llamada']?.archivo).toBe('2026/10/itagui/llamada.mp3');
      expect(texto()).toContain('archivo permanente');
      expect(texto()).toContain('2026/10/itagui/llamada.mp3');
      expect(texto()).toContain('abc123');
    });

    it('y NO lo cuenta como un fallo de descarga', async () => {
      const c = montar();
      contenido.and.returnValue(Promise.reject(custodia));
      await c.oir(LLAMADA);
      expect(errores).toEqual([]);
      expect(fixture.nativeElement.querySelector('audio')).toBeNull();
    });

    it('un fallo de verdad sí se avisa, y no deja el botón en «Descargando…»', async () => {
      const c = montar();
      contenido.and.returnValue(Promise.reject({ error: { message: 'se cayó la red' } }));
      await c.oir(LLAMADA);
      expect(errores[0]).toContain('No fue posible descargar');
      expect(c.cargando()['a-llamada']).toBe(false);
    });
  });

  describe('una subida que quedó a medias', () => {
    it('se ve, y dice que la centralita conserva el archivo', () => {
      archivos = [{ ...LLAMADA, estado: 'FALLIDO' }];
      montar();
      expect(texto()).toContain('incompleta');
      expect(texto()).toContain('centralita conserva');
      expect(fixture.nativeElement.querySelector('button')).toBeNull();
    });
  });

  describe('al cambiar de caso', () => {
    it('vuelve a pedir y no deja la grabación del caso anterior', async () => {
      const c = montar('caso-1');
      await c.oir(LLAMADA);
      expect(c.urls()['a-llamada']).toBeTruthy();

      archivos = [];
      fixture.componentRef.setInput('casoId', 'caso-2');
      fixture.detectChanges();

      expect(listar).toHaveBeenCalledWith('caso-2');
      expect(c.grabaciones()).toEqual([]);
      expect(c.urls()).toEqual({});
    });
  });

  describe('las piezas sueltas', () => {
    it('distingue la grabación de llamada por su llamadaId, no por el tipo', () => {
      expect(grabacionesDeLlamada([VIDEO, ADJUNTO])).toEqual([]);
      expect(grabacionesDeLlamada([LLAMADA]).length).toBe(1);
    });

    it('el tamaño se lee sin contar ceros', () => {
      expect(tamanoLegible(0)).toBe('—');
      expect(tamanoLegible(900)).toBe('900 B');
      expect(tamanoLegible(240_000)).toBe('234 KB');
      expect(tamanoLegible(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });
});
