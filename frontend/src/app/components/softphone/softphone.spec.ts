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
  let companeros: ReturnType<typeof signal<{ extension: string; nombre: string }[]>>;
  let transferir: jasmine.Spy;
  let disponible: ReturnType<typeof signal<boolean>>;
  let contestando: ReturnType<typeof signal<boolean>>;
  let contestar: jasmine.Spy;

  function montar(): ComponentFixture<SoftphoneComponent> {
    entrante = signal<LlamadaSip | null>(null);
    enCurso = signal<LlamadaSip | null>(null);
    estado = signal('registrado');
    companeros = signal<{ extension: string; nombre: string }[]>([]);
    transferir = jasmine.createSpy('transferir').and.resolveTo(true);
    disponible = signal(true);
    contestando = signal(false);
    contestar = jasmine.createSpy('contestar');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SoftphoneService,
          useValue: {
            disponible, estado, entrante, enCurso, contestar, contestando,
            motivo: signal(''), avisoCola: signal(''), silenciado: signal(false),
            sinAudioRemoto: signal(false), extension: signal('102'),
            esMiSaliente: signal(false), destinoSaliente: signal(''),
            companeros, transfiriendo: signal(false), transferir,
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
    const disp = signal(false);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SoftphoneService,
          useValue: {
            disponible: disp, estado: signal('registrado'),
            entrante: signal(null), enCurso: signal(null), contestando: signal(false),
            motivo: signal(''), avisoCola: signal(''), silenciado: signal(false),
            sinAudioRemoto: signal(false), extension: signal('102'),
            esMiSaliente: signal(false), destinoSaliente: signal(''),
            encender: () => undefined, apagar: () => undefined, colgar: () => undefined,
            contestar: () => undefined, alternarSilencio: () => undefined,
            usarAudio: (el: HTMLAudioElement) => entregados.push(el),
          },
        },
      ],
    });
    const f = TestBed.createComponent(SoftphoneComponent);
    f.detectChanges();

    // Así llega en producción: las capacidades vienen de la API, de modo que en
    // el primer render la barra no existe todavía y no hay elemento que
    // entregar. Esto es lo que dejaba la pila SIP sin dónde poner el audio.
    expect(entregados.length).toBe(0);

    disp.set(true);
    f.detectChanges();

    expect(entregados.length).toBe(1);
    expect(entregados[0].tagName).toBe('AUDIO');
    expect(entregados[0].autoplay).toBeTrue();

    // Y no se entrega dos veces: cada entrega vuelve a enganchar el flujo.
    f.detectChanges();
    expect(entregados.length).toBe(1);
  });
  /**
   * EL CLIC TIENE QUE VERSE AL INSTANTE.
   *
   * Contestar tarda lo que el navegador tarde en recolectar candidatos ICE.
   * Antes, en ese rato la barra se quedaba idéntica —«Entra una llamada» y el
   * botón «Contestar» intacto—, así que el operador volvía a oprimir creyendo
   * que su clic no había entrado.
   */
  describe('mientras se contesta', () => {
    it('lo dice, y el botón deja de invitar a oprimirlo otra vez', () => {
      const f = montar();
      entrante.set({ numero: '3001234567' });
      f.componentInstance.abierta.set(true);
      contestando.set(true);
      f.detectChanges();

      const txt: string = f.nativeElement.textContent;
      expect(txt).toContain('Contestando');
      expect(txt).toContain('conectando el audio');

      const botones: HTMLButtonElement[] = Array.from(f.nativeElement.querySelectorAll('.sp-acc button'));
      const contestarBtn = botones.find((b) => (b.textContent ?? '').includes('Conectando'))!;
      expect(contestarBtn).toBeTruthy();
      expect(contestarBtn.disabled).toBe(true);
    });

    it('«Rechazar» SIGUE habilitado: si el audio no conecta, colgar es la salida', () => {
      const f = montar();
      entrante.set({ numero: '3001234567' });
      f.componentInstance.abierta.set(true);
      contestando.set(true);
      f.detectChanges();

      const botones: HTMLButtonElement[] = Array.from(f.nativeElement.querySelectorAll('.sp-acc button'));
      const rechazar = botones.find((b) => (b.textContent ?? '').includes('Rechazar'))!;
      expect(rechazar.disabled).toBe(false);
    });

    it('la barra deja de timbrar: a esta altura ya nadie tiene que correr', () => {
      const f = montar();
      entrante.set({ numero: '3001234567' });
      f.detectChanges();
      expect(f.nativeElement.querySelector('.sp--sonando')).toBeTruthy();

      contestando.set(true);
      f.detectChanges();
      expect(f.nativeElement.querySelector('.sp--sonando')).toBeNull();
      expect(f.nativeElement.querySelector('.sp--contestando')).toBeTruthy();
    });

    it('y plegada, el rótulo dice en qué va', () => {
      const f = montar();
      entrante.set({ numero: '3001234567' });
      contestando.set(true);
      f.detectChanges();
      expect(f.componentInstance.rotulo()).toContain('Contestando');
    });
  });

  describe('pasar la llamada a un compañero', () => {
    const enLlamada = () => {
      const f = montar();
      enCurso.set({ numero: '3001234567' });
      companeros.set([
        { extension: '102', nombre: 'Beto' },
        { extension: '103', nombre: 'Carla' },
      ]);
      f.detectChanges();
      return f;
    };

    it('sin compañeros no ofrece el botón: no hay a quién pasarla', () => {
      const f = montar();
      enCurso.set({ numero: '3001234567' });
      companeros.set([]);
      f.detectChanges();
      const botones = [...f.nativeElement.querySelectorAll('button')]
        .map((b: HTMLElement) => b.textContent ?? '');
      expect(botones.some((t: string) => t.includes('Pasar a'))).toBe(false);
    });

    it('la lista aparece solo al pedirla, y trae a los compañeros', () => {
      const f = enLlamada();
      expect(f.nativeElement.querySelector('.sp-destinos')).toBeNull();
      f.componentInstance.alternarTransferir();
      f.detectChanges();
      const destinos = f.nativeElement.querySelectorAll('.sp-destino');
      expect(destinos.length).toBe(2);
      expect(destinos[0].textContent).toContain('Beto');
    });

    it('ADVIERTE antes de elegir, no después', () => {
      // Una vez oprimido, la llamada ya salió. Y dice lo que de verdad pasa
      // —vuelve a la cola— en vez de un «¿está seguro?» que nadie lee.
      const f = enLlamada();
      f.componentInstance.alternarTransferir();
      f.detectChanges();
      const aviso = f.nativeElement.querySelector('.sp-aviso').textContent;
      expect(aviso).toContain('de inmediato');
      expect(aviso).toContain('vuelve a la cola');
    });

    it('elegir transfiere y cierra la lista', () => {
      const f = enLlamada();
      f.componentInstance.alternarTransferir();
      f.detectChanges();
      f.nativeElement.querySelectorAll('.sp-destino')[1].click();
      expect(transferir).toHaveBeenCalledWith('103');
    });

    it('la lista se cierra aunque la transferencia falle', async () => {
      // Dejarla abierta invita a oprimir otra vez sobre una llamada que
      // quizá ya no existe.
      const f = enLlamada();
      transferir.and.resolveTo(false);
      f.componentInstance.alternarTransferir();
      await f.componentInstance.pasarA('102');
      expect(f.componentInstance.eligiendoDestino()).toBe(false);
    });
  });
});
