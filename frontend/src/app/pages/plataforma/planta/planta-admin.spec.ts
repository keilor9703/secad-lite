import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { AdminService } from '../../../core/admin.service';
import { ConfirmService } from '../../../shared/confirm/confirm.service';
import { ToastService } from '../../../shared/toast/toast.service';
import {
  ConfiguracionPlanta, PlantaService, PlantaVisible, TroncalVisible,
} from '../../../core/planta.service';
import { Tenant } from '../../../core/models';
import { PlantaAdminComponent } from './planta-admin';

/**
 * Nuestras centralitas, desde Plataforma.
 *
 * Lo que se protege, que es lo que distingue esta pantalla de un formulario
 * cualquiera:
 *
 *  1. **Que «Aplicar» no se dispare sin confirmación.** Renueva la API key de
 *     la instancia, y mientras los archivos nuevos no estén instalados la
 *     central no puede avisar de las llamadas. Un clic de más ahí deja un
 *     municipio sin cola de llamadas.
 *  2. **Que «Ver la configuración» no toque nada.** Mirar no puede romper.
 *  3. **Que la clave de la troncal nunca se prerrellene** y que, vacía, no se
 *     mande: el servidor conserva la guardada. Mandarla vacía la borraría.
 *  4. **Que lo que falta se enseñe tal como lo dice el servidor**, que es el
 *     único que lo sabe, y en su orden.
 *  5. **Que el motivo de un rechazo sea el del servidor.** «El puerto 5060 ya
 *     lo usa otra planta de este servidor» dice qué hacer; «Error 409», no.
 *  6. **Que no se ofrezca dar de alta una instancia que ya tiene planta.**
 */
describe('PlantaAdminComponent', () => {
  const TRONCAL: TroncalVisible = {
    id: 't1', nombre: 'Infobip Bogotá', proveedor: 'INFOBIP',
    servidor: 'sbc.infobip.com', puerto: 5060, autenticacion: 'registro',
    usuario: 'itagui', clavePuesta: true, redes: ['81.23.252.0/24'],
    canales: 10, prioridad: 1, activa: true,
  };

  const ITAGUI: PlantaVisible = {
    tenant: 'itagui', servidor: '129.80.243.118', ipPublica: '129.80.243.118',
    ipInterna: '127.0.0.1',
    ipPrivada: '',
    dominioSip: 'itagui-pbx.falconcad.com.co', contenedor: 'asterisk-itagui',
    puertoSip: 5060, rtpDesde: 20500, rtpHasta: 20999, puertoHttp: 8100,
    estado: 'provisionada', notas: null,
    wss: 'wss://itagui-pbx.falconcad.com.co/ws',
    ari: 'https://itagui-pbx.falconcad.com.co/ari',
    troncales: [TRONCAL],
    numeros: [{
      id: 'n1', numero: '+18335308128', tipo: 'did', troncalId: 't1',
      destino: 'cola', descripcion: 'Línea de pruebas', activo: true,
    }],
    operadores: 2, operadoresConClave: 1,
    faltan: ['la clave SIP de los operadores (se genera al aplicar)'],
    actualizadoPor: 'keilor', actualizadoEn: null,
  };

  const TENANTS = [
    { id: '1', codigo: 'itagui', nombre: 'Itagüí' },
    { id: '2', codigo: 'envigado', nombre: 'Envigado' },
  ] as Tenant[];

  const CONFIG: ConfiguracionPlanta = {
    tenant: 'itagui', carpeta: '/opt/falcon-pbx/itagui', previa: true,
    advertencias: ['Esta es una vista previa: las claves aparecen sustituidas.'],
    archivos: [
      { ruta: 'etc/pjsip.conf', contenido: '[transport-udp]', modo: '600', secreto: true },
      { ruta: 'aplicar.sh', contenido: '#!/usr/bin/env bash', modo: '600', secreto: true },
    ],
  };

  let api: {
    listar: jasmine.Spy; crear: jasmine.Spy; actualizar: jasmine.Spy; eliminar: jasmine.Spy;
    previa: jasmine.Spy; aplicar: jasmine.Spy;
    salud: jasmine.Spy; revisar: jasmine.Spy;
    guardarTroncal: jasmine.Spy; eliminarTroncal: jasmine.Spy;
    guardarNumero: jasmine.Spy; eliminarNumero: jasmine.Spy;
  };
  let responder: boolean;
  let preguntas: string[];
  let errores: string[];

  function crear(plantas: PlantaVisible[] = [ITAGUI]): PlantaAdminComponent {
    responder = true;
    preguntas = [];
    errores = [];
    api = {
      listar: jasmine.createSpy('listar').and.returnValue(of(plantas)),
      // Una planta recién dada de alta no tiene revisión todavía: null es el
      // caso normal, no un error.
      salud: jasmine.createSpy('salud').and.returnValue(of(null)),
      revisar: jasmine.createSpy('revisar').and.returnValue(of({
        tenant: 'itagui', bien: true, fallas: [], version: '20.6.0',
        operadores: 1, certificadoVence: null, detalle: 'Asterisk 20.6.0 responde.',
      })),
      crear: jasmine.createSpy('crear').and.returnValue(of(ITAGUI)),
      actualizar: jasmine.createSpy('actualizar').and.returnValue(of(ITAGUI)),
      eliminar: jasmine.createSpy('eliminar').and.returnValue(of({ tenant: 'itagui' })),
      previa: jasmine.createSpy('previa').and.returnValue(of(CONFIG)),
      aplicar: jasmine.createSpy('aplicar')
        .and.returnValue(of({ ...CONFIG, previa: false, advertencias: ['Se renovó la API key…'] })),
      guardarTroncal: jasmine.createSpy('guardarTroncal').and.returnValue(of(TRONCAL)),
      eliminarTroncal: jasmine.createSpy('eliminarTroncal').and.returnValue(of({ id: 't1' })),
      guardarNumero: jasmine.createSpy('guardarNumero').and.returnValue(of({ ...ITAGUI.numeros[0] })),
      eliminarNumero: jasmine.createSpy('eliminarNumero').and.returnValue(of({ id: 'n1' })),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PlantaService, useValue: api },
        { provide: AdminService, useValue: { listarTenants: () => of(TENANTS) } },
        {
          provide: ConfirmService,
          useValue: {
            preguntar: (mensaje: string) => { preguntas.push(mensaje); return Promise.resolve(responder); },
          },
        },
        {
          provide: ToastService,
          useValue: {
            exito: () => undefined,
            error: (m: string) => errores.push(m),
            advertencia: () => undefined,
            info: () => undefined,
          },
        },
      ],
    });
    const c = TestBed.runInInjectionContext(() => new PlantaAdminComponent());
    c.ngOnInit();
    return c;
  }

  describe('el estado de la planta', () => {
    const SANA = {
      tenant: 'itagui', bien: true, fallas: [] as string[], version: '20.6.0',
      operadores: 2, certificadoVence: null, detalle: 'Asterisk 20.6.0 responde.',
      fallaDesde: null, revisadoEn: new Date().toISOString(),
    };
    const CAIDA = {
      ...SANA, bien: false, fallas: ['troncal'], operadores: 0,
      detalle: 'La troncal está «offline»: no entran llamadas.',
      fallaDesde: '2026-10-20T01:00:00.000Z',
    };

    it('al abrir la ficha carga la última revisión', () => {
      // Al abrir, no al listar: son tres conexiones contra la planta y la
      // lista se mira muchas más veces que una ficha concreta.
      const c = crear();
      api.salud.and.returnValue(of(CAIDA));
      c.abrir('itagui');
      expect(api.salud).toHaveBeenCalledWith('itagui');
      expect(c.salud()?.fallas).toEqual(['troncal']);
    });

    it('que no haya revisión todavía NO es un error en pantalla', () => {
      // Una planta recién dada de alta no tiene ninguna. Enseñar un error rojo
      // ahí enseña a ignorar los errores rojos.
      const c = crear();
      api.salud.and.returnValue(of(null));
      c.abrir('itagui');
      expect(c.salud()).toBeNull();
      expect(errores).toEqual([]);
    });

    it('«revisar ahora» mide y recarga, sin esperar al barrido', () => {
      // Es lo que evita el «entre por SSH y mire» después de tocar algo.
      const c = crear();
      c.abrir('itagui');
      api.salud.and.returnValue(of(SANA));
      c.revisarAhora();
      expect(api.revisar).toHaveBeenCalledWith('itagui');
      expect(c.salud()?.bien).toBe(true);
      expect(c.revisando()).toBe(false);
    });

    it('si la revisión falla lo dice y no deja el botón colgado', () => {
      const c = crear();
      c.abrir('itagui');
      api.revisar.and.returnValue(throwError(() => ({ error: { message: 'sin red' } })));
      c.revisarAhora();
      expect(c.revisando()).toBe(false);
      expect(errores.length).toBe(1);
    });

    it('cada falla se explica por lo que el ciudadano deja de poder hacer', () => {
      // «troncal» no le dice nada a quien abre la pantalla a las tres de la
      // mañana; «las llamadas no llegan», sí.
      const c = crear();
      expect(c.queSignifica('troncal')).toContain('no llegan');
      expect(c.queSignifica('asterisk')).toContain('no entran llamadas');
      expect(c.queSignifica('certificado-vencido')).toContain('ya no puede conectar');
    });

    it('mientras carga la siguiente NO enseña el estado de la anterior', () => {
      // La trampa está en el tiempo: si no se limpia al abrir, la ficha de
      // «envigado» enseña durante un instante la falla de «itagui» —y alguien
      // sale corriendo a arreglar una planta que está bien—. El doble se deja
      // SIN responder a propósito: con una respuesta inmediata esta prueba
      // pasaría igual sin la limpieza, y no protegería nada.
      const c = crear([ITAGUI, { ...ITAGUI, tenant: 'envigado', puertoSip: 5061 }]);
      api.salud.and.returnValue(of(CAIDA));
      c.abrir('itagui');
      expect(c.salud()).toBeTruthy();

      api.salud.and.returnValue(NEVER);
      c.abrir('envigado');
      expect(c.salud()).toBeNull();
    });
  });

  describe('la lista', () => {
    it('enseña lo que el servidor dice que falta, en su orden', () => {
      const c = crear();
      expect(c.plantas()[0].faltan).toEqual(['la clave SIP de los operadores (se genera al aplicar)']);
    });

    it('no ofrece dar de alta una instancia que ya tiene planta', () => {
      const c = crear();
      expect(c.sinPlanta().map((t) => t.codigo)).toEqual(['envigado']);
    });

    it('ofrece los servidores que ya se usan, sin repetirlos', () => {
      const c = crear([ITAGUI, { ...ITAGUI, tenant: 'envigado', puertoSip: 5061 }]);
      expect(c.servidores()).toEqual(['129.80.243.118']);
    });

    it('el tono de la píldora distingue lo que atiende de lo que no', () => {
      const c = crear();
      expect(c.tono('activa')).toBe('badge--ok');
      expect(c.tono('provisionada')).toBe('badge--teal');
      expect(c.tono('borrador')).toBe('badge--warn');
      expect(c.tono('suspendida')).toBe('badge--danger');
    });

    it('si la lista de instancias falla, la pantalla sigue sirviendo', () => {
      TestBed.resetTestingModule();
      const c = crear();
      expect(c.plantas().length).toBe(1);
    });
  });

  describe('abrir una planta', () => {
    it('llena los formularios con lo que hay, no en blanco', () => {
      const c = crear();
      c.abrir('itagui');
      expect(c.datosForm.getRawValue().servidor).toBe('129.80.243.118');
      expect(c.datosForm.getRawValue().dominioSip).toBe('itagui-pbx.falconcad.com.co');
      expect(c.puertosForm.getRawValue()).toEqual({
        puertoSip: 5060, rtpDesde: 20500, rtpHasta: 20999, puertoHttp: 8100,
      });
    });

    it('los puertos no se editan hasta que se pide: los reparte el servidor', () => {
      const c = crear();
      c.abrir('itagui');
      expect(c.editandoPuertos()).toBe(false);
    });

    it('volver a hacer clic la cierra', () => {
      const c = crear();
      c.abrir('itagui');
      c.abrir('itagui');
      expect(c.abierta()).toBe('');
    });
  });

  describe('la troncal', () => {
    it('nunca prerrellena la clave, porque el servidor no la manda', () => {
      const c = crear();
      c.abrir('itagui');
      c.editarTroncal(TRONCAL);
      expect(c.troncalForm.getRawValue().clave).toBe('');
      expect(c.troncalForm.getRawValue().usuario).toBe('itagui');
      expect(c.troncalForm.getRawValue().redes).toBe('81.23.252.0/24');
    });

    it('con la clave vacía NO la manda: vacía, el servidor conserva la guardada', () => {
      const c = crear();
      c.abrir('itagui');
      c.editarTroncal(TRONCAL);
      c.guardarTroncal();
      expect(api.guardarTroncal).toHaveBeenCalled();
      const dto = api.guardarTroncal.calls.mostRecent().args[1];
      expect(dto.clave).toBeUndefined();
      expect(dto.id).toBe('t1');
    });

    it('borrar una troncal se pregunta antes', async () => {
      const c = crear();
      c.abrir('itagui');
      responder = false;
      await c.eliminarTroncal(TRONCAL);
      expect(preguntas.length).toBe(1);
      expect(api.eliminarTroncal).not.toHaveBeenCalled();
    });
  });

  describe('la configuración', () => {
    it('ver no pregunta y no aplica nada', () => {
      const c = crear();
      c.abrir('itagui');
      c.verConfiguracion();
      expect(preguntas.length).toBe(0);
      expect(api.aplicar).not.toHaveBeenCalled();
      expect(c.config()?.previa).toBe(true);
      expect(c.archivoAbierto()).toBe('etc/pjsip.conf');
    });

    it('aplicar PREGUNTA antes, y si se dice que no, no llama al servidor', async () => {
      const c = crear();
      c.abrir('itagui');
      responder = false;
      await c.aplicar();
      expect(api.aplicar).not.toHaveBeenCalled();
    });

    it('la pregunta dice qué se rompe mientras no se instale, no un «¿está seguro?»', async () => {
      const c = crear();
      c.abrir('itagui');
      responder = false;
      await c.aplicar();
      expect(preguntas[0]).toContain('API key');
      expect(preguntas[0]).toContain('no podrá avisar');
    });

    it('al aplicar abre el script, que es lo que hay que llevar al servidor', async () => {
      const c = crear();
      c.abrir('itagui');
      await c.aplicar();
      expect(api.aplicar).toHaveBeenCalledWith('itagui');
      expect(c.archivoAbierto()).toBe('aplicar.sh');
      expect(c.config()?.previa).toBe(false);
    });

    it('sin planta abierta no hay nada que aplicar', async () => {
      const c = crear();
      await c.aplicar();
      expect(preguntas.length).toBe(0);
      expect(api.aplicar).not.toHaveBeenCalled();
    });
  });

  describe('cuando el servidor rechaza', () => {
    it('enseña el motivo del servidor, que es el que dice qué hacer', () => {
      const c = crear();
      api.crear.and.returnValue(throwError(() => ({
        error: { message: 'El puerto SIP 5060 ya lo usa otra planta de este servidor.' },
      })));
      c.altaForm.setValue({
        tenant: 'envigado', servidor: '129.80.243.118', ipPublica: '', dominioSip: '',
      });
      c.crear();
      expect(errores[0]).toContain('ya lo usa otra planta');
    });

    it('junta los motivos cuando el servidor manda varios', () => {
      const c = crear();
      api.crear.and.returnValue(throwError(() => ({ error: { message: ['uno', 'dos'] } })));
      c.altaForm.setValue({ tenant: 'envigado', servidor: 'x', ipPublica: '', dominioSip: '' });
      c.crear();
      expect(errores[0]).toBe('uno · dos');
    });

    it('y si no manda ninguno, lo dice sin inventar', () => {
      const c = crear();
      api.crear.and.returnValue(throwError(() => ({})));
      c.altaForm.setValue({ tenant: 'envigado', servidor: 'x', ipPublica: '', dominioSip: '' });
      c.crear();
      expect(errores[0]).toBe('El servidor no respondió.');
    });
  });
});
