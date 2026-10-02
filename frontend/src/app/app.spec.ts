import { TestBed } from '@angular/core/testing';
import { App } from './app';

/**
 * El componente raíz. No tiene lógica propia: monta el enrutador y poco más,
 * así que lo único honesto que se puede comprobar aquí es que arranca y que
 * deja el `router-outlet` donde el resto de la aplicación lo espera.
 *
 * La prueba que había antes verificaba el texto «Hello, frontend» que genera
 * Angular CLI al crear un proyecto — algo que esta aplicación nunca mostró.
 * Llevaba la suite entera en rojo desde el primer día, y una suite que siempre
 * falla es una que nadie mira: el fallo deja de significar nada.
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('arranca', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('monta el router-outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('router-outlet')).toBeTruthy();
  });
});
