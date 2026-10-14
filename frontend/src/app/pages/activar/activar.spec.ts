import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ActivarComponent } from './activar';
import { environment } from '../../../environments/environment';

/**
 * Esta página es la única puerta de entrada de un funcionario cuya cuenta
 * todavía no tiene contraseña. Si el botón no hace nada, la persona no puede
 * entrar y no hay forma de que lo reporte — porque tampoco puede usar el
 * sistema desde donde se reporta.
 *
 * La prueba PULSA el botón. Comprobar que la página se dibuja y que el botón
 * queda habilitado no basta: el fallo que hubo —un `(ngSubmit)` sin
 * FormsModule, que deja al navegador recargar la página— se ve exactamente
 * igual hasta que alguien hace clic.
 */
describe('página de activación', () => {
  const BASE = environment.apiBaseUrl;
  const TOKEN = 'tok-de-prueba';
  let fixture: ComponentFixture<ActivarComponent>;
  let http: HttpTestingController;

  function escribir(selector: string, valor: string): void {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = valor;
    input.dispatchEvent(new Event('input'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActivarComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => TOKEN } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ActivarComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /** Responde la validación del enlace que el componente pide al arrancar. */
  function enlaceValido(tipo: 'invitacion' | 'recuperacion' = 'invitacion'): void {
    http.expectOne(`${BASE}/auth/activacion/${TOKEN}`)
      .flush({ usuario: 'jperez', nombre: 'Juan Pérez', tipo });
    fixture.detectChanges();
  }

  it('saluda por el nombre antes de pedir la contraseña', () => {
    enlaceValido();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Juan Pérez');
    expect(texto).toContain('jperez');
  });

  it('un enlace muerto lo dice, y no pide contraseña', () => {
    http.expectOne(`${BASE}/auth/activacion/${TOKEN}`)
      .flush({ message: 'no sirve' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ya no sirve');
    expect(fixture.nativeElement.querySelector('#clave')).toBeNull();
  });

  it('PULSAR el botón envía la contraseña', () => {
    enlaceValido();
    escribir('#clave', 'MiClaveLarga1');
    escribir('#confirma', 'MiClaveLarga1');
    fixture.detectChanges();

    const boton = fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    boton.click();

    const req = http.expectOne(`${BASE}/auth/activacion/${TOKEN}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ contrasena: 'MiClaveLarga1' });
  });

  it('el formulario NO deja que el navegador lo envíe y recargue la página', () => {
    // La otra cara del mismo fallo: aunque el manejador corriera, si no se
    // impide el envío nativo el navegador recarga y la petición se pierde.
    enlaceValido();
    escribir('#clave', 'MiClaveLarga1');
    escribir('#confirma', 'MiClaveLarga1');
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const evento = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(evento);

    expect(evento.defaultPrevented).withContext('el envío nativo debe quedar cancelado').toBe(true);
    http.expectOne(`${BASE}/auth/activacion/${TOKEN}`).flush({ ok: true });
  });

  it('con las contraseñas distintas no se envía nada', () => {
    enlaceValido();
    escribir('#clave', 'MiClaveLarga1');
    escribir('#confirma', 'OtraDistinta9');
    fixture.detectChanges();

    const boton = fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    boton.click();
    // http.verify() en afterEach falla si salió alguna petición.
  });

  it('una contraseña corta tampoco se envía', () => {
    enlaceValido();
    escribir('#clave', 'corta');
    escribir('#confirma', 'corta');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('tras guardar, confirma y ofrece iniciar sesión', () => {
    enlaceValido('recuperacion');
    escribir('#clave', 'MiClaveLarga1');
    escribir('#confirma', 'MiClaveLarga1');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement).click();
    http.expectOne(`${BASE}/auth/activacion/${TOKEN}`).flush({ ok: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('quedó registrada');
  });
});
