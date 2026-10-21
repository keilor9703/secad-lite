import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdjuntosCasoComponent } from './adjuntos-caso';
import { ArchivoCaso, ArchivosService } from '../../core/archivos.service';
import { ToastService } from '../../shared/toast/toast.service';

/**
 * LO QUE MANDÓ EL CIUDADANO TIENE QUE PODER VERSE.
 *
 * El 21/10/2026 se puso en producción la descarga de adjuntos de WhatsApp y
 * el agujero se vio al mirar la pantalla: el archivo SÍ se guardaba, y no
 * había ningún sitio donde abrirlo. Una nota de voz que nadie puede oír es lo
 * mismo que una nota de voz perdida.
 */
describe('AdjuntosCasoComponent', () => {
  let fixture: ComponentFixture<AdjuntosCasoComponent>;
  let archivos: ArchivoCaso[];
  let fallaListado: boolean;
  let fallaDescarga: boolean;
  let bajados: string[];
  let errores: string[];

  const archivo = (over: Partial<ArchivoCaso> = {}): ArchivoCaso =>
    ({
      id: 'a-1', casoId: 'caso-1', nombre: 'whatsapp-foto-x.jpeg',
      tipoMime: 'image/jpeg', bytes: 51200, estado: 'COMPLETO', origen: 'ADJUNTO',
      descripcion: null, llamadaId: null, videoSesionId: null,
      creadoEn: new Date().toISOString(),
      ...over,
    }) as ArchivoCaso;

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const filas = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.adj'));

  function montar(): void {
    fixture = TestBed.createComponent(AdjuntosCasoComponent);
    fixture.componentRef.setInput('casoId', 'caso-1');
    fixture.detectChanges();
    // El listado se pide en un microtask, para no pedir durante el montaje.
    return;
  }

  async function asentar(): Promise<void> {
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(() => {
    archivos = [];
    fallaListado = false;
    fallaDescarga = false;
    bajados = [];
    errores = [];

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ArchivosService,
          useValue: {
            listarDeCaso: () =>
              fallaListado ? throwError(() => new Error('no')) : of(archivos),
            contenido: (id: string) => {
              if (fallaDescarga) return Promise.reject(new Error('no'));
              bajados.push(id);
              return Promise.resolve(new Blob(['x']));
            },
          },
        },
        { provide: ToastService, useValue: { error: (m: string) => errores.push(m), exito: () => undefined } },
      ],
    });

    // `createObjectURL` no existe en el navegador de pruebas headless igual
    // que en uno real; se sustituye para poder comprobar que se usa.
    URL.createObjectURL = () => 'blob:falso';
    URL.revokeObjectURL = () => undefined;
  });

  it('enseña lo que mandó el ciudadano, con su pie de foto', async () => {
    // El pie es lo que el ciudadano ESCRIBIÓ, y en una emergencia suele ser
    // el dato: «es en esta esquina».
    archivos = [archivo({ descripcion: 'es en esta esquina' })];
    montar();
    await asentar();

    expect(filas().length).toBe(1);
    expect(texto()).toContain('es en esta esquina');
  });

  it('NO baja los bytes al abrir el caso', async () => {
    // Un operador abre decenas de casos por turno y casi ninguno para mirar
    // la foto. Bajarlas todas al entrar es megabytes por caso.
    archivos = [archivo(), archivo({ id: 'a-2' })];
    montar();
    await asentar();

    expect(bajados).toEqual([]);
  });

  it('se bajan cuando alguien lo pide, y entonces se ven', async () => {
    archivos = [archivo()];
    montar();
    await asentar();

    await fixture.componentInstance.abrir(archivos[0]);
    fixture.detectChanges();

    expect(bajados).toEqual(['a-1']);
    expect((fixture.nativeElement as HTMLElement).querySelector('img.adj-foto')).not.toBeNull();
  });

  it('un audio se ofrece para OÍR, y sale un reproductor', async () => {
    // El verbo del botón dice qué va a pasar: no es lo mismo ver que oír.
    archivos = [archivo({ id: 'a-3', tipoMime: 'audio/ogg', nombre: 'nota.ogg' })];
    montar();
    await asentar();

    expect(texto()).toContain('Oír');

    await fixture.componentInstance.abrir(archivos[0]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('audio')).not.toBeNull();
  });

  it('las grabaciones NO se mezclan aquí', async () => {
    // Tienen su propio sitio, sus propios estados y su propio permiso.
    // Mezclarlas haría que la grabación de la llamada apareciera dos veces.
    archivos = [archivo(), archivo({ id: 'g-1', origen: 'GRABACION', nombre: 'llamada.wav' })];
    montar();
    await asentar();

    expect(filas().length).toBe(1);
    expect(texto()).not.toContain('llamada.wav');
  });

  it('dice cuántos hay, para la insignia de la pestaña', async () => {
    let cuantos = -1;
    archivos = [archivo(), archivo({ id: 'a-2' })];
    montar();
    fixture.componentInstance.cantidad.subscribe((n) => (cuantos = n));
    await asentar();

    expect(cuantos).toBe(2);
  });

  it('sin adjuntos dice qué significa, no se queda en blanco', async () => {
    montar();
    await asentar();

    expect(texto()).toContain('no ha mandado ninguna foto');
    expect(texto()).toContain('Pídaselos en la conversación');
  });

  it('si la descarga falla, dice qué hacer en vez de solo que falló', async () => {
    archivos = [archivo()];
    montar();
    await asentar();

    fallaDescarga = true;
    await fixture.componentInstance.abrir(archivos[0]);

    expect(errores.length).toBe(1);
    expect(errores[0]).toContain('Pídaselo otra vez al ciudadano');
  });

  it('si el listado falla, la pantalla no se rompe', async () => {
    fallaListado = true;
    montar();
    await asentar();

    expect(filas().length).toBe(0);
    expect(texto()).toContain('no ha mandado ninguna');
  });
});
