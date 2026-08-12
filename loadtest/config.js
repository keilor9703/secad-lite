function num(name, def) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? Number(v) : def;
}

module.exports = {
  // URL base del backend a probar. NUNCA apuntar esto a producción.
  baseUrl: process.env.LOADTEST_BASE_URL || 'http://localhost:3000',

  // Credenciales del superadmin (necesario para crear tenants/usuarios de prueba).
  superadminUser: process.env.LOADTEST_SUPERADMIN_USER || 'superadmin',
  superadminPass: process.env.LOADTEST_SUPERADMIN_PASS || 'demo',

  // Todos los tenants de prueba llevan este prefijo, para poder identificarlos
  // y limpiarlos después sin tocar tenants reales.
  tenantPrefix: process.env.LOADTEST_TENANT_PREFIX || 'carga',

  tenants: num('LOADTEST_TENANTS', 20),
  operatorsPerTenant: num('LOADTEST_OPERATORS_PER_TENANT', 3),

  // Duración de la fase de carga (una vez conectados todos los operadores).
  durationSec: num('LOADTEST_DURATION_SEC', 600),
  // Tiempo para ir conectando los sockets gradualmente en vez de todos de golpe.
  rampUpSec: num('LOADTEST_RAMPUP_SEC', 60),

  // Ritmo de trabajo simulado, por tenant.
  casesPerTenantPerMin: num('LOADTEST_CASES_PER_TENANT_PER_MIN', 6),
  callsPerTenantPerMin: num('LOADTEST_CALLS_PER_TENANT_PER_MIN', 10),

  // /auth/login tiene @Throttle(5 por minuto por IP). Dejamos margen: 4/min.
  loginMaxPerMinute: num('LOADTEST_LOGIN_MAX_PER_MIN', 4),

  password: process.env.LOADTEST_PASSWORD || 'CargaPrueba123',

  statePath: process.env.LOADTEST_STATE_PATH || `${__dirname}/.state/tenants.json`,
};
