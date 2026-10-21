import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { Caso } from '../../core/models';
import { CasosService } from '../../core/casos.service';
import { CasosWsService } from '../../core/casos-ws.service';
import { CatalogosService } from '../../core/catalogos.service';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ToastService } from '../../shared/toast/toast.service';
import { DespachoComponent } from './despacho';

/**
 * LOS MENSAJES QUE ENTRAN A UN CASO QUE YA ESTÁ EN EL TABLERO.
 *
 * El defecto real del 21/10/2026: un ciudadano escribió seis veces seguidas
 * por WhatsApp y en Despacho no cambió nada. Una conversación es UNA
 * emergencia, así que los seis mensajes entraron al mismo caso —eso está
 * bien—, pero la fila seguía diciendo lo que dijo el primero, con su misma
 * antigüedad, y el hilo solo existía para quien abriera el caso.
 *
 * En una prueba eso es confusión. En turno es un «ya entró al cuarto de mi
 * hija» que llega a la base de datos y a nadie en pantalla.
 */
describe('DespachoComponent · mensajes sin leer', () => {
  let fixture: ComponentFixture<DespachoComponent>;
  let eventos: Subject<{ tipo: 'nuevo' | 'actualizado'; caso: Caso }>;
  let avisos: string[];
  let notificaciones: string[];
  let listados: Caso[];

  const CANAL = 'canal-1';

  /** Un caso de WhatsApp que ya está en la bandeja de este despachador. */
  const caso = (over: Partial<Caso> = {}): Caso =>
    ({
      id: 'caso-1',
      tenant: 'demo',
      canal: 'whatsapp',
      titulo: 'Incendio en la 50 con 70',
      descripcion: 'Incendio en la 50 con 70',
      ciudadano: 'Hader Paz',
      agencia: 'Policía Nacional',
      estado: 'nuevo',
      prioridad: 'media',
      creadoEn: new Date().toISOString(),
      canalesEstado: [{ canalId: CANAL, agenciaId: 'ag-1', estado: 'nuevo' }],
      ...over,
    }) as unknown as Caso;

  beforeEach(() => {
    eventos = new Subject();
    avisos = [];
    notificaciones = [];
    listados = [];

    TestBed.configureTestingModule({
      providers: [
        { provide: CasosService, useValue: { listar: () => of(listados) } },
        {
          provide: CatalogosService,
          useValue: {
            canales: () => of([{ id: CANAL, codigo: 'C1', nombre: 'Paladares', agenciaId: 'ag-1' }]),
            agencias: () => of([{ id: 'ag-1', nombre: 'Policía Nacional' }]),
          },
        },
        {
          provide: AuthService,
          useValue: {
            // `canales[0]` es lo que fija la bandeja que se está mirando.
            sesion: () => ({ usuario: 'despachador1', rol: 'operador', canales: [CANAL] }),
            tenantActivo: signal('demo'),
          },
        },
        // Router de verdad: la plantilla trae `routerLink`, y un doble sin
        // `createUrlTree` revienta al pintar la primera fila.
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } },
          },
        },
        { provide: ToastService, useValue: { info: (m: string) => avisos.push(m), error: () => undefined } },
        { provide: NotificacionesService, useValue: { notificar: (t: string) => notificaciones.push(t) } },
        { provide: CasosWsService, useValue: { conectar: () => undefined, eventos } },
      ],
    });

    fixture = TestBed.createComponent(DespachoComponent);
    fixture.detectChanges();
  });

  /** Pone el caso en el tablero como si hubiera llegado en la carga inicial. */
  function yaEnElTablero(c: Caso): void {
    eventos.next({ tipo: 'nuevo', caso: c });
    fixture.detectChanges();
    avisos.length = 0;
    notificaciones.length = 0;
  }

  describe('la insignia de la fila', () => {
    it('dice CUÁNTOS, no solo que hay algo', () => {
      // Si dijera «1» habiendo cinco, el operador abriría creyendo que hay un
      // mensaje nuevo y leería el último.
      expect(fixture.componentInstance.sinLeer(caso({ mensajesSinLeer: 5 }))).toBe(5);
    });

    it('sin mensajes nuevos no hay insignia', () => {
      expect(fixture.componentInstance.sinLeer(caso({ mensajesSinLeer: 0 }))).toBe(0);
    });

    it('un backend que todavía no manda el campo no pinta una insignia vacía', () => {
      // Durante un despliegue conviven réplicas viejas y nuevas.
      expect(fixture.componentInstance.sinLeer(caso())).toBe(0);
    });
  });

  describe('el caso nuevo se anuncia cuando llega', () => {
    // Reporte del 21/10/2026: «la notificación llega mucho después de que
    // llega el caso a la bandeja». La causa era que el aviso solo salía en
    // `cargar()`, que corre cada 60 segundos: la fila aparecía al instante
    // por el socket y el toast hasta un minuto más tarde.
    //
    // Un despachador que VE la fila antes de OÍR el aviso deja de fiarse del
    // aviso, y a partir de ahí hay que barrer la columna con la mirada, que
    // es justo lo que el aviso venía a evitar.

    it('el toast sale con el evento, no en la recarga del minuto', () => {
      // El tablero ya está cargado (el `beforeEach` hizo su primera carga).
      eventos.next({ tipo: 'nuevo', caso: caso({ id: 'caso-9', titulo: 'Riña en el parque' }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(1);
      expect(avisos[0]).toContain('Riña en el parque');
      expect(notificaciones.length).toBe(1);
    });

    it('el mismo caso no se anuncia dos veces', () => {
      // Llega por el socket y vuelve a llegar en la recarga. Un tablero que
      // avisa dos veces por caso es un tablero que se silencia.
      const c = caso({ id: 'caso-9' });
      eventos.next({ tipo: 'nuevo', caso: c });
      eventos.next({ tipo: 'nuevo', caso: c });
      eventos.next({ tipo: 'actualizado', caso: c });
      fixture.detectChanges();

      expect(avisos.length).toBe(1);
    });

    it('un «actualizado» de un caso que NO está en la bandeja no anuncia nada', () => {
      // Un caso que cambia en otro canal emite igual: el socket tiene una
      // sola sala por municipio y cada pantalla filtra lo suyo. Ese caso no
      // se agrega a esta bandeja —solo los `nuevo` entran—, así que
      // anunciarlo sería un aviso de algo que el despachador no puede ver en
      // ninguna columna.
      eventos.next({ tipo: 'actualizado', caso: caso({ id: 'caso-de-otro' }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(0);
    });

    it('un caso que solo cambia de estado NO se anuncia como nuevo', () => {
      yaEnElTablero(caso({ id: 'caso-9' }));

      eventos.next({ tipo: 'actualizado', caso: caso({ id: 'caso-9', estado: 'en_gestion' }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(0);
    });
  });

  describe('la fila pintada de verdad', () => {
    // Las pruebas de arriba comprueban el cálculo. Esta comprueba que el
    // número LLEGA A LA PANTALLA: un `sinLeer()` perfecto que nadie pinta
    // deja al despachador exactamente igual que antes.

    const insignia = () =>
      (fixture.nativeElement as HTMLElement).querySelector('.f-sinleer');

    it('la insignia aparece con el número encima de la fila', () => {
      eventos.next({ tipo: 'nuevo', caso: caso({ mensajesSinLeer: 4 }) });
      fixture.detectChanges();

      expect(insignia()).withContext('no se pintó la insignia').not.toBeNull();
      expect(insignia()!.textContent).toContain('4');
    });

    it('sin mensajes nuevos la fila va limpia', () => {
      // Primero que la fila EXISTE: si el tablero no pintara nada, la
      // negación de abajo pasaría sin comprobar nada.
      eventos.next({ tipo: 'nuevo', caso: caso({ mensajesSinLeer: 0 }) });
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.f-titulo'))
        .withContext('la fila del caso ni se pintó').not.toBeNull();
      expect(insignia()).toBeNull();
    });
  });

  describe('el aviso en vivo', () => {
    it('un mensaje nuevo se anuncia en el momento', () => {
      yaEnElTablero(caso({ mensajesSinLeer: 0 }));

      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 1 }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(1);
      expect(avisos[0]).toContain('Incendio en la 50 con 70');
      expect(notificaciones.length).toBe(1);
    });

    it('el mismo estado repetido NO vuelve a sonar', () => {
      // El mismo cambio llega por el socket y otra vez en la recarga del
      // minuto. Un tablero que suena dos veces por cada mensaje es un tablero
      // que el despachador acaba silenciando, y entonces no sirve para nada.
      yaEnElTablero(caso({ mensajesSinLeer: 0 }));

      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 2 }) });
      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 2 }) });
      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 2 }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(1);
    });

    it('cada mensaje siguiente SÍ vuelve a avisar', () => {
      // La negación de arriba tiene que poder fallar: si el aviso se hubiera
      // roto del todo, aquella prueba pasaría igual con cero avisos.
      yaEnElTablero(caso({ mensajesSinLeer: 0 }));

      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 1 }) });
      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 2 }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(2);
    });

    it('un caso que se ve por primera vez no anuncia SUS mensajes', () => {
      // Al entrar a la pantalla —o al recuperarse de una desconexión— el
      // despachador se encontraría con una ráfaga de avisos de conversaciones
      // que llevan ahí media hora. Para eso está la insignia de la fila.
      //
      // El caso en sí SÍ se anuncia, y debe: es un caso nuevo en la cola. Lo
      // que no puede sonar es «mensaje nuevo» por lo que ya venía dentro.
      eventos.next({ tipo: 'nuevo', caso: caso({ mensajesSinLeer: 7 }) });
      fixture.detectChanges();

      expect(avisos.filter((a) => a.includes('Mensaje nuevo')).length).toBe(0);
      // Y que no sea una negación vacía: algo sí se anunció.
      expect(avisos.length).toBe(1);
      expect(avisos[0]).toContain('Caso nuevo');
    });

    it('abrir el caso apaga la insignia sin anunciar nada', () => {
      // El contador baja a cero cuando el operador lee. Eso NO es un mensaje
      // nuevo y no puede sonar.
      yaEnElTablero(caso({ mensajesSinLeer: 3 }));

      eventos.next({ tipo: 'actualizado', caso: caso({ mensajesSinLeer: 0 }) });
      fixture.detectChanges();

      expect(avisos.length).toBe(0);
    });
  });
});
