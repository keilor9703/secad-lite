import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CapacidadesPbx, PbxService } from '../../core/pbx.service';
import { CtiComponent } from './cti';
import { CtiHostComponent } from './cti-host';

describe('CtiHostComponent', () => {
  let fixture: ComponentFixture<CtiHostComponent>;
  let capacidades: ReturnType<typeof signal<CapacidadesPbx | null>>;

  function texto(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
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
      remove: { imports: [CtiComponent] },
      add: { imports: [CtiDoble] },
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
      (fixture.nativeElement as HTMLElement).querySelectorAll('button').length,
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
