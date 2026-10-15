import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import {
  AdminService, ConfigPbxGuardar, ConfigPbxVisible, ProveedorPbxVisible,
} from '../../core/admin.service';
import { ArchivadoService } from '../../core/archivado.service';
import { PlataformaComponent } from './plataforma';

/** El catálogo tal como lo devuelve el backend desde los descriptores. */
const PROVEEDORES: ProveedorPbxVisible[] = [
  {
    clave: 'YACO', nombre: 'YACO', resumen: 'La planta del proveedor del municipio.',
    capacidades: ['entrantes'], credenciales: [],
    rutaAviso: '/api/pbx/webhook',
  },
  {
    clave: 'ZADARMA', nombre: 'Zadarma', resumen: 'Centralita en la nube que operamos nosotros.',
    capacidades: ['entrantes'],
    credenciales: [
      { clave: 'key', etiqueta: 'Key de la API', ayuda: 'Integraciones y API → Claves y API.', secreto: false, requerido: true, forma: '^[A-Za-z0-9]{20}$', ejemplo: 'a1b2c3d4e5f6a7b8c9d0' },
      { clave: 'secreto', etiqueta: 'Secret de la API', ayuda: 'Al lado de la Key.', secreto: true, requerido: true, forma: '^[A-Za-z0-9]{20}$' },
    ],
    rutaAviso: '/api/pbx/zadarma/',
    dondeSePega: 'Integraciones y API → Notificaciones de eventos',
  },
];

/**
 * La planta telefónica de cada instancia, desde Plataforma.
 *
 * Lo que se protege aquí es lo que distingue esta pantalla de un formulario
 * cualquiera: que una instancia sin configurar se vea como lo que es —la
 * planta por defecto, que es el comportamiento del backend— y no como un
 * formulario en blanco que invita a creer que la telefonía está apagada; y que
 * un valor secreto no viaje de vuelta al navegador nunca, ni para mostrarlo.
 */
describe('Plataforma · planta telefónica', () => {
  const ZADARMA: ConfigPbxVisible = {
    tenant: '63001', proveedor: 'ZADARMA', activo: true,
    credenciales: { key: '71278d8e6746cb220a36' },
    credencialesPuestas: ['key', 'secreto'], faltan: [], capacidades: ['entrantes'],
    numeroEntrante: '+576012345678', actualizadoPor: 'keilor', actualizadoEn: null,
  };

  let guardarConfigPbx: jasmine.Spy;

  function crear(configs: ConfigPbxVisible[] = [ZADARMA]): PlataformaComponent {
    guardarConfigPbx = jasmine.createSpy('guardarConfigPbx').and.returnValue(of(ZADARMA));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AdminService,
          useValue: {
            listarTenants: () => of([]),
            verConfigSms: () => of(null),
            verConfigEls: () => of(null),
            verConfigMfa: () => of(null),
            verConfigPbx: () => of(configs),
            verProveedoresPbx: () => of(PROVEEDORES),
            guardarConfigPbx,
          },
        },
        { provide: ArchivadoService, useValue: {} },
      ],
    });
    const c = TestBed.createComponent(PlataformaComponent).componentInstance;
    c.cargarPbx();
    return c;
  }

  it('una instancia sin configurar se ve con la planta por defecto, que es lo que de verdad es', () => {
    // Sin fila en la base, el backend se comporta como el primer proveedor del
    // registro. Mostrar el formulario en blanco haría creer que no hay
    // telefonía — y hay.
    const c = crear([]);
    c.pbxTenant.set('11001');

    const cfg = c.pbxActual();
    expect(cfg?.proveedor).toBe('YACO');
    expect(cfg?.activo).toBeTrue();
    expect(cfg?.credencialesPuestas).toEqual([]);
  });

  it('sin instancia elegida no muestra ninguna configuración', () => {
    const c = crear();
    expect(c.pbxActual()).toBeNull();
  });

  it('guardar manda SIEMPRE la instancia elegida', () => {
    const c = crear();
    c.pbxTenant.set('63001');

    c.guardarPbx({ proveedor: 'ZADARMA' });

    expect(guardarConfigPbx).toHaveBeenCalledOnceWith({ tenant: '63001', proveedor: 'ZADARMA' });
  });

  it('sin instancia elegida no guarda nada', () => {
    // Sin esto, un cambio en un campo visible por un instante podría escribir
    // sobre la instancia equivocada —o sobre ninguna, con un error feo.
    const c = crear();
    c.guardarPbx({ activo: false });
    expect(guardarConfigPbx).not.toHaveBeenCalled();
  });

  it('dos cambios seguidos no se pisan', () => {
    const c = crear();
    c.pbxTenant.set('63001');
    guardarConfigPbx.and.returnValue({ subscribe: () => undefined });

    c.guardarPbx({ activo: false });
    c.guardarPbx({ activo: true });

    expect(guardarConfigPbx).toHaveBeenCalledTimes(1);
  });

  it('el motivo del backend se muestra tal cual: explica por qué no se pudo', () => {
    // El backend se niega a encender una planta a la que le faltan
    // credenciales, y ese motivo —que nombra los campos— es justo lo que el
    // superadmin necesita leer. Un «no fue posible guardar» genérico lo
    // dejaría adivinando.
    const c = crear();
    c.pbxTenant.set('63001');
    guardarConfigPbx.and.returnValue(throwError(() => ({
      error: { message: 'Para activar Zadarma falta: Secret de la API.' },
    })));

    c.guardarPbx({ activo: true });

    expect(c.pbxError()).toContain('Secret de la API');
    expect(c.pbxGuardando()).toBeFalse();
  });

  it('al guardar, la lista queda al día sin volver a pedirla', () => {
    const c = crear([]);
    c.pbxTenant.set('63001');

    c.guardarPbx({ proveedor: 'ZADARMA' });

    expect(c.pbxActual()?.proveedor).toBe('ZADARMA');
    expect(c.pbxPorProveedor().map((g) => g.proveedor.clave)).toEqual(['ZADARMA']);
  });

  describe('la dirección del webhook', () => {
    it('se arma con la ruta del proveedor elegido y termina donde va la llave', () => {
      const c = crear();
      c.pbxTenant.set('63001');
      expect(c.urlWebhook()).toContain('/api/pbx/zadarma/');
      expect(c.urlWebhook().endsWith('/')).toBeTrue();
    });

    it('cambia con el proveedor: no está escrita a mano en la pantalla', () => {
      const c = crear([{ ...ZADARMA, proveedor: 'YACO' }]);
      c.pbxTenant.set('63001');
      expect(c.urlWebhook()).toContain('/api/pbx/webhook');
    });
  });

  describe('los campos de credenciales salen del descriptor', () => {
    it('solo se guarda lo que se escribió', () => {
      // Lo que no se tocó no puede viajar vacío: borraría el secreto guardado.
      const c = crear();
      c.pbxTenant.set('63001');

      c.pbxEscribir('key', 'nueva-key');
      c.guardarCredencialesPbx();

      expect(guardarConfigPbx).toHaveBeenCalledOnceWith({
        tenant: '63001', credenciales: { key: 'nueva-key' },
      });
    });

    it('sin nada escrito no manda una petición vacía', () => {
      const c = crear();
      c.pbxTenant.set('63001');
      c.guardarCredencialesPbx();
      expect(guardarConfigPbx).not.toHaveBeenCalled();
    });

    it('avisa de un valor con la forma equivocada, sin bloquear el guardado', () => {
      // Una llave pegada con un espacio da el mismo «authentication failed»
      // que una llave equivocada; sin esta pista hay que adivinar cuál es.
      const c = crear();
      c.pbxTenant.set('63001');
      const campo = PROVEEDORES[1].credenciales[0];

      c.pbxEscribir('key', '71278d8e6746cb220a36 ');
      expect(c.pbxFormaDudosa(campo)).toBeTrue();

      c.pbxEscribir('key', '71278d8e6746cb220a36');
      expect(c.pbxFormaDudosa(campo)).toBeFalse();
    });
  });
});

/**
 * Y lo mismo, pero mirando la PANTALLA.
 *
 * Las pruebas de arriba comprueban la lógica, y pasaban todas mientras el
 * usuario no podía configurar nada: elegir Zadarma hacía aparecer los campos
 * de llaves… solo si el backend aceptaba guardar Zadarma, y el backend se
 * negaba a hacerlo sin el secreto, que es justo lo que se escribe en esos
 * campos. Un callejón sin salida que ninguna prueba de lógica podía ver,
 * porque el que lo cerraba era el servidor.
 *
 * De ahí esta prueba: recorre el camino del usuario y mira el DOM.
 */
describe('Plataforma · configurar una planta de punta a punta', () => {
  /** Un backend de mentira que se comporta como el de verdad. */
  function backend() {
    let fila: ConfigPbxVisible = {
      tenant: 'itagui', proveedor: 'YACO', activo: true, credenciales: {},
      credencialesPuestas: [], faltan: [], capacidades: ['entrantes'],
      numeroEntrante: null, actualizadoPor: null, actualizadoEn: null,
    };
    return (d: ConfigPbxGuardar): ConfigPbxVisible => {
      if (d.proveedor) fila = { ...fila, proveedor: d.proveedor };
      const prov = PROVEEDORES.find((p) => p.clave === fila.proveedor)!;
      const faltabanAntes = prov.credenciales.filter((c) => c.requerido && !fila.credencialesPuestas.includes(c.clave));
      if (d.credenciales) {
        const puestas = new Set(fila.credencialesPuestas);
        for (const [k, v] of Object.entries(d.credenciales)) {
          if (!prov.credenciales.some((c) => c.clave === k)) continue;
          if (v) puestas.add(k); else puestas.delete(k);
        }
        fila = { ...fila, credencialesPuestas: [...puestas] };
      }
      if (typeof d.activo === 'boolean') fila = { ...fila, activo: d.activo };
      fila = {
        ...fila,
        capacidades: prov.capacidades,
        faltan: prov.credenciales.filter((c) => c.requerido && !fila.credencialesPuestas.includes(c.clave)).map((c) => c.etiqueta),
      };
      // La regla del servidor: elegida sin credenciales queda APAGADA, no rechazada.
      if (fila.faltan.length) {
        if (d.activo === true) throw new Error(`Para activar ${prov.nombre} falta: ${fila.faltan.join(', ')}`);
        fila = { ...fila, activo: false };
      } else if (faltabanAntes.length && d.activo === undefined) {
        fila = { ...fila, activo: true };
      }
      return fila;
    };
  }

  function montar(): ComponentFixture<PlataformaComponent> {
    const guardar = backend();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // El selector de municipio inyecta GeografiaService, que pide HttpClient.
        provideHttpClient(),
        {
          provide: AdminService,
          useValue: {
            listarTenants: () => of([{ codigo: 'itagui', nombre: 'itagui' }]),
            verConfigSms: () => of(null), verConfigEls: () => of(null), verConfigMfa: () => of(null),
            verConfigPbx: () => of([]),
            verProveedoresPbx: () => of(PROVEEDORES),
            guardarConfigPbx: (d: ConfigPbxGuardar) => of(guardar(d)),
          },
        },
        { provide: ArchivadoService, useValue: {} },
      ],
    });
    const f = TestBed.createComponent(PlataformaComponent);
    f.detectChanges();
    f.componentInstance.pestanaActiva.set('operacion');
    f.componentInstance.pbxTenant.set('itagui');
    f.detectChanges();
    return f;
  }

  const texto = (f: ComponentFixture<PlataformaComponent>) =>
    (f.nativeElement as HTMLElement).textContent ?? '';

  it('con un proveedor que no pide credenciales, no se piden llaves de nadie', () => {
    const f = montar();
    expect(texto(f)).not.toContain('Key de la API');
  });

  it('al elegir el proveedor aparecen los campos que ÉL declara', () => {
    // ESTA es la que faltaba. Sin ella, la pantalla se publicó sin forma de
    // configurar nada y el error solo lo encontró el usuario.
    const f = montar();

    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    expect(texto(f)).toContain('Key de la API');
    expect(texto(f)).toContain('Secret de la API');
    // Con su ayuda, que también sale del descriptor.
    expect(texto(f)).toContain('Claves y API');
    // Y la dirección del webhook, que es lo que se pega en SU panel.
    expect(texto(f)).toContain('/api/pbx/zadarma/');
    expect(texto(f)).toContain('Notificaciones de eventos');
  });

  it('y dice que quedó apagada hasta que se guarden las credenciales', () => {
    const f = montar();

    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    expect(f.componentInstance.pbxActual()?.activo).toBe(false);
    expect(texto(f)).toContain('Falta Key de la API, Secret de la API');
    expect(texto(f)).toContain('apagada');
  });

  it('al guardarlas, la planta queda encendida y lista', () => {
    // La primera configuración real se quedó aquí: con el secret puesto, la
    // planta seguía apagada y nada en pantalla decía que faltaba ese clic.
    const f = montar();
    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    f.componentInstance.pbxEscribir('key', '71278d8e6746cb220a36');
    f.componentInstance.pbxEscribir('secreto', '02c715f8970408240309');
    f.componentInstance.guardarCredencialesPbx();
    f.detectChanges();

    expect(f.componentInstance.pbxActual()?.activo).toBe(true);
    expect(texto(f)).not.toContain('Falta Key');
    expect(texto(f)).toContain('Lista.');
  });

  it('apagada a mano, la pantalla dice que no entrará ninguna llamada', () => {
    const f = montar();
    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.componentInstance.guardarPbx({ credenciales: { key: 'k', secreto: 's' } });
    f.detectChanges();

    f.componentInstance.guardarPbx({ activo: false });
    f.detectChanges();

    expect(texto(f)).toContain('está');
    expect(texto(f)).toContain('apagada');
    expect(texto(f)).toContain('Activa');
  });

  it('la pantalla dice qué sabe hacer el proveedor, para no ofrecer lo imposible', () => {
    const f = montar();
    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    expect(texto(f)).toContain('recibir llamadas');
    // Lo que no declara, no se ofrece.
    expect(texto(f)).not.toContain('llamar desde el caso');
  });
});
