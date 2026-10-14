import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { BalizaService } from './baliza.service';
import { AuthService } from './auth.service';
import { PbxService } from './pbx.service';
import { CasosWsService } from './casos-ws.service';
import { Caso } from './models';

/**
 * La baliza de la barra superior.
 *
 * Lo que se prueba aquí no es que se encienda —eso se ve— sino las tres reglas
 * que no se ven y que, si se rompen, dejan a alguien sin aviso:
 *
 *  1. Manda el estado de MI canal, no el del caso. Un caso que la Policía ya
 *     despachó sigue sin tomar en la bandeja de Bomberos.
 *  2. Se apaga cuando lo toman, no cuando se cierra el caso.
 *  3. No se enciende por el atraso que ya estaba: solo por lo que LLEGA.
 */
describe('BalizaService', () => {
  let eventos$: Subject<{ tipo: 'nuevo' | 'actualizado'; caso: Caso }>;
  let sonando: ReturnType<typeof signal<unknown[]>>;
  let sesion: ReturnType<typeof signal<{ canales: string[] | null } | null>>;
  let conexiones: number;

  const caso = (id: string, estadoEnCanal: string | null, canal = 'mi-canal'): Caso => ({
    id, tenant: 'itagui', canal: 'telefono', titulo: `Caso ${id}`, descripcion: '',
    ciudadano: 'Alguien', agencia: 'Policía', estado: 'nuevo',
    canalesEstado: estadoEnCanal === null ? [] : [{ canalId: canal, agenciaId: 'a1', estado: estadoEnCanal }],
    creadoPor: 'op', creadoEn: '', actualizadoEn: '',
  } as unknown as Caso);

  beforeEach(() => {
    eventos$ = new Subject();
    sonando = signal<unknown[]>([]);
    sesion = signal<{ canales: string[] | null } | null>({ canales: ['mi-canal'] });
    conexiones = 0;
    TestBed.configureTestingModule({
      providers: [
        BalizaService,
        { provide: AuthService, useValue: { sesion } },
        { provide: PbxService, useValue: { sonando } },
        { provide: CasosWsService, useValue: { conectar: () => conexiones++, eventos: eventos$.asObservable() } },
      ],
    });
  });

  const servicio = () => TestBed.inject(BalizaService);

  it('apagada mientras no pasa nada', () => {
    const s = servicio(); s.iniciar();
    expect(s.activa()).toBeFalse();
    expect(s.motivo()).toBeNull();
    expect(s.anuncio()).toBe('');
  });

  it('se enciende con una llamada timbrando y se apaga cuando la toman', () => {
    const s = servicio(); s.iniciar();
    sonando.set([{ id: 'l1' }]);
    expect(s.activa()).toBeTrue();
    expect(s.motivo()).toBe('llamada');
    expect(s.anuncio()).toBe('Atención: una llamada en espera.');
    sonando.set([]);
    expect(s.activa()).toBeFalse();
  });

  it('se enciende con un caso que llega a mi bandeja', () => {
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    expect(s.casosSinTomar()).toBe(1);
    expect(s.motivo()).toBe('caso');
    expect(s.anuncio()).toBe('Atención: un caso nuevo sin tomar.');
  });

  it('se apaga cuando TOMAN el caso, no cuando lo cierran', () => {
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    expect(s.activa()).toBeTrue();
    eventos$.next({ tipo: 'actualizado', caso: caso('c1', 'en_gestion') });
    expect(s.activa()).withContext('en cuanto alguien lo toma, deja de pedir atención').toBeFalse();
  });

  it('manda el estado de MI canal, no el del caso', () => {
    const s = servicio(); s.iniciar();
    // La Policía ya lo despachó (caso.estado), pero en mi canal sigue sin tomar.
    const c = caso('c1', 'nuevo');
    (c as { estado: string }).estado = 'despachado';
    eventos$.next({ tipo: 'nuevo', caso: c });
    expect(s.casosSinTomar()).toBe(1, 'mi bandeja sigue esperando aunque otra entidad ya despachó');
  });

  it('ignora lo que llega a OTRO canal', () => {
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo', 'canal-ajeno') });
    expect(s.activa()).toBeFalse();
  });

  it('un «actualizado» de algo que nunca anunciamos no enciende nada', () => {
    const s = servicio(); s.iniciar();
    // Esto es el atraso que ya estaba cuando se abrió la aplicación: el socket
    // emite su cambio, pero la baliza es para lo que LLEGA.
    eventos$.next({ tipo: 'actualizado', caso: caso('viejo', 'nuevo') });
    expect(s.activa()).toBeFalse();
  });

  it('no cuenta dos veces el mismo caso', () => {
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    eventos$.next({ tipo: 'actualizado', caso: caso('c1', 'nuevo') });
    expect(s.casosSinTomar()).toBe(1);
  });

  it('cuenta varios y lo dice en plural', () => {
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    eventos$.next({ tipo: 'nuevo', caso: caso('c2', 'nuevo') });
    sonando.set([{ id: 'l1' }, { id: 'l2' }]);
    expect(s.motivo()).toBe('ambos');
    expect(s.anuncio()).toBe('Atención: 2 llamadas en espera y 2 casos nuevos sin tomar.');
  });

  it('sin canal propio no sigue casos NI abre el socket (un administrador que no despacha)', () => {
    sesion.set({ canales: [] });
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    expect(s.casosSinTomar()).toBe(0);
    expect(conexiones).toBe(0, 'no tiene sentido mantener una conexión en vivo que nunca recibirá nada');
    // Las llamadas sí le siguen llegando: no dependen del socket de casos.
    sonando.set([{ id: 'l1' }]);
    expect(s.activa()).toBeTrue();
  });

  it('un caso sin bandejas por canal usa el estado del propio caso', () => {
    const s = servicio(); s.iniciar();
    const c = caso('c1', null);
    (c as { canalesEstado?: unknown }).canalesEstado = undefined;
    eventos$.next({ tipo: 'nuevo', caso: c });
    expect(s.casosSinTomar()).toBe(1);
  });

  it('cambiar de instancia no arrastra lo pendiente de la anterior', () => {
    const s = servicio(); s.iniciar();
    eventos$.next({ tipo: 'nuevo', caso: caso('c1', 'nuevo') });
    expect(s.activa()).toBeTrue();
    s.limpiar();
    expect(s.activa()).toBeFalse();
  });

  it('iniciar() es idempotente: no abre el socket dos veces', () => {
    const s = servicio();
    s.iniciar(); s.iniciar(); s.iniciar();
    expect(conexiones).toBe(1);
  });
});
