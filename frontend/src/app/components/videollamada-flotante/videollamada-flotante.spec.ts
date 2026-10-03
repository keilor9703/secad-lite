import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { VideollamadaFlotanteComponent } from './videollamada-flotante';
import { VideollamadaService } from '../../core/videollamada.service';

/**
 * Dónde aparece el panel de videollamada.
 *
 * El panel vive por encima del enrutador para que cambiar de pantalla no tumbe
 * la llamada, pero eso NO debe cambiar dónde lo ve el operador: tiene que
 * aparecer acoplado en el hueco del caso, que es donde estaba antes, con el mapa
 * al lado. Flotar es una decisión suya.
 *
 * Lo que de verdad se prueba aquí es la diferencia entre flotar porque el
 * operador lo pidió y flotar porque no hay dónde acoplarse. Confundirlas tiene
 * dos síntomas opuestos y los dos molestan: o el panel nunca vuelve a su sitio
 * al regresar al caso, o le vuelve a aparecer acoplado al operador que acababa
 * de soltarlo.
 */
describe('VideollamadaFlotanteComponent — acoplada por omisión', () => {
  let video: VideollamadaService;
  let ancla: HTMLElement;

  function montar() {
    const fixture = TestBed.createComponent(VideollamadaFlotanteComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Lo que hace la página al destruirse: ver AnclajeVideollamadaDirective. */
  function irseDeLaPagina(): void {
    video.devolverAFlotante()?.();
    video.anclaje.set(null);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    video = TestBed.inject(VideollamadaService);
    ancla = document.createElement('div');
    document.body.appendChild(ancla);
    video.abrirPanel('caso-1', '3001234567');
    video.anclaje.set(ancla);
  });

  afterEach(() => ancla.remove());

  it('arranca acoplada, dentro del hueco de la página', () => {
    // Antes de la primera detección de cambios, para fijar el valor INICIAL y no
    // solo el que deja el efecto: si naciera flotante, el primer fotograma de
    // cada llamada pintaría la ventana suelta antes de meterse en el hueco.
    const fixture = TestBed.createComponent(VideollamadaFlotanteComponent);
    expect(fixture.componentInstance.modo()).withContext('nace acoplada').toBe('acoplada');

    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).toBe('acoplada');
    expect(ancla.firstElementChild).withContext('la caja quedó en el hueco').toBeTruthy();
  });

  it('flota solo si no hay dónde acoplarse, y vuelve al hueco al regresar', () => {
    const fixture = montar();

    irseDeLaPagina();
    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).toBe('flotante');
    expect(ancla.firstElementChild).withContext('salió del hueco').toBeNull();

    // El operador vuelve al caso: el hueco existe otra vez.
    video.anclaje.set(ancla);
    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).toBe('acoplada');
    expect(ancla.firstElementChild).withContext('volvió al hueco').toBeTruthy();
  });

  it('respeta al operador que desacopló: volver al caso NO lo reacopla', () => {
    const fixture = montar();

    fixture.componentInstance.alternarAcople();
    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).toBe('flotante');

    // Se va y vuelve. La ventana sigue donde él la dejó.
    irseDeLaPagina();
    fixture.detectChanges();
    video.anclaje.set(ancla);
    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).withContext('no se le reacopla a sus espaldas').toBe('flotante');
  });

  it('y la vuelve a acoplar si él lo pide', () => {
    const fixture = montar();
    fixture.componentInstance.alternarAcople();
    fixture.detectChanges();
    fixture.componentInstance.alternarAcople();
    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).toBe('acoplada');
    expect(ancla.firstElementChild).toBeTruthy();
  });

  it('cada llamada nueva empieza acoplada, aunque la anterior se desacoplara', () => {
    const fixture = montar();
    fixture.componentInstance.alternarAcople();
    fixture.detectChanges();
    expect(fixture.componentInstance.modo()).toBe('flotante');

    // Termina esa llamada y entra otra.
    video.cerrarPanel();
    fixture.detectChanges();
    video.abrirPanel('caso-2', '3009999999');
    video.anclaje.set(ancla);
    fixture.detectChanges();

    expect(fixture.componentInstance.modo()).withContext('la decisión no se hereda').toBe('acoplada');
  });
});
