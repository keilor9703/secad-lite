import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CapacidadesPbx, PbxService } from '../../core/pbx.service';
import { CtiColaComponent } from './cti-cola';
import { CtiComponent } from './cti';
import { CtiHostComponent } from './cti-host';

describe('CtiHostComponent', () => {
  let fixture: ComponentFixture<CtiHostComponent>;
  let capacidades: ReturnType<typeof signal<CapacidadesPbx | null>>;

  function texto(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** ¿Se montó la cola de llamadas? Tiene que estar SIEMPRE. */
  function hayCola(): boolean {
    return !!(fixture.nativeElement as HTMLElement).querySelector('app-cti-cola');
  }

  /**
   * ¿Se montó NUESTRO panel? Es lo que de verdad distingue los caminos.
   *
   * Se busca por selector y no por `instanceof`: aquí el panel está
   * sustituido por un doble, así que comparar contra la clase real daría
   * siempre falso y las pruebas pasarían sin comprobar nada.
   */
  function hayPanelPropio(): boolean {
    return !!(fixture.nativeElement as HTMLElement).querySelector('app-cti');
  }

  beforeEach(() => {
    capacidades = signal<CapacidadesPbx | null>(null);

    TestBed.configureTestingModule({
      providers: [{ provide: PbxService, useValue: { capacidades } }],
    });

    // Nuestro panel trae dependencias propias; aquí solo interesa CUÁL se
    // monta, así que se sustituye por una pieza vacía con el mismo selector.
    TestBed.overrideComponent(CtiHostComponent, {
      remove: { imports: [CtiComponent, CtiColaComponent] },
      add: { imports: [CtiDoble, ColaDoble] },
    });

    fixture = TestBed.createComponent(CtiHostComponent);
  });

  it('con la centralita propia, monta nuestro panel', () => {
    capacidades.set({
      proveedor: 'ASTERISK', nombre: 'Asterisk propio', activo: true,
      capacidades: ['entrantes', 'softphone'],
    });
    fixture.detectChanges();
    expect(hayPanelPropio()).toBe(true);
  });

  describe('la cola de llamadas va SIEMPRE', () => {
    // El defecto real del 20/10/2026: la cola estaba DENTRO del panel propio,
    // así que una instancia con la central de un tercero se quedó viendo
    // entrar las llamadas por el contador de la barra superior, sin ninguna
    // forma de tomarlas. Las llamadas llegan al webhook de FALCON venga la
    // central de donde venga; lo que cambia es cómo se contestan.

    it('con la central propia', () => {
      capacidades.set({
        proveedor: 'ASTERISK', nombre: 'Asterisk propio', activo: true,
        capacidades: ['entrantes', 'softphone'],
      });
      fixture.detectChanges();
      expect(hayCola()).toBe(true);
    });

    it('con la central del tercero', () => {
      capacidades.set({
        proveedor: 'YACO', nombre: 'YACO', activo: true, capacidades: ['entrantes'],
      });
      fixture.detectChanges();
      expect(hayCola()).toBe(true);
    });

    it('con la central propia APAGADA', () => {
      capacidades.set({
        proveedor: 'ASTERISK', nombre: 'Asterisk propio', activo: false, capacidades: [],
      });
      fixture.detectChanges();
      expect(hayCola()).toBe(true);
    });

    it('y hasta sin central configurada: un caso se recepciona a mano', () => {
      capacidades.set(null);
      fixture.detectChanges();
      expect(hayCola()).toBe(true);
    });
  });

  it('con la centralita del tercero, NO monta el nuestro y dice de quién es', () => {
    capacidades.set({
      proveedor: 'YACO', nombre: 'YACO', activo: true, capacidades: ['entrantes'],
    });
    fixture.detectChanges();

    expect(hayPanelPropio()).toBe(false);
    expect(texto()).toContain('YACO');
  });

  it('la barra del tercero NO se simula mientras no exista', () => {
    // Una maqueta en producción es una promesa que alguien se va a creer: un
    // operador que ve botones de contestar que no contestan nada.
    capacidades.set({
      proveedor: 'YACO', nombre: 'YACO', activo: true, capacidades: ['entrantes'],
    });
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.cti-ajeno button').length,
    ).toBe(0);
    expect(texto()).toContain('cuando la entreguen');
  });

  it('una planta propia APAGADA sigue siendo nuestra: se enseña el panel', () => {
    // Enseñar un hueco no explica nada. El panel apagado sí dice qué pasa.
    capacidades.set({
      proveedor: 'ASTERISK', nombre: 'Asterisk propio', activo: false, capacidades: [],
    });
    fixture.detectChanges();
    expect(hayPanelPropio()).toBe(true);
  });

  it('sin centralita configurada, lo dice y dice dónde se arregla', () => {
    capacidades.set(null);
    fixture.detectChanges();

    expect(hayPanelPropio()).toBe(false);
    expect(texto()).toContain('Plataforma');
  });
});

/** Un panel vacío que se hace pasar por el nuestro, para poder reconocerlo. */
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-cti',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class CtiDoble {}

/** Y una cola vacía, para poder comprobar que se monta. */
@Component({
  selector: 'app-cti-cola',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class ColaDoble {}
