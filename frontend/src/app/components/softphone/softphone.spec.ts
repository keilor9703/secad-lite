import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { SoftphoneComponent } from './softphone';
import { SoftphoneService } from '../../core/softphone/softphone.service';
import { LlamadaSip } from '../../core/softphone/transporte-sip';

/**
 * La barra del teléfono.
 *
 * Lo que se protege es la idea de la que nace: **plegada no estorba, y la
 * llamada la despliega sola**. Un panel permanente en una esquina es un
 * estorbo permanente —en Recepción tapaba el mapa— y una barra que hay que ir
 * a abrir a mano con el ciudadano esperando no sirve de nada.
 */
describe('SoftphoneComponent', () => {
  let entrante: ReturnType<typeof signal<LlamadaSip | null>>;
  let enCurso: ReturnType<typeof signal<LlamadaSip | null>>;
  let estado: ReturnType<typeof signal<string>>;
  let disponible: ReturnType<typeof signal<boolean>>;
  let contestar: jasmine.Spy;

  function montar(): ComponentFixture<SoftphoneComponent> {
    entrante = signal<LlamadaSip | null>(null);
    enCurso = signal<LlamadaSip | null>(null);
    estado = signal('registrado');
    disponible = signal(true);
    contestar = jasmine.createSpy('contestar');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SoftphoneService,
          useValue: {
            disponible, estado, entrante, enCurso, contestar,
            motivo: signal(''), avisoCola: signal(''), silenciado: signal(false),
            extension: signal('102'),
            encender: () => undefined, apagar: () => undefined,
            colgar: () => undefined, alternarSilencio: () => undefined,
            usarAudio: () => undefined,
          },
        },
      ],
    });
    const f = TestBed.createComponent(SoftphoneComponent);
    f.detectChanges();
    return f;
  }

  const texto = (f: ComponentFixture<SoftphoneComponent>) =>
    (f.nativeElement as HTMLElement).textContent ?? '';
  const barra = (f: ComponentFixture<SoftphoneComponent>) =>
    (f.nativeElement as HTMLElement).querySelector('.sp');

  afterEach(() => localStorage.removeItem('falconcad_softphone_pos'));

  it('en reposo está plegada: solo el icono, sin botones', () => {
    const f = montar();
    expect(f.componentInstance.abierta()).toBeFalse();
    expect(texto(f)).not.toContain('Apagar');
  });

  it('no se dibuja donde la planta no da softphone', () => {
    const f = montar();
    disponible.set(false);
    f.detectChanges();
    expect(barra(f)).toBeNull();
  });

  describe('la llamada la despliega sola', () => {
    it('al entrar una llamada se abre, con el número y los botones', () => {
      const f = montar();
      entrante.set({ numero: '3001234567' });
      f.detectChanges();

      expect(f.componentInstance.abierta()).toBeTrue();
      expect(texto(f)).toContain('3001234567');
      expect(texto(f)).toContain('Contestar');
    });

    it('y se marca para que se vea desde el otro lado de la sala', () => {
      const f = montar();
      entrante.set({ numero: '300' });
      f.detectChanges();
      expect(barra(f)?.classList).toContain('sp--sonando');
    });

    it('mientras dura la llamada NO se pliega', fakeAsync(() => {
      const f = montar();
      entrante.set({ numero: '300' });
      f.detectChanges();
      enCurso.set({ numero: '300' });
      entrante.set(null);
      f.detectChanges();

      tick(30_000);
      f.detectChanges();
      expect(f.componentInstance.abierta()).toBeTrue();
      // Y no deja un temporizador suelto al destruirse.
      f.destroy();
    }));

    it('al terminar se pliega sola, pero con un respiro para leer el aviso', fakeAsync(() => {
      const f = montar();
      enCurso.set({ numero: '300' });
      f.detectChanges();

      enCurso.set(null);
      f.detectChanges();
      tick(1000);
      f.detectChanges();
      expect(f.componentInstance.abierta()).toBeTrue();

      tick(6000);
      f.detectChanges();
      expect(f.componentInstance.abierta()).toBeFalse();
    }));
  });

  describe('abrirla a mano', () => {
    it('la deja abierta, sin que se pliegue sola', fakeAsync(() => {
      const f = montar();
      f.componentInstance.alternar();
      f.detectChanges();

      tick(30_000);
      f.detectChanges();
      expect(f.componentInstance.abierta()).toBeTrue();
      f.destroy();
    }));

    it('y cerrarla a mano devuelve el automatismo', fakeAsync(() => {
      const f = montar();
      f.componentInstance.alternar();   // abre y fija
      f.componentInstance.alternar();   // cierra y suelta

      enCurso.set({ numero: '300' });
      f.detectChanges();
      expect(f.componentInstance.abierta()).toBeTrue();

      enCurso.set(null);
      f.detectChanges();
      tick(7000);
      f.detectChanges();
      expect(f.componentInstance.abierta()).toBeFalse();
    }));
  });

  describe('arrastrar', () => {
    it('agarrar un BOTÓN no arrastra', () => {
      // Sin esto, «Contestar» se vuelve un arrastre de dos píxeles y la
      // llamada no se contesta — con el ciudadano al teléfono.
      const f = montar();
      entrante.set({ numero: '300' });
      f.detectChanges();

      const boton = (f.nativeElement as HTMLElement).querySelector('button')!;
      f.componentInstance.tomar({ target: boton, clientX: 10, clientY: 10 } as unknown as PointerEvent);

      expect(f.componentInstance.arrastrando()).toBeFalse();
    });

    it('agarrar la barra sí arrastra', () => {
      const f = montar();
      f.componentInstance.tomar({
        target: barra(f), clientX: 10, clientY: 10,
      } as unknown as PointerEvent);

      expect(f.componentInstance.arrastrando()).toBeTrue();
    });
  });

  it('el estado se dice con palabras, no solo con un color', () => {
    // Un punto de color no lo distingue todo el mundo, y «sin conexión» es
    // justo lo que hay que poder leer.
    const f = montar();
    f.componentInstance.alternar();
    estado.set('fallo');
    f.detectChanges();

    expect(texto(f)).toContain('sin conexión');
  });

  it('el elemento de audio se le entrega al servicio, que es donde engancha el audio', () => {
    // La primera versión de esta prueba comprobaba que el elemento no
    // estuviera oculto, y falló: el navegador oculta por su cuenta un
    // `<audio>` sin `controls` y no hay CSS que lo impida. Daba igual —un
    // elemento oculto reproduce lo mismo—, así que la prueba afirmaba algo
    // que no se podía sostener.
    //
    // Lo que SÍ rompe el audio es que la pila SIP no reciba el elemento: ahí
    // no hay dónde enganchar el audio remoto y la llamada se establece muda,
    // que es exactamente lo que se vio en producción.
    const entregados: HTMLAudioElement[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SoftphoneService,
          useValue: {
            disponible: signal(true), estado: signal('registrado'),
            entrante: signal(null), enCurso: signal(null),
            motivo: signal(''), avisoCola: signal(''), silenciado: signal(false),
            extension: signal('102'),
            encender: () => undefined, apagar: () => undefined, colgar: () => undefined,
            contestar: () => undefined, alternarSilencio: () => undefined,
            usarAudio: (el: HTMLAudioElement) => entregados.push(el),
          },
        },
      ],
    });
    const f = TestBed.createComponent(SoftphoneComponent);
    f.detectChanges();

    expect(entregados.length).toBe(1);
    expect(entregados[0].tagName).toBe('AUDIO');
    expect(entregados[0].autoplay).toBeTrue();
  });
});
