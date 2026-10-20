import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PbxService } from '../../core/pbx.service';
import { Llamada } from '../../core/models';
import { CtiColaComponent } from './cti-cola';

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

describe('CtiColaComponent', () => {
  let fixture: ComponentFixture<CtiColaComponent>;
  let llamadas: ReturnType<typeof signal<Llamada[]>>;
  let enVivo: ReturnType<typeof signal<boolean>>;

  function texto(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function filas(): NodeListOf<Element> {
    return (fixture.nativeElement as HTMLElement).querySelectorAll('.cola-fila');
  }

  beforeEach(() => {
    llamadas = signal<Llamada[]>([]);
    enVivo = signal(true);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: PbxService,
          useValue: {
            llamadas,
            enVivo,
            sonidoActivo: signal(true),
            canalEsperado: signal(true),
            alternarSonido: () => undefined,
          },
        },
      ],
    });

    fixture = TestBed.createComponent(CtiColaComponent);
    fixture.detectChanges();
  });

  it('la que más ha esperado va primero', () => {
    const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    llamadas.set([
      llamada({ id: 'nueva', numero: '3009999999', creadoEn: hace(1) }),
      llamada({ id: 'vieja', numero: '3001111111', creadoEn: hace(9) }),
    ]);
    fixture.detectChanges();

    expect(filas().length).toBe(2);
    expect(filas()[0].textContent).toContain('3001111111');
  });

  it('dice cuánto lleva esperando, no solo cuántas hay', () => {
    // Un contador dice «2 en cola» y con eso no se decide nada: no dice si el
    // primero lleva seis segundos o seis minutos.
    llamadas.set([llamada({ creadoEn: new Date(Date.now() - 125_000).toISOString() })]);
    fixture.detectChanges();

    // Al minuto y no al segundo: `ahora` se fija al construir.
    expect(texto()).toMatch(/02:0\d/);
    expect(texto()).not.toContain('00:00');
  });

  it('solo cuenta las que están timbrando', () => {
    llamadas.set([
      llamada({ id: 'a', estado: 'sonando' }),
      llamada({ id: 'b', estado: 'finalizada' }),
    ]);
    fixture.detectChanges();
    expect(filas().length).toBe(1);
  });

  it('tomar una llamada la entrega a la pantalla, no la resuelve aquí', () => {
    llamadas.set([llamada({ id: 'l-7' })]);
    fixture.detectChanges();

    let tomada: Llamada | undefined;
    fixture.componentInstance.tomar.subscribe((x) => (tomada = x));
    ((fixture.nativeElement as HTMLElement).querySelector('.cola-tomar') as HTMLButtonElement).click();

    expect(tomada?.id).toBe('l-7');
  });

  it('lo que no es un abonado no se enseña como si lo fuera', () => {
    // Para los contactos de WhatsApp la central manda un identificador de
    // sesión. Enseñarlo en grande como «el número» invita a marcarlo.
    llamadas.set([llamada({ numero: '+CO.1744934636794102' })]);
    fixture.detectChanges();
    expect(texto()).toContain('Sin número');
  });

  it('una cola vacía con el canal caído NO dice «no hay llamadas»', () => {
    // Dice «dejé de enterarme», que es otra cosa.
    enVivo.set(false);
    fixture.detectChanges();
    expect(texto()).toContain('Sin conexión en vivo');
  });
});
