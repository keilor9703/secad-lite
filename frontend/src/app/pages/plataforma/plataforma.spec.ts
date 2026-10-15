import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminService, ConfigPbxVisible } from '../../core/admin.service';
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
