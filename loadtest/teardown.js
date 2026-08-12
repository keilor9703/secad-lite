/**
 * Desactiva (activo=false) todos los tenants de prueba creados por setup.js
 * (los que llevan el prefijo LOADTEST_TENANT_PREFIX). No los borra: la API no
 * tiene endpoint de borrado de tenants, a propósito (trazabilidad). Si quieres
 * quitarlos por completo de la base, hazlo a mano contra el ambiente de
 * staging, nunca contra producción.
 */
const axios = require('axios');
const config = require('./config');

const api = axios.create({ baseURL: `${config.baseUrl}/api`, validateStatus: () => true });

async function main() {
  const resLogin = await api.post('/auth/login', { usuario: config.superadminUser, contrasena: config.superadminPass });
  if (resLogin.status >= 300) throw new Error(`Login de superadmin falló: HTTP ${resLogin.status}`);
  const headers = { Authorization: `Bearer ${resLogin.data.token}` };

  const resList = await api.get('/tenants', { headers });
  if (resList.status >= 300) throw new Error(`No se pudo listar tenants: HTTP ${resList.status}`);

  const objetivo = (resList.data || []).filter((t) => t.codigo?.startsWith(`${config.tenantPrefix}-`));
  console.log(`Encontrados ${objetivo.length} tenants de prueba con prefijo "${config.tenantPrefix}-".`);

  for (const t of objetivo) {
    const res = await api.patch(`/tenants/${t.id}`, { activo: false }, { headers });
    console.log(`  ${t.codigo}: ${res.status < 300 ? 'desactivado' : `error HTTP ${res.status}`}`);
  }
  console.log('\nListo. Los tenants quedan desactivados (no borrados) — un login contra ellos ya no funcionará.');
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
