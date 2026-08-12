/**
 * Aprovisiona N tenants de prueba (con usuarios y API key de PBX) contra un
 * ambiente de FALCON CAD, y guarda el resultado (tokens incluidos) en
 * .state/tenants.json para que run.js pueda generar carga sin repetir esto.
 *
 * Uso:
 *   LOADTEST_BASE_URL=https://staging.example.com LOADTEST_SUPERADMIN_PASS=... node setup.js
 *
 * Los tokens (JWT_EXPIRES, típicamente 8h) se reutilizan mientras no venzan:
 * no hace falta correr setup.js antes de cada run.js dentro del mismo turno.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { LoginPacer } = require('./lib/pacer');

const api = axios.create({ baseURL: `${config.baseUrl}/api`, validateStatus: () => true });
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

async function login(usuario, contrasena) {
  const res = await api.post('/auth/login', { usuario, contrasena });
  if (res.status >= 300) {
    throw new Error(`Login falló para "${usuario}": HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.token;
}

function fail(mensaje, res) {
  throw new Error(`${mensaje}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
}

async function main() {
  console.log(`FALCON CAD — aprovisionamiento de prueba de carga`);
  console.log(`Base: ${config.baseUrl}`);
  console.log(`Tenants: ${config.tenants}, operadores por tenant: ${config.operatorsPerTenant}\n`);

  if (/onrender\.com|vercel\.app/.test(config.baseUrl) && !process.env.LOADTEST_CONFIRMO_STAGING) {
    console.error(
      'El LOADTEST_BASE_URL apunta a un dominio que podría ser el ambiente real.\n' +
        'Si es staging y estás seguro, vuelve a correr con LOADTEST_CONFIRMO_STAGING=1.\n' +
        'NUNCA corras esto contra el ambiente con datos reales de ciudadanos.',
    );
    process.exit(1);
  }

  const superToken = await login(config.superadminUser, config.superadminPass);
  console.log('Sesión de superadmin OK.\n');

  const tenants = [];
  for (let i = 1; i <= config.tenants; i++) {
    const codigo = `${config.tenantPrefix}-${String(i).padStart(2, '0')}`;
    const nombre = `Carga de prueba ${i}`;
    process.stdout.write(`[${i}/${config.tenants}] tenant ${codigo}... `);

    const resT = await api.post('/tenants', { codigo, nombre }, auth(superToken));
    if (resT.status >= 300 && resT.status !== 409) fail(`No se pudo crear el tenant ${codigo}`, resT);
    console.log(resT.status === 409 ? 'ya existía' : 'creado');

    const adminUser = `${codigo}-admin`;
    const resAdmin = await api.post(
      '/usuarios',
      { username: adminUser, contrasena: config.password, nombre: 'Admin de prueba', rol: 'admin', tenant: codigo },
      auth(superToken),
    );
    if (resAdmin.status >= 300 && resAdmin.status !== 409) fail(`No se pudo crear ${adminUser}`, resAdmin);

    const operadores = [];
    for (let o = 1; o <= config.operatorsPerTenant; o++) {
      const username = `${codigo}-op${o}`;
      const extension = String(1000 + i * 10 + o);
      const res = await api.post(
        '/usuarios',
        { username, contrasena: config.password, nombre: `Operador de prueba ${o}`, rol: 'operador', tenant: codigo, extension },
        auth(superToken),
      );
      if (res.status >= 300 && res.status !== 409) fail(`No se pudo crear ${username}`, res);
      operadores.push({ username, extension });
    }

    tenants.push({ codigo, adminUser, operadores });
  }

  console.log(`\nIniciando sesión con cada usuario (máx. ${config.loginMaxPerMinute}/min, por el límite de intentos de login)...`);
  const pacer = new LoginPacer(config.loginMaxPerMinute);
  let hechos = 0;
  const totalLogins = tenants.length * (1 + config.operatorsPerTenant);

  for (const t of tenants) {
    await pacer.wait();
    const adminToken = await login(t.adminUser, config.password);
    hechos++;
    process.stdout.write(`\r  sesiones iniciadas: ${hechos}/${totalLogins}   `);

    const resRotar = await api.post('/pbx/config/rotar', {}, auth(adminToken));
    if (resRotar.status >= 300) fail(`No se pudo rotar la API key de PBX de ${t.codigo}`, resRotar);
    t.pbxApiKey = resRotar.data.apiKey;

    t.operadoresConToken = [];
    for (const op of t.operadores) {
      await pacer.wait();
      const token = await login(op.username, config.password);
      hechos++;
      process.stdout.write(`\r  sesiones iniciadas: ${hechos}/${totalLogins}   `);
      t.operadoresConToken.push({ ...op, token });
    }
  }
  console.log('\n');

  fs.mkdirSync(path.dirname(config.statePath), { recursive: true });
  fs.writeFileSync(
    config.statePath,
    JSON.stringify({ generadoEn: new Date().toISOString(), baseUrl: config.baseUrl, tenants }, null, 2),
  );
  console.log(`Listo. Estado guardado en ${config.statePath}`);
  console.log(`Ahora corre: LOADTEST_BASE_URL=${config.baseUrl} npm run run`);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
