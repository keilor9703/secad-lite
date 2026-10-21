import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BotonLlamarComponent } from './boton-llamar';
import { AuthService } from '../../core/auth.service';
import { CapacidadesPbx, PbxService } from '../../core/pbx.service';

/**
 * El botón de llamar desde el caso.
 *
 * Lo que se protege es CUÁNDO NO aparece. Un botón que no puede funcionar es
 * peor que ninguno: en una sala de despacho, el operador lo aprieta en medio
 * de una emergencia y se queda mirando un error.
 */
describe('BotonLlamarComponent', () => {
  let marcar: jasmine.Spy;
  let capacidades: CapacidadesPbx | null;
  let permisos: string[];
  let integraciones: string[];
  /** La extensión del usuario; nula = no atiende por PBX. */
  let extension: string | null;

  function crear(numero: string | null = '3001234567'): BotonLlamarComponent {
    marcar = jasmine.createSpy('marcar').and.returnValue(of({ ok: true, mensaje: 'Va a timbrar su extensión 102.', extension: '102' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PbxService,
          useValue: {
            marcar,
            puede: (c: string) => !!capacidades?.activo && capacidades.capacidades.includes(c as never),
          },
        },
        {
          provide: AuthService,
          useValue: {
            tienePermiso: (p: string) => permisos.includes(p),
            tieneIntegracion: (i: string) => integraciones.includes(i),
            sesion: () => ({ usuario: 'u', nombre: 'U', extension }),
          },
        },
      ],
    });
    const f = TestBed.createComponent(BotonLlamarComponent);
    f.componentRef.setInput('numero', numero);
    f.detectChanges();
    return f.componentInstance;
  }

  beforeEach(() => {
    permisos = ['pbx.usar'];
    integraciones = ['pbx'];
    extension = '102';
    capacidades = { proveedor: 'ZADARMA', nombre: 'Zadarma', activo: true, capacidades: ['entrantes', 'marcar'] };
  });

  it('con todo en su sitio, se dibuja', () => {
    expect(crear().visible()).toBeTrue();
  });

  describe('no se dibuja', () => {
    it('si el usuario NO tiene extensión', () => {
      // El caso del despachador: la planta timbra PRIMERO al operador y
      // después al ciudadano, así que sin extensión no hay llamada posible —
      // ni con softphone, que necesita la misma cuenta SIP. Antes apretaba el
      // botón y solo entonces se enteraba, en mitad de una emergencia.
      extension = null;
      expect(crear().visible()).toBeFalse();
    });

    it('si la extensión está en blanco', () => {
      extension = '   ';
      expect(crear().visible()).toBeFalse();
    });

    it('si la instancia no contrató la planta telefónica', () => {
      integraciones = [];
      expect(crear().visible()).toBeFalse();
    });

    it('si el operador no puede atender llamadas', () => {
      permisos = [];
      expect(crear().visible()).toBeFalse();
    });

    it('si la planta de esa instancia NO sabe originar llamadas', () => {
      // Es el caso de YACO: la llamada la controla su plataforma y FALCON no
      // tiene por dónde pedirla.
      capacidades = { proveedor: 'YACO', nombre: 'YACO', activo: true, capacidades: ['entrantes'] };
      expect(crear().visible()).toBeFalse();
    });

    it('si la planta está apagada', () => {
      capacidades = { proveedor: 'ZADARMA', nombre: 'Zadarma', activo: false, capacidades: ['entrantes', 'marcar'] };
      expect(crear().visible()).toBeFalse();
    });

    it('mientras no se sepa qué puede la planta: callarse es mejor que prometer', () => {
      capacidades = null;
      expect(crear().visible()).toBeFalse();
    });

    it('si lo que hay no es un número marcable', () => {
      // La central manda esto para los contactos de WhatsApp: parece un
      // número y no lo es.
      expect(crear('+CO.1744934636794102').visible()).toBeFalse();
      expect(crear('').visible()).toBeFalse();
      expect(crear(null).visible()).toBeFalse();
    });
  });

  describe('al llamar', () => {
    it('dice qué va a pasar, con la extensión que va a timbrar', () => {
      // Sin esto, el operador aprieta y no entiende por qué suena su propio
      // teléfono en vez del del ciudadano.
      const c = crear();
      c.llamar();

      expect(marcar).toHaveBeenCalledOnceWith('3001234567', undefined);
      expect(c.ok()).toBeTrue();
      expect(c.aviso()).toContain('102');
      expect(c.llamando()).toBeFalse();
    });

    it('un doble clic no pide dos llamadas', () => {
      // Cada una se factura.
      const c = crear();
      marcar.and.returnValue({ subscribe: () => undefined });

      c.llamar();
      c.llamar();

      expect(marcar).toHaveBeenCalledTimes(1);
    });

    it('el motivo del servidor se muestra tal cual: sin saldo, credenciales, central caída', () => {
      const c = crear();
      marcar.and.returnValue(of({ ok: false, mensaje: 'Zadarma no pudo originar la llamada: Not enough money on the balance' }));

      c.llamar();

      expect(c.ok()).toBeFalse();
      expect(c.aviso()).toContain('Not enough money');
    });

    it('y un error de red tampoco deja el botón girando', () => {
      const c = crear();
      marcar.and.returnValue(throwError(() => ({ error: { message: 'Su usuario no tiene extensión asignada.' } })));

      c.llamar();

      expect(c.llamando()).toBeFalse();
      expect(c.aviso()).toContain('extensión');
    });
  });
});
