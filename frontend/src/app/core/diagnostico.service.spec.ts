import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CasosWsService } from './casos-ws.service';
import { DiagnosticoService } from './diagnostico.service';
import { PbxService } from './pbx.service';
import { olvidarErrores, registrarErrorHttp } from './registro-errores';

/**
 * El informe de diagnóstico viaja fuera del sistema dentro de un ticket. Las
 * dos garantías que se protegen aquí son las que, si se rompen, convierten una
 * herramienta de soporte en una fuga: que el token de la sesión no sale, y que
 * la URL no se lleva lo que lleve en la consulta.
 *
 * La tercera es de robustez: esto se abre cuando algo YA está roto. Un informe
 * que revienta porque falta un archivo, o porque no hay sesión, no sirve justo
 * cuando hace falta.
 */
describe('informe de diagnóstico', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.ESTE-ES-EL-TOKEN.firma';

  const sesion = signal<Record<string, unknown> | null>({
    token: TOKEN,
    usuario: 'jperez',
    nombre: 'Juan Pérez',
    tipo: 'institucional',
    rol: 'despachador',
    tenant: '63001',
    agencia: 'policia',
    permisos: ['casos.ver'],
  });
  const tenantActivo = signal<string | null>('63001');

  let ruta = '/casos';
  let wsEstado: 'sin iniciar' | 'conectado' | 'caido' = 'conectado';
  const canalEsperado = signal(false);
  const enVivo = signal(false);

  function crear(): DiagnosticoService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DiagnosticoService,
        { provide: AuthService, useValue: { sesion, tenantActivo } },
        { provide: Router, useValue: { get url() { return ruta; } } },
        { provide: CasosWsService, useValue: { get estado() { return wsEstado; } } },
        { provide: PbxService, useValue: { canalEsperado, enVivo } },
      ],
    });
    return TestBed.inject(DiagnosticoService);
  }

  beforeEach(() => {
    olvidarErrores();
    ruta = '/casos';
    wsEstado = 'conectado';
    canalEsperado.set(false);
    enVivo.set(false);
    sesion.set({
      token: TOKEN, usuario: 'jperez', nombre: 'Juan Pérez', tipo: 'institucional',
      rol: 'despachador', tenant: '63001', agencia: 'policia', permisos: ['casos.ver'],
    });
    tenantActivo.set('63001');
    // Sin archivo de versión publicado (es el caso en desarrollo).
    spyOn(window, 'fetch').and.rejectWith(new Error('sin red'));
  });

  afterAll(() => olvidarErrores());

  it('identifica al usuario, su rol y su instancia', async () => {
    const i = await crear().armar();
    expect(i.sesion?.usuario).toBe('jperez');
    expect(i.sesion?.nombre).toBe('Juan Pérez');
    expect(i.sesion?.rol).toBe('despachador');
    expect(i.sesion?.tenant).toBe('63001');
    expect(i.sesion?.agencia).toBe('policia');
  });

  it('NO lleva el token de la sesión: es una credencial viva', async () => {
    const d = crear();
    const i = await d.armar();
    expect(JSON.stringify(i)).not.toContain('ESTE-ES-EL-TOKEN');
    expect(JSON.stringify(i)).not.toContain(TOKEN);
    // Ni en el objeto ni en el texto que es lo que de verdad se pega y se manda.
    expect(d.comoTexto(i)).not.toContain('ESTE-ES-EL-TOKEN');
  });

  it('tampoco lleva los permisos ni nada más de la sesión que no se pidió', async () => {
    const i = await crear().armar();
    expect(Object.keys(i.sesion!).sort()).toEqual(
      ['agencia', 'nombre', 'rol', 'tenant', 'usuario'],
    );
  });

  it('de la pantalla guarda la ruta, no la consulta', async () => {
    ruta = '/casos?telefono=3001234567&ciudadano=Ana';
    const d = crear();
    const i = await d.armar();
    expect(i.donde.ruta).toBe('/casos');
    expect(d.comoTexto(i)).not.toContain('3001234567');
  });

  it('distingue la planta sin abrir de la planta caída', async () => {
    // Nadie la abrió: no está caída, no existe en esta pantalla. Es el mismo
    // criterio del aviso de Recepción, y la confusión entre los dos fue
    // exactamente el falso aviso que hubo que corregir allí.
    expect((await crear().armar()).canales.planta).toBe('sin contratar o sin abrir');

    canalEsperado.set(true);
    expect((await crear().armar()).canales.planta).toBe('caida');

    enVivo.set(true);
    expect((await crear().armar()).canales.planta).toBe('conectada');
  });

  it('informa el estado del canal de casos en vivo', async () => {
    wsEstado = 'caido';
    expect((await crear().armar()).canales.casosEnVivo).toBe('caido');
  });

  it('adjunta los errores recientes, el más nuevo al final', async () => {
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'primero' });
    registrarErrorHttp('POST', '/api/casos', 403, { message: 'segundo' });
    const d = crear();
    const i = await d.armar();
    expect(i.errores.length).toBe(2);
    expect(i.errores[1].detalle).toBe('segundo');
    const texto = d.comoTexto(i);
    expect(texto).toContain('POST /api/casos');
    expect(texto).toContain('[403]');
  });

  it('el texto muestra el estado 0, que es el diagnóstico más común', async () => {
    registrarErrorHttp('GET', '/api/auth/perfil', 0, null);
    const d = crear();
    const texto = d.comoTexto(await d.armar());
    expect(texto).toContain('[0]');
    expect(texto).toContain('sin respuesta del servidor');
  });

  it('el texto muestra cuántas veces se repitió un fallo', async () => {
    for (let i = 0; i < 37; i++) registrarErrorHttp('POST', '/api/video/1/chunk', 500, { message: 'disco lleno' });
    const d = crear();
    expect(d.comoTexto(await d.armar())).toContain('(×37)');
  });

  it('sin errores lo dice en lugar de dejar un hueco', async () => {
    const d = crear();
    expect(d.comoTexto(await d.armar())).toContain('Sin errores registrados');
  });

  it('no revienta sin sesión: el fallo puede ser el login mismo', async () => {
    sesion.set(null);
    tenantActivo.set(null);
    const d = crear();
    const i = await d.armar();
    expect(i.sesion).toBeNull();
    expect(d.comoTexto(i)).toContain('sin sesión abierta');
  });

  it('sin archivo de versión publicado el informe sigue sirviendo', async () => {
    const i = await crear().armar();
    expect(i.version.commit).toBeTruthy();
    expect(i.version.publicado).toBe('—');
  });

  it('usa el commit publicado cuando el despliegue lo selló', async () => {
    (window.fetch as jasmine.Spy).and.resolveTo(
      new Response('{"commit":"2ee819c","publicado":"2026-10-11T16:55:31Z"}', { status: 200 }),
    );
    const d = crear();
    const i = await d.armar();
    expect(i.version.commit).toBe('2ee819c');
    expect(d.comoTexto(i)).toContain('2ee819c');
  });

  it('el texto es legible por una persona, no un JSON', async () => {
    const d = crear();
    const texto = d.comoTexto(await d.armar());
    expect(texto).toContain('FALCON CAD · contexto técnico');
    expect(texto).toContain('Usuario       Juan Pérez (jperez)');
    expect(texto).toContain('Instancia     63001');
    expect(texto.startsWith('{')).toBe(false);
  });
});
