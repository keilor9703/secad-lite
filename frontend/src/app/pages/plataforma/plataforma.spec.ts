import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AdminService, ConfigPbxGuardar, ConfigPbxVisible } from '../../core/admin.service';
import { ArchivadoService } from '../../core/archivado.service';
import { PlataformaComponent } from './plataforma';

/**
 * La planta telefónica de cada instancia, desde Plataforma.
 *
 * Lo que se protege aquí es lo que distingue esta pantalla de un formulario
 * cualquiera: que una instancia sin configurar se vea como lo que es —YACO,
 * que es el comportamiento por defecto— y no como un formulario en blanco que
 * invita a creer que la telefonía está apagada; y que el secreto no viaje de
 * vuelta al navegador nunca, ni para mostrarlo.
 */
describe('Plataforma · planta telefónica', () => {
  const ZADARMA: ConfigPbxVisible = {
    tenant: '63001', proveedor: 'ZADARMA', activo: true,
    zadarmaKey: '71278d8e6746cb220a36', tieneCredenciales: true,
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

  it('una instancia sin configurar se ve como YACO, que es lo que de verdad es', () => {
    // Sin fila en la base, el backend se comporta como YACO. Mostrar el
    // formulario en blanco haría creer que no hay telefonía — y hay.
    const c = crear([]);
    c.pbxTenant.set('11001');

    const cfg = c.pbxActual();
    expect(cfg?.proveedor).toBe('YACO');
    expect(cfg?.activo).toBeTrue();
    expect(cfg?.tieneCredenciales).toBeFalse();
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
    // El backend se niega a activar Zadarma sin secreto, y ese motivo es
    // justo lo que el superadmin necesita leer. Un «no fue posible guardar»
    // genérico lo dejaría adivinando.
    const c = crear();
    c.pbxTenant.set('63001');
    guardarConfigPbx.and.returnValue(throwError(() => ({
      error: { message: 'Para activar Zadarma hace falta el secreto de la API: sin él no se puede verificar la firma.' },
    })));

    c.guardarPbx({ activo: true });

    expect(c.pbxError()).toContain('hace falta el secreto');
    expect(c.pbxGuardando()).toBeFalse();
  });

  it('al guardar, la lista queda al día sin volver a pedirla', () => {
    const c = crear([]);
    c.pbxTenant.set('63001');

    c.guardarPbx({ proveedor: 'ZADARMA' });

    expect(c.pbxActual()?.proveedor).toBe('ZADARMA');
    expect(c.pbxEnZadarma().map((x) => x.tenant)).toEqual(['63001']);
  });

  it('la dirección del webhook se arma sola y termina donde va la llave', () => {
    const c = crear();
    expect(c.urlWebhook()).toContain('/api/pbx/zadarma/');
    expect(c.urlWebhook().endsWith('/')).toBeTrue();
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
describe('Plataforma · configurar Zadarma de punta a punta', () => {
  /** Un backend de mentira que se comporta como el de verdad. */
  function backend() {
    let fila: ConfigPbxVisible = {
      tenant: 'itagui', proveedor: 'YACO', activo: true, zadarmaKey: null,
      tieneCredenciales: false, numeroEntrante: null, actualizadoPor: null, actualizadoEn: null,
    };
    return (d: ConfigPbxGuardar): ConfigPbxVisible => {
      if (d.proveedor) fila = { ...fila, proveedor: d.proveedor };
      if (d.zadarmaSecreto) fila = { ...fila, tieneCredenciales: true };
      if (typeof d.activo === 'boolean') fila = { ...fila, activo: d.activo };
      // La regla del servidor: elegida sin secreto queda APAGADA, no rechazada.
      if (fila.proveedor === 'ZADARMA' && !fila.tieneCredenciales) {
        if (d.activo === true) throw new Error('hace falta el secreto de la API');
        fila = { ...fila, activo: false };
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

  it('con YACO no se piden llaves de nadie', () => {
    const f = montar();
    expect(texto(f)).not.toContain('Key de la API de Zadarma');
  });

  it('al elegir Zadarma aparecen los campos para escribir las llaves', () => {
    // ESTA es la que faltaba. Sin ella, la pantalla se publicó sin forma de
    // configurar nada y el error solo lo encontró el usuario.
    const f = montar();

    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    expect(texto(f)).toContain('Key de la API de Zadarma');
    expect(texto(f)).toContain('Secret');
    // Y la dirección del webhook, que es lo que se pega en el panel de Zadarma.
    expect(texto(f)).toContain('/api/pbx/zadarma/');
  });

  it('y dice que quedó apagada hasta que se guarde el secret', () => {
    const f = montar();

    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    expect(f.componentInstance.pbxActual()?.activo).toBe(false);
    expect(texto(f)).toContain('Falta el secret');
    expect(texto(f)).toContain('apagada');
  });

  it('con el secret guardado, el aviso desaparece', () => {
    const f = montar();
    f.componentInstance.guardarPbx({ proveedor: 'ZADARMA' });
    f.detectChanges();

    f.componentInstance.guardarPbx({ zadarmaSecreto: '02c715f8970408240309' });
    f.detectChanges();

    expect(f.componentInstance.pbxActual()?.tieneCredenciales).toBe(true);
    expect(texto(f)).not.toContain('Falta el secret');
  });
});
