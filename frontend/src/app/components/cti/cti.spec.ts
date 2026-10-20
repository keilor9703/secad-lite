import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';
import { SoftphoneService } from '../../core/softphone/softphone.service';
import { Llamada } from '../../core/models';
import { CtiComponent } from './cti';

/** Una llamada de la cola, con lo justo para esta pantalla. */
const llamada = (over: Partial<Llamada> = {}): Llamada => ({
  id: 'l-1',
  tenant: 'demo',
  numero: '3001234567',
  origen: 'telefono',
  estado: 'sonando',
  creadoEn: new Date().toISOString(),
  actualizadoEn: new Date().toISOString(),
  ...over,
});

describe('CtiComponent', () => {
  let fixture: ComponentFixture<CtiComponent>;
  let sp: {
    estado: ReturnType<typeof signal<string>>;
    entrante: ReturnType<typeof signal<{ numero: string } | null>>;
    enCurso: ReturnType<typeof signal<{ numero: string } | null>>;
    enCursoDesde: ReturnType<typeof signal<number | null>>;
    esMiSaliente: ReturnType<typeof signal<boolean>>;
    destinoSaliente: ReturnType<typeof signal<string>>;
    [k: string]: unknown;
  };
  let llamadas: ReturnType<typeof signal<Llamada[]>>;
  let tonos: string[];
  let marcados: string[];

  function texto(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => {
    llamadas = signal<Llamada[]>([]);
    tonos = [];
    marcados = [];
    sp = {
      estado: signal('registrado'),
      entrante: signal<{ numero: string } | null>(null),
      enCurso: signal<{ numero: string } | null>(null),
      enCursoDesde: signal<number | null>(null),
      esMiSaliente: signal(false),
      destinoSaliente: signal(''),
      motivo: signal(''),
      avisoCola: signal(''),
      silenciado: signal(false),
      sinAudioRemoto: signal(false),
      contestando: signal(false),
      transfiriendo: signal(false),
      companeros: signal<{ extension: string; nombre: string }[]>([]),
      extension: signal('101'),
      pausadoDesde: signal<number | null>(null),
      pausar: () => { (sp['pausadoDesde'] as { set: (v: number) => void }).set(Date.now()); return Promise.resolve(); },
      reanudar: () => { (sp['pausadoDesde'] as { set: (v: null) => void }).set(null); return Promise.resolve(); },
      encender: () => Promise.resolve(),
      contestar: () => undefined,
      colgar: () => undefined,
      alternarSilencio: () => undefined,
      transferir: () => Promise.resolve(),
      usarAudio: () => undefined,
      tono: (t: string) => tonos.push(t),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: SoftphoneService, useValue: sp },
        {
          provide: PbxService,
          useValue: {
            llamadas,
            sonidoActivo: signal(true),
            enVivo: signal(true),
            canalEsperado: signal(true),
            alternarSonido: () => undefined,
            marcar: (n: string) => {
              marcados.push(n);
              return of({ ok: true, mensaje: 'Va a timbrar su extensión 101.' });
            },
          },
        },
        {
          provide: AuthService,
          useValue: { sesion: () => ({ usuario: 'pedro', nombre: 'Pedro Gómez' }) },
        },
      ],
    });

    fixture = TestBed.createComponent(CtiComponent);
    fixture.detectChanges();
  });

  describe('la saliente propia', () => {
    it('no se anuncia como una emergencia entrando', () => {
      sp.entrante.set({ numero: '101' });
      sp.esMiSaliente.set(true);
      sp.destinoSaliente.set('+573188069251');
      fixture.detectChanges();

      // Lo que NO puede decir: que entra una llamada. El operador acaba de
      // pedirla él mismo desde un caso.
      expect(texto()).toContain('Su llamada saliente');
      expect(texto()).not.toContain('Entra una llamada');
      expect(texto()).toContain('+573188069251');
    });

    it('ofrece desistir, no rechazar: no hay nada que rechazar', () => {
      sp.entrante.set({ numero: '101' });
      sp.esMiSaliente.set(true);
      fixture.detectChanges();

      expect(texto()).toContain('Descolgar');
      expect(texto()).toContain('Desistir');
      expect(texto()).not.toContain('Rechazar');
    });

    it('una emergencia de verdad SÍ se anuncia como tal', () => {
      // La negación de arriba tiene que poder fallar: si el camino normal se
      // rompiera, aquellas dos pruebas pasarían igual.
      sp.entrante.set({ numero: '3001234567' });
      sp.esMiSaliente.set(false);
      fixture.detectChanges();

      expect(texto()).toContain('Entra una llamada');
      expect(texto()).toContain('Rechazar');
      expect(texto()).toContain('3001234567');
    });
  });

  describe('la cola', () => {
    it('la que más ha esperado va primero', () => {
      const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
      llamadas.set([
        llamada({ id: 'nueva', numero: '3009999999', creadoEn: hace(1) }),
        llamada({ id: 'vieja', numero: '3001111111', creadoEn: hace(9) }),
      ]);
      fixture.detectChanges();

      const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('.cti-fila');
      expect(filas.length).toBe(2);
      expect(filas[0].textContent).toContain('3001111111');
    });

    it('dice cuánto lleva esperando, no solo cuántas hay', () => {
      // Un contador dice «2 en cola» y con eso no se decide nada: no dice si
      // el primero lleva seis segundos o seis minutos.
      llamadas.set([
        llamada({ creadoEn: new Date(Date.now() - 125_000).toISOString() }),
      ]);
      fixture.detectChanges();

      // Al minuto y no al segundo: `ahora` se fija al construir y la prueba
      // correría un segundo por detrás. Lo que se garantiza es que se cuenta
      // el tiempo, no que se cuente con precisión de reloj atómico.
      expect(texto()).toMatch(/02:0\d/);
      expect(texto()).not.toContain('00:00');
    });

    it('solo cuenta las que están timbrando', () => {
      llamadas.set([
        llamada({ id: 'a', estado: 'sonando' }),
        llamada({ id: 'b', estado: 'finalizada' }),
      ]);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.cti-fila').length,
      ).toBe(1);
    });

    it('tomar una llamada la entrega a la pantalla, no la resuelve aquí', () => {
      const l = llamada({ id: 'l-7' });
      llamadas.set([l]);
      fixture.detectChanges();

      let tomada: Llamada | undefined;
      fixture.componentInstance.tomar.subscribe((x) => (tomada = x));
      (
        (fixture.nativeElement as HTMLElement).querySelector('.cti-tomar') as HTMLButtonElement
      ).click();

      expect(tomada?.id).toBe('l-7');
    });

    it('lo que no es un abonado no se enseña como si lo fuera', () => {
      // Para los contactos de WhatsApp la central manda un identificador de
      // sesión. Enseñarlo en grande como «el número» invita a marcarlo.
      llamadas.set([llamada({ numero: '+CO.1744934636794102' })]);
      fixture.detectChanges();

      expect(texto()).toContain('Sin número');
    });
  });

  describe('el estado del puesto', () => {
    it('lo que está pasando ahora le gana a cómo está el registro', () => {
      // A alguien en llamada no le sirve leer «Disponible».
      expect(texto()).toContain('Disponible');

      sp.enCurso.set({ numero: '3001234567' });
      fixture.detectChanges();
      expect(texto()).toContain('En llamada');
      expect(texto()).not.toContain('Disponible');
    });

    it('un teléfono caído lo dice, no se queda callado', () => {
      sp.estado.set('fallo');
      fixture.detectChanges();
      expect(texto()).toContain('Sin teléfono');
    });
  });

  describe('salir a un descanso', () => {
    it('dar de baja el puesto se dice fuerte, y con cuánto lleva', async () => {
      // Un puesto en pausa que no se nota es un puesto que se queda en pausa
      // toda la tarde, con las llamadas cayendo sobre los compañeros.
      expect(texto()).not.toContain('No está recibiendo llamadas');

      (sp['pausadoDesde'] as { set: (v: number) => void }).set(Date.now() - 125_000);
      fixture.detectChanges();

      expect(texto()).toContain('No está recibiendo llamadas');
      expect(texto()).toMatch(/02:0\d/);
    });

    it('NO se puede salir con una llamada en curso: la cortaría', async () => {
      // Dar de baja el registro cierra el transporte. Quien se vaya, cuelga.
      sp.enCurso.set({ numero: '3001234567' });
      fixture.detectChanges();

      expect(fixture.componentInstance.puedeCambiarPausa()).toBe(false);
      fixture.componentInstance.alternarPausa();
      expect(fixture.componentInstance.pausado()).toBe(false);
    });

    it('sin llamada sí se puede, y se vuelve', () => {
      fixture.componentInstance.alternarPausa();
      expect(fixture.componentInstance.pausado()).toBe(true);
      fixture.componentInstance.alternarPausa();
      expect(fixture.componentInstance.pausado()).toBe(false);
    });
  });

  describe('el teclado', () => {
    it('en llamada manda tonos', () => {
      sp.enCurso.set({ numero: '3001234567' });
      fixture.detectChanges();
      fixture.componentInstance.alternarTeclado();
      fixture.detectChanges();

      fixture.componentInstance.tecla('5');
      expect(tonos).toEqual(['5']);
    });

    it('sin llamada arma un número y lo manda a la central', () => {
      fixture.componentInstance.alternarTeclado();
      '3001'.split('').forEach((t) => fixture.componentInstance.tecla(t));
      fixture.detectChanges();
      expect(fixture.componentInstance.marcado()).toBe('3001');

      fixture.componentInstance.llamarAlMarcado();
      expect(marcados).toEqual(['3001']);
      // Y el teclado queda limpio: si no, el siguiente dígito se pega al
      // número anterior y se marca cualquier cosa.
      expect(fixture.componentInstance.marcado()).toBe('');
      expect(tonos).toEqual([]);
    });

    it('no pide una llamada sin número', () => {
      fixture.componentInstance.llamarAlMarcado();
      expect(marcados).toEqual([]);
    });

    it('se puede escribir con el teclado del equipo, no solo con el ratón', () => {
      // Marcar diez dígitos uno por uno con el ratón es lento justo cuando no
      // se puede ir lento.
      const e = { target: { value: '3001234567' } } as unknown as Event;
      fixture.componentInstance.escribir(e);
      expect(fixture.componentInstance.marcado()).toBe('3001234567');
    });

    it('lo pegado se limpia: un número con adornos no se marca', () => {
      const campo = { value: '+57 (300) 123-45 67' };
      fixture.componentInstance.escribir({ target: campo } as unknown as Event);
      expect(fixture.componentInstance.marcado()).toBe('+573001234567');
      // Y el campo se reescribe con lo filtrado: si no, lo que se ve y lo que
      // se va a marcar dejan de ser lo mismo.
      expect(campo.value).toBe('+573001234567');
    });

    it('el «+» está disponible, que es lo que la troncal exige', () => {
      fixture.componentInstance.ponerMas();
      '57300'.split('').forEach((d) => fixture.componentInstance.tecla(d));
      expect(fixture.componentInstance.marcado()).toBe('+57300');
    });

    it('el «+» NO se manda como tono: no es DTMF', () => {
      sp.enCurso.set({ numero: '3001234567' });
      fixture.detectChanges();
      fixture.componentInstance.ponerMas();
      expect(tonos).toEqual([]);
      expect(fixture.componentInstance.marcado()).toBe('');
    });

    it('en llamada, las teclas físicas mandan tonos', () => {
      sp.enCurso.set({ numero: '3001234567' });
      fixture.detectChanges();

      const pulsar = (key: string) =>
        fixture.componentInstance.tonoFisico({
          key, preventDefault: () => undefined,
        } as KeyboardEvent);

      pulsar('4');
      pulsar('#');
      // Una letra no es un tono: el operador está escribiendo el caso.
      pulsar('a');
      expect(tonos).toEqual(['4', '#']);
      expect(fixture.componentInstance.tonosEnviados()).toBe('4#');
    });
  });
});
