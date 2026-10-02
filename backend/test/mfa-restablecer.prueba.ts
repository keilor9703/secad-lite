/**
 * Restablecimiento administrativo del doble factor.
 *
 * Lo que de verdad se verifica aquí no es que borre el secreto, sino que un
 * administrador NO pueda tocar cuentas de otro municipio. Esta función es, por
 * definición, una llave para recuperar cuentas ajenas: si su guarda de
 * instancia falla, un administrador de un municipio puede dejar sin segundo
 * factor —y encaminar hacia sí— a usuarios de todos los demás.
 *
 *   npx ts-node test/mfa-restablecer.prueba.ts
 */
import 'reflect-metadata';
import { Repository } from 'typeorm';
import { UsuarioEntity } from '../src/usuarios/usuario.entity';
import { UsuariosService } from '../src/usuarios/usuarios.service';
import { RolesService } from '../src/roles/roles.service';
import { CatalogosService } from '../src/catalogos/catalogos.service';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}
async function lanza(fn: () => Promise<unknown>, que: string): Promise<string> {
  try { await fn(); afirmar(false, `${que} (no lanzó)`); return ''; }
  catch (e) { afirmar(true, que); return (e as Error).message; }
}

/** Una cuenta enrolada y bloqueada por intentos fallidos. */
const cuenta = (id: string, tenant: string | null): UsuarioEntity => ({
  id, tenant, username: `u-${id}`, nombre: 'Quien sea', rol: 'operador', activo: true,
  mfaSecreto: 'cifrado-xxxx', mfaActivadoEn: new Date(), mfaUltimoContador: '12345',
  mfaIntentosFallidos: 5, mfaBloqueoHasta: new Date(Date.now() + 900_000),
} as UsuarioEntity);

async function main(): Promise<number> {
  const base = new Map<string, UsuarioEntity>([
    ['e-1', cuenta('e-1', 'envigado')],
    ['a-1', cuenta('a-1', 'abejorral')],
    ['sin', { ...cuenta('sin', 'envigado'), mfaSecreto: null, mfaActivadoEn: null } as UsuarioEntity],
  ]);

  const repo = {
    findOne: async (o: any) => base.get(o?.where?.id) ?? null,
    save: async (u: UsuarioEntity) => { base.set(u.id, u); return u; },
  } as unknown as Repository<UsuarioEntity>;

  const servicio = new UsuariosService(repo, {} as RolesService, {} as CatalogosService);

  const admin = { sub: 'admin.envigado', rol: 'admin', tenant: 'envigado' } as never;
  const superadmin = { sub: 'superadmin', rol: 'superadmin', tenant: null } as never;

  // ── 1. La guarda de instancia ─────────────────────────────────────────
  console.log('\n1. Un administrador no alcanza otras instancias');
  const msg = await lanza(() => servicio.restablecerMfa(admin, 'a-1'),
    'el administrador de Envigado NO puede restablecer a un usuario de Abejorral');
  afirmar(/otro tenant/i.test(msg), `y lo dice con claridad ("${msg}")`);
  afirmar(!!base.get('a-1')?.mfaSecreto, 'la cuenta ajena conserva su doble factor intacto');

  console.log('\n2. Dentro de su instancia sí');
  const r = await servicio.restablecerMfa(admin, 'e-1');
  afirmar(r.username === 'u-e-1' && r.teniaMfa === true, 'devuelve a quién restableció y que sí tenía');
  const tras = base.get('e-1')!;
  afirmar(!tras.mfaSecreto && !tras.mfaActivadoEn, 'borra el secreto y la fecha de activación');
  afirmar(!tras.mfaUltimoContador, 'borra el último contador usado');
  afirmar(tras.mfaIntentosFallidos === 0 && !tras.mfaBloqueoHasta,
    'y levanta el bloqueo: quien llega aquí no debe esperar quince minutos más');

  console.log('\n3. El superadministrador alcanza cualquier instancia');
  const r2 = await servicio.restablecerMfa(superadmin, 'a-1');
  afirmar(r2.username === 'u-a-1', 'restablece a un usuario de Abejorral');
  afirmar(!base.get('a-1')?.mfaSecreto, 'y el secreto queda borrado');

  console.log('\n4. Casos de borde');
  const r3 = await servicio.restablecerMfa(admin, 'sin');
  afirmar(r3.teniaMfa === false, 'avisa cuando la cuenta no tenía doble factor');
  await lanza(() => servicio.restablecerMfa(admin, 'no-existe'), 'una cuenta inexistente no pasa');

  console.log(fallos.length ? `\n✗ ${fallos.length} fallo(s):` : '\n✓ Todo bien');
  fallos.forEach((f) => console.log(`   - ${f}`));
  return fallos.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
