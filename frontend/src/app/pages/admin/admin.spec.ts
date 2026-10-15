import { TestBed } from '@angular/core/testing';
import { AdminService } from '../../core/admin.service';
import { UsuarioAdmin } from '../../core/models';
import { AuthService } from '../../core/auth.service';
import { CasosService } from '../../core/casos.service';
import { CatalogosService } from '../../core/catalogos.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { CtiService } from '../../core/cti.service';
import { EntidadesService } from '../../core/entidades.service';
import { PbxService } from '../../core/pbx.service';
import { RolesService } from '../../core/roles.service';
import { ToastService } from '../../shared/toast/toast.service';
import { WhatsappService } from '../../core/whatsapp.service';
import { AdminComponent } from './admin';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';

/**
 * Las cuentas sin correo.
 *
 * Son las que vienen de antes de que FALCON mandara correos: se crearon con
 * una contraseña que puso un administrador y no tienen a dónde mandarles nada.
 * Mientras sigan así no pueden recuperar su clave solas, y nadie se entera de
 * que existen hasta que alguien se queda fuera un domingo.
 *
 * Lo que se protege aquí: que se CUENTEN (si no, no se ven), que se puedan
 * aislar para resolverlas de una vez, y que registrar el correo sea UNA
 * acción — registrar y luego invitar por separado deja un estado intermedio
 * que ninguna pantalla muestra.
 */
describe('Administración · cuentas sin correo', () => {
  const usuario = (id: string, correo: string | null): UsuarioAdmin => ({
    id, username: `u${id}`, nombre: `Usuario ${id}`, rol: 'operador',
    tenant: 'demo', activo: true, agenciaId: null, canales: [], extension: null,
    whatsappHandle: null, mfaActivadoEn: null, correo,
    correoVerificadoEn: null, correoRebotadoEn: null, correoRebotadoMotivo: null,
    invitacionEnviadaEn: null, invitacionError: null,
  } as unknown as UsuarioAdmin);

  let registrarCorreo: jasmine.Spy;
  let avisos: string[];

  function crear(): AdminComponent {
    registrarCorreo = jasmine.createSpy('registrarCorreo')
      .and.returnValue(of({ ok: true, correo: 'jperez@muni.gov.co' }));
    avisos = [];
    const vacio = {} as never;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AdminService, useValue: { registrarCorreo, usuarios: () => of([]) } },
        {
          // Lo que el componente lee al construirse. Si mañana lee algo más,
          // esta prueba lo dice en la primera corrida.
          provide: AuthService,
          useValue: {
            sesion: signal(null),
            esSuperadmin: signal(false),
            gestionaRoles: signal(false),
            tienePermiso: () => signal(false),
            tieneIntegracion: () => false,
            tenantCtx: signal(null),
            tenantActivo: signal('demo'),
          },
        },
        { provide: PbxService, useValue: vacio },
        { provide: CtiService, useValue: vacio },
        { provide: WhatsappService, useValue: vacio },
        { provide: RolesService, useValue: vacio },
        { provide: EntidadesService, useValue: vacio },
        { provide: CatalogosService, useValue: vacio },
        { provide: CasosService, useValue: vacio },
        { provide: ConfirmService, useValue: vacio },
        {
          provide: ToastService,
          useValue: {
            exito: (m: string) => avisos.push(`exito:${m}`),
            error: (m: string) => avisos.push(`error:${m}`),
            advertencia: (m: string) => avisos.push(`adv:${m}`),
            info: (m: string) => avisos.push(`info:${m}`),
          },
        },
      ],
    });
    // Sin `detectChanges`: no se monta la vista ni corre `ngOnInit`, que
    // cargaría media Administración. Aquí interesa la lógica de la lista.
    const c = TestBed.createComponent(AdminComponent).componentInstance;
    // `cargarUsuarios` vuelve a pedir la lista al servidor tras cada cambio;
    // en la prueba se anula para poder ver el estado que dejó la acción.
    (c as unknown as { cargarUsuarios: () => void }).cargarUsuarios = () => undefined;
    return c;
  }

  it('cuenta las que no tienen correo', () => {
    const c = crear();
    c.usuarios.set([usuario('1', null), usuario('2', 'a@b.co'), usuario('3', null)]);
    expect(c.sinCorreo()).toBe(2);
  });

  it('sin ninguna, el aviso no tiene nada que decir', () => {
    const c = crear();
    c.usuarios.set([usuario('1', 'a@b.co')]);
    expect(c.sinCorreo()).toBe(0);
  });

  it('el filtro aísla solo esas, y se puede volver', () => {
    const c = crear();
    c.usuarios.set([usuario('1', null), usuario('2', 'a@b.co')]);

    expect(c.usuariosVisibles().length).toBe(2);
    c.soloSinCorreo.set(true);
    expect(c.usuariosVisibles().map((u) => u.id)).toEqual(['1']);
    c.soloSinCorreo.set(false);
    expect(c.usuariosVisibles().length).toBe(2);
  });

  it('registrar el correo es UNA sola llamada: pone y envía', () => {
    const c = crear();
    const u = usuario('1', null);
    c.usuarios.set([u]);

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('  jperez@muni.gov.co  ');
    c.guardarCorreo(u);

    expect(registrarCorreo).toHaveBeenCalledOnceWith('1', 'jperez@muni.gov.co', true);
    expect(avisos.some((a) => a.startsWith('exito:'))).toBeTrue();
    // Y la fila se cierra: no queda un campo abierto invitando a repetir.
    expect(c.registrandoCorreo()).toBeNull();
  });

  it('un correo mal escrito no manda nada', () => {
    const c = crear();
    const u = usuario('1', null);

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('jperez@');
    c.guardarCorreo(u);

    expect(registrarCorreo).not.toHaveBeenCalled();
  });

  it('«solo el enlace» no envía correo y muestra el enlace', () => {
    const c = crear();
    const u = usuario('1', null);
    registrarCorreo.and.returnValue(of({
      ok: true, correo: 'jperez@muni.gov.co', enlace: 'https://falconcad.com.co/activar/TOK',
    }));

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('jperez@muni.gov.co');
    c.guardarCorreo(u, false);

    expect(registrarCorreo).toHaveBeenCalledOnceWith('1', 'jperez@muni.gov.co', false);
    expect(c.enlaceInvitacion()?.url).toContain('/activar/TOK');
  });

  it('si el envío falla, lo dice y deja el enlace a la vista', () => {
    // El correo quedó registrado; lo que falló fue el envío. Sin el enlace, esa
    // persona se queda sin forma de entrar y el administrador sin saberlo.
    const c = crear();
    const u = usuario('1', null);
    registrarCorreo.and.returnValue(of({
      ok: false, correo: 'jperez@muni.gov.co', error: 'HTTP 402 sin crédito',
      enlace: 'https://falconcad.com.co/activar/TOK',
    }));

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('jperez@muni.gov.co');
    c.guardarCorreo(u);

    expect(avisos.some((a) => a.startsWith('adv:') && a.includes('402'))).toBeTrue();
    expect(c.enlaceInvitacion()?.url).toContain('/activar/TOK');
  });

  it('si el servidor rechaza, el campo no se queda bloqueado', () => {
    const c = crear();
    const u = usuario('1', null);
    registrarCorreo.and.returnValue(throwError(() => ({ error: { message: 'Correo repetido.' } })));

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('jperez@muni.gov.co');
    c.guardarCorreo(u);

    expect(c.guardandoCorreo()).toBeFalse();
    expect(c.error()).toContain('Correo repetido');
  });

  it('dos clics seguidos no mandan dos invitaciones', () => {
    const c = crear();
    const u = usuario('1', null);
    // Una respuesta que nunca llega: el segundo clic cae mientras vuela la primera.
    registrarCorreo.and.returnValue({ subscribe: () => undefined });

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('jperez@muni.gov.co');
    c.guardarCorreo(u);
    c.guardarCorreo(u);

    expect(registrarCorreo).toHaveBeenCalledTimes(1);
  });

  it('un correo con espacios alrededor se acepta: pegarlo es lo normal', () => {
    // `Validators.email` de Angular da por inválido un valor con un espacio al
    // final, y el botón se quedaba inhabilitado sin decir por qué. Lo encontró
    // esta prueba, no un usuario.
    const c = crear();
    const u = usuario('1', null);

    c.abrirRegistroCorreo(u);
    c.correoNuevoCtrl.setValue('  jperez@muni.gov.co  ');

    expect(c.correoNuevoCtrl.valid).toBeTrue();
    c.guardarCorreo(u);
    expect(registrarCorreo).toHaveBeenCalledOnceWith('1', 'jperez@muni.gov.co', true);
  });
});
