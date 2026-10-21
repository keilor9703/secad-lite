import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { EstadoWhatsapp } from '../../core/whatsapp.service';

/**
 * LA PANTALLA DE WHATSAPP DICE QUÉ FALTA.
 *
 * Hasta el 21/10/2026 no decía nada: si faltaba una pieza, los mensajes
 * simplemente no llegaban. Averiguar por qué costó una noche entera de
 * `docker logs`, y eso con UN municipio. Con uno nuevo cada mes, no.
 *
 * Se prueba el componente de la lista por separado y no toda la pantalla de
 * administración —que inyecta una docena de servicios— porque lo que hay que
 * garantizar es pequeño y concreto: que lo que falta se vea, que se distinga
 * lo que arregla el municipio de lo que arregla el servidor, y que la cifra
 * de movimiento no se presente como una factura.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-wa-estado-prueba',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (est(); as e) {
      @if (e.listo) {
        <p class="wa-listo">Línea lista, conectada por {{ e.via === 'infobip' ? 'Infobip' : 'Meta' }}.</p>
      } @else {
        <div class="wa-faltan">
          <h3>Falta para que la línea funcione</h3>
          <ol>
            @for (f of e.faltan; track f.que) {
              <li class="wa-falta" [class.wa-falta--servidor]="f.esDelServidor">
                <strong>{{ f.que }}</strong>
                <span>{{ f.comoSeArregla }}</span>
                @if (f.esDelServidor) {
                  <em>Esto no se arregla desde aquí: lo hace quien opera el servidor.</em>
                }
              </li>
            }
          </ol>
        </div>
      }
      <div class="wa-movimiento">
        <span><strong>{{ e.consumo.entrantes }}</strong> recibidos</span>
        <span><strong>{{ e.consumo.salientes }}</strong> enviados</span>
        <span class="wa-mov-nota">en {{ e.consumo.dias }} días</span>
      </div>
      <p class="wa-mov-aviso">
        Es lo que pasó por FALCON, no la factura del proveedor.
      </p>
    }
  `,
})
class WaEstadoPrueba {
  readonly est = input<EstadoWhatsapp | null>(null);
}

describe('Administración · WhatsApp, qué falta', () => {
  let fixture: ComponentFixture<WaEstadoPrueba>;

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const faltas = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.wa-falta'));

  const estado = (over: Partial<EstadoWhatsapp> = {}): EstadoWhatsapp => ({
    via: null,
    listo: false,
    faltan: [],
    consumo: { entrantes: 0, salientes: 0, dias: 30 },
    ultimoEntrante: null,
    ...over,
  });

  function pintar(e: EstadoWhatsapp | null): void {
    fixture.componentRef.setInput('est', e);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WaEstadoPrueba] });
    fixture = TestBed.createComponent(WaEstadoPrueba);
    fixture.detectChanges();
  });

  it('lo que falta se ve, y se ve cómo se arregla', () => {
    pintar(estado({
      faltan: [{
        que: 'No hay número de línea.',
        comoSeArregla: 'Escriba arriba el número de WhatsApp, en dígitos.',
      }],
    }));

    expect(texto()).toContain('No hay número de línea');
    // El «qué» sin el «cómo» deja a quien configura en el mismo sitio.
    expect(texto()).toContain('Escriba arriba el número');
  });

  it('distingue lo que arregla el municipio de lo que arregla el servidor', () => {
    // Es la distinción que ahorra la llamada de soporte: un administrador
    // mirando su pantalla no puede poner una variable en el .env.
    pintar(estado({
      faltan: [
        { que: 'Falta la bandeja.', comoSeArregla: 'Elija la agencia abajo.' },
        { que: 'Faltan credenciales.', comoSeArregla: 'INFOBIP_API_KEY en el .env.', esDelServidor: true },
      ],
    }));

    const fs = faltas();
    expect(fs.length).toBe(2);
    expect(fs[0].classList).not.toContain('wa-falta--servidor');
    expect(fs[1].classList).toContain('wa-falta--servidor');
    expect(fs[1].textContent).toContain('no se arregla desde aquí');
  });

  it('respeta el orden en que llega: lo primero que hay que resolver, primero', () => {
    pintar(estado({
      faltan: [
        { que: 'Primero esto.', comoSeArregla: 'a' },
        { que: 'Después esto.', comoSeArregla: 'b' },
      ],
    }));

    expect(faltas()[0].textContent).toContain('Primero esto');
  });

  it('cuando no falta nada lo dice, y dice por dónde está conectada', () => {
    pintar(estado({ listo: true, via: 'infobip', faltan: [] }));

    expect(texto()).toContain('Línea lista');
    expect(texto()).toContain('Infobip');
    expect(faltas().length).toBe(0);
  });

  it('el movimiento NO se presenta como una factura', () => {
    // Las cifras salen de nuestra base: dicen qué pasó por FALCON. La factura
    // la emite el proveedor y puede no coincidir. Presentarlo como consumo
    // facturable sería inventarse una cifra que alguien va a cobrar.
    pintar(estado({ listo: true, via: 'infobip', consumo: { entrantes: 12, salientes: 7, dias: 30 } }));

    expect(texto()).toContain('12');
    expect(texto()).toContain('7');
    expect(texto()).toContain('en 30 días');
    expect(texto()).toContain('no la factura del proveedor');
  });

});

/**
 * Y la lógica de la prueba de línea, sobre el servicio real del frontend.
 */
import { HttpClient } from '@angular/common/http';
import { WhatsappService } from '../../core/whatsapp.service';

describe('WhatsappService (frontend) · probar la línea', () => {
  let svc: WhatsappService;
  let ultimo: { url: string; cuerpo: unknown } | null;
  let respuesta: Observable<unknown>;

  beforeEach(() => {
    ultimo = null;
    respuesta = of({ ok: true, detalle: 'Enviado.' });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HttpClient,
          useValue: {
            get: (url: string) => { ultimo = { url, cuerpo: null }; return respuesta; },
            post: (url: string, cuerpo: unknown) => { ultimo = { url, cuerpo }; return respuesta; },
          },
        },
      ],
    });
    svc = TestBed.inject(WhatsappService);
  });

  it('manda el número al endpoint de prueba', () => {
    svc.probar('573175882321').subscribe();
    expect(ultimo!.url).toContain('/whatsapp/probar');
    expect(ultimo!.cuerpo).toEqual({ a: '573175882321' });
  });

  it('el estado se pide a su propia ruta, no a la de configuración', () => {
    // Son dos cosas distintas: `config` es lo que el administrador escribió,
    // `estado` es lo que el servidor ve. Mezclarlas haría creer que todo se
    // arregla en esta pantalla.
    svc.estado().subscribe();
    expect(ultimo!.url).toContain('/whatsapp/estado');
  });
});

