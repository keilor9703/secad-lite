/**
 * Prueba del doble factor. Lo que se verifica aquí no es «funciona», sino que
 * NO se puede saltar.
 *
 * El guard de la aplicación acepta cualquier JWT firmado con JWT_SECRET, y los
 * tokens intermedios del 2FA se firman con esa misma llave porque el servicio
 * de JWT es uno solo. Si no se distinguieran, presentar el token del reto como
 * `Authorization: Bearer` daría una sesión completa sin haber tecleado ningún
 * código: el segundo factor se saltaría entero. Por eso el guard real entra en
 * esta prueba, no una imitación.
 *
 * Sin base de datos: el repositorio es una fila en memoria. Lo que se prueba
 * es la lógica de seguridad, no TypeORM.
 *
 *   npx ts-node test/mfa.integracion.ts
 */
import 'reflect-metadata';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { UsuarioEntity } from '../src/usuarios/usuario.entity';
import { ConfigMfaEntity } from '../src/auth/mfa/config-mfa.entity';
import { MfaService, TENANT_CONFIG_MFA } from '../src/auth/mfa/mfa.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { ConfirmarMfaDto, InscripcionMfaDto, VerificarMfaDto } from '../src/auth/dto/login.dto';
import { codigoDeContador, contadorDe, deBase32 } from '../src/auth/mfa/totp';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}
async function lanza(fn: () => Promise<unknown>, que: string): Promise<string> {
  try { await fn(); afirmar(false, `${que} (no lanzó)`); return ''; }
  catch (e) { afirmar(true, que); return (e as Error).message; }
}

const SECRETO_JWT = 'secreto-largo-y-aleatorio-para-la-prueba-2fa';

/** Contexto de ejecución mínimo con una cabecera Authorization. */
function contextoCon(token: string): any {
  const req = { header: (n: string) => (n === 'Authorization' ? `Bearer ${token}` : undefined) };
  return { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) };
}

async function main(): Promise<number> {
  const jwt = new JwtService({ secret: SECRETO_JWT, signOptions: { expiresIn: '8h' } });
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? SECRETO_JWT : undefined) } as ConfigService;

  const usuario: UsuarioEntity = {
    id: 'u-1', username: 'maria.gomez', nombre: 'María Gómez', rol: 'operador',
    tenant: 'envigado', activo: true, mfaIntentosFallidos: 0,
  } as UsuarioEntity;
  let configMfa: ConfigMfaEntity | null = null;

  const repoUsuarios = {
    findOne: async (o: any) => {
      const w = o?.where ?? {};
      if (w.id && w.id !== usuario.id) return null;
      if (w.activo === true && !usuario.activo) return null;
      return usuario;
    },
    save: async (u: UsuarioEntity) => { Object.assign(usuario, u); return usuario; },
  } as unknown as Repository<UsuarioEntity>;

  const repoConfig = {
    findOne: async () => configMfa,
    create: (d: Partial<ConfigMfaEntity>) => ({ ...d }) as ConfigMfaEntity,
    save: async (c: ConfigMfaEntity) => { configMfa = c; return c; },
  } as unknown as Repository<ConfigMfaEntity>;

  const mfa = new MfaService(repoUsuarios, repoConfig, jwt, config);
  // Reflector que dice «este endpoint no es público», para que el guard valide.
  const guard = new JwtAuthGuard(jwt, { getAllAndOverride: () => false } as unknown as Reflector);

  // ── 1. EL SALTO DEL SEGUNDO FACTOR ────────────────────────────────────
  console.log('\n1. Los tokens intermedios NO sirven como sesión');
  const reto = mfa.firmarReto(usuario.id);

  afirmar(!!jwt.verify(reto), 'el token del reto es un JWT válido y bien firmado');
  await lanza(async () => guard.canActivate(contextoCon(reto)),
    'pero el guard lo RECHAZA como sesión (sin esto, el 2FA se salta entero)');

  const inicio = await mfa.iniciarInscripcion(reto);
  await lanza(async () => guard.canActivate(contextoCon(inicio.inscripcion)),
    'el guard también rechaza el token de inscripción');

  // Control: un token de sesión de verdad sí pasa. Si esto fallara, el rechazo
  // de arriba no probaría nada —estaría rechazando todo—.
  const sesion = jwt.sign({ sub: 'maria.gomez', tipo: 'institucional', rol: 'operador', permisos: [], tenant: 'envigado' });
  afirmar(guard.canActivate(contextoCon(sesion)) === true, 'un token de sesión normal SÍ pasa');

  // ── 2. El secreto no se guarda hasta confirmar ─────────────────────────
  console.log('\n2. El secreto no se guarda hasta que el usuario demuestra que lo escaneó');
  afirmar(!usuario.mfaSecreto, 'tras mostrar el QR, el usuario SIGUE sin secreto guardado');
  afirmar(inicio.otpauth.startsWith('otpauth://totp/FALCON%20CAD:maria.gomez%40envigado'),
    'el URI identifica la cuenta como usuario@instancia');
  afirmar(inicio.claveManual.length === 32, 'entrega la clave manual para teclearla');
  afirmar(inicio.otpauth.includes(inicio.claveManual), 'el QR y la clave manual son el mismo secreto');

  const otro = await mfa.iniciarInscripcion(reto);
  afirmar(otro.claveManual !== inicio.claveManual,
    'volver a abrir el QR genera un secreto NUEVO (no revive uno abandonado)');

  console.log('\n3. Confirmación del enrolamiento');
  await lanza(() => mfa.confirmarInscripcion(inicio.inscripcion, '000000'),
    'un código incorrecto no enrola');
  afirmar(!usuario.mfaSecreto, 'y sigue sin guardar nada');

  const codigo = codigoDeContador(inicio.claveManual, contadorDe());
  const id = await mfa.confirmarInscripcion(inicio.inscripcion, codigo);
  afirmar(id === usuario.id, 'con el código correcto, devuelve el id del usuario');
  afirmar(!!usuario.mfaSecreto, 'ahora sí guarda el secreto');
  afirmar(usuario.mfaSecreto !== inicio.claveManual, 'y lo guarda CIFRADO, no en claro');
  afirmar(!!usuario.mfaActivadoEn, 'deja constancia de cuándo se activó');

  // ── 4. Verificación y reutilización ────────────────────────────────────
  console.log('\n4. Verificación del código');
  usuario.mfaIntentosFallidos = 0;
  const reto2 = mfa.firmarReto(usuario.id);
  await lanza(() => mfa.verificar(reto2, codigo),
    'el MISMO código NO vale dos veces (ya se usó al enrolar)');

  const siguiente = codigoDeContador(inicio.claveManual, contadorDe() + 1);
  usuario.mfaIntentosFallidos = 0; usuario.mfaBloqueoHasta = null;
  afirmar(await mfa.verificar(mfa.firmarReto(usuario.id), siguiente) === usuario.id,
    'el código del paso siguiente sí vale');
  await lanza(() => mfa.verificar(mfa.firmarReto(usuario.id), siguiente),
    'y tampoco se puede reutilizar');

  // ── 5. Bloqueo por intentos ────────────────────────────────────────────
  console.log('\n5. Bloqueo tras cinco códigos fallidos');
  usuario.mfaIntentosFallidos = 0; usuario.mfaBloqueoHasta = null; usuario.mfaUltimoContador = null;
  for (let i = 1; i <= 4; i++) {
    try { await mfa.verificar(mfa.firmarReto(usuario.id), '000000'); } catch { /* esperado */ }
  }
  afirmar(!usuario.mfaBloqueoHasta, 'cuatro fallos todavía no bloquean');
  try { await mfa.verificar(mfa.firmarReto(usuario.id), '000000'); } catch { /* el quinto */ }
  const bloqueo = usuario.mfaBloqueoHasta as Date | null | undefined;
  afirmar(!!bloqueo && bloqueo > new Date(), 'el quinto bloquea');

  const bueno = codigoDeContador(inicio.claveManual, contadorDe());
  const msg = await lanza(() => mfa.verificar(mfa.firmarReto(usuario.id), bueno),
    'bloqueado, ni el código correcto entra');
  afirmar(/minuto/.test(msg), `y le dice cuánto falta ("${msg}")`);

  // ── 6. Reto caducado y token ajeno ─────────────────────────────────────
  console.log('\n6. Tokens que no deben servir');
  usuario.mfaBloqueoHasta = null; usuario.mfaIntentosFallidos = 0;
  const vencido = jwt.sign({ sub: usuario.id, uso: 'mfa', fase: 'reto' }, { expiresIn: '-1s' });
  await lanza(() => mfa.verificar(vencido, bueno), 'un reto vencido no sirve');
  const ajeno = jwt.sign({ sub: usuario.id, uso: 'mfa', fase: 'reto' }, { secret: 'otra-llave' });
  await lanza(() => mfa.verificar(ajeno, bueno), 'un reto firmado con otra llave no sirve');
  const sesionComoReto = jwt.sign({ sub: usuario.id, tipo: 'institucional' });
  await lanza(() => mfa.verificar(sesionComoReto, bueno), 'un token de sesión no sirve como reto');

  // ── 7. Exención e interruptores ────────────────────────────────────────
  console.log('\n7. Exención del superadministrador e interruptores');
  afirmar(mfa.exento('superadmin') === true, 'el superadministrador está exento');
  afirmar(mfa.exento('operador') === false, 'un operador no');
  afirmar(mfa.exento('admin') === false, 'un administrador de instancia tampoco');

  afirmar(await mfa.exigido() === true, 'sin configurar, el 2FA se exige');
  await mfa.guardarConfig(false, 'superadmin');
  afirmar(await mfa.exigido() === false, 'desactivado desde Plataforma, no se exige');
  await mfa.guardarConfig(true, 'superadmin');
  afirmar(await mfa.exigido() === true, 'y se puede volver a activar');

  const conEntorno = new MfaService(repoUsuarios, repoConfig, jwt,
    { get: (k: string) => (k === 'JWT_SECRET' ? SECRETO_JWT : k === 'MFA_OBLIGATORIO' ? 'false' : undefined) } as ConfigService);
  afirmar(await conEntorno.exigido() === false,
    'MFA_OBLIGATORIO=false apaga el 2FA aunque Plataforma lo exija');
  afirmar((await conEntorno.verConfig()).forzadoPorEntorno === true,
    'y la pantalla puede avisar de que lo apagó el entorno');

  // ── 8. Los DTO contra el ValidationPipe REAL ──────────────────────────
  //
  // `main.ts` usa whitelist: true, que BORRA toda propiedad sin decorador de
  // validación. Un DTO sin decoradores llega al controlador con todos los
  // campos en undefined y el doble factor falla entero, con un mensaje que no
  // apunta a nada. Pasó en producción. Se prueba con el pipe de verdad, con
  // las mismas opciones que el arranque, porque es la única forma de que esto
  // no vuelva a colarse.
  console.log('\n8. Los campos sobreviven al ValidationPipe');
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const pasar = async (metatype: new () => object, cuerpo: Record<string, string>) =>
    (await pipe.transform(cuerpo, { type: 'body', metatype })) as Record<string, unknown>;

  const conf = await pasar(ConfirmarMfaDto,
    { reto: 'r-1', inscripcion: 'i-1', codigo: '123456' });
  afirmar(conf['reto'] === 'r-1' && conf['inscripcion'] === 'i-1' && conf['codigo'] === '123456',
    'ConfirmarMfaDto conserva reto, inscripcion y codigo');

  const ver = await pasar(VerificarMfaDto, { reto: 'r-2', codigo: '654321' });
  afirmar(ver['reto'] === 'r-2' && ver['codigo'] === '654321',
    'VerificarMfaDto conserva reto y codigo');

  const ins = await pasar(InscripcionMfaDto, { reto: 'r-3' });
  afirmar(ins['reto'] === 'r-3', 'InscripcionMfaDto conserva reto');

  // Y que siga filtrando lo que no declaró: para eso está el whitelist.
  const colado = await pasar(VerificarMfaDto, { reto: 'r', codigo: '1', intruso: 'x' });
  afirmar(colado['intruso'] === undefined, 'y sigue descartando campos no declarados');

  // ── 9. Restablecer ─────────────────────────────────────────────────────
  console.log('\n9. Restablecer el enrolamiento');
  await mfa.restablecer(usuario.id);
  afirmar(!usuario.mfaSecreto && !usuario.mfaActivadoEn, 'queda sin secreto, listo para volver a enrolarse');
  afirmar(usuario.mfaIntentosFallidos === 0 && !usuario.mfaBloqueoHasta, 'y sin bloqueo arrastrado');

  console.log(fallos.length ? `\n✗ ${fallos.length} fallo(s):` : '\n✓ Todo bien');
  fallos.forEach((f) => console.log(`   - ${f}`));
  return fallos.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
