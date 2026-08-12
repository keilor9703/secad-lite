/**
 * Genera carga contra un ambiente ya aprovisionado por setup.js:
 *  - conecta operadores por Socket.IO (namespace /pbx), como en el navegador real
 *  - crea casos (POST /api/casos) a un ritmo configurable, por tenant
 *  - simula llamadas entrantes/colgadas (POST /api/pbx/webhook) a un ritmo configurable
 *
 * Mide, por separado:
 *  - latencia HTTP de creación de casos
 *  - latencia HTTP del webhook de PBX
 *  - latencia de ENTREGA en vivo: desde que se manda el webhook "entrante" hasta que
 *    el operador destinatario recibe el evento por su socket (el aviso dirigido que
 *    se corrigió en la sesión anterior) — esta es la métrica que más le importa a
 *    un sistema de despacho: cuánto tarda un operador en enterarse de una llamada.
 *
 * Uso:
 *   LOADTEST_BASE_URL=https://staging.example.com node run.js
 */
const fs = require('fs');
const { io } = require('socket.io-client');
const axios = require('axios');
const config = require('./config');
const { sleep } = require('./lib/pacer');
const { Muestreador, imprimirResumen } = require('./lib/stats');

const api = axios.create({ baseURL: `${config.baseUrl}/api`, validateStatus: () => true });

function cargarEstado() {
  if (!fs.existsSync(config.statePath)) {
    console.error(`No existe ${config.statePath}. Corre primero: npm run setup`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(config.statePath, 'utf8'));
}

async function main() {
  const estado = cargarEstado();
  const tenants = estado.tenants;
  console.log(`FALCON CAD — prueba de carga`);
  console.log(`Base: ${config.baseUrl}`);
  console.log(`Tenants: ${tenants.length}, operadores/tenant: ${tenants[0]?.operadoresConToken?.length ?? 0}`);
  console.log(`Duración: ${config.durationSec}s (+ ${config.rampUpSec}s de ramp-up)`);
  console.log(`Ritmo por tenant: ${config.casesPerTenantPerMin} casos/min, ${config.callsPerTenantPerMin} llamadas/min\n`);

  // --- métricas ------------------------------------------------------------
  const mHttpCasos = new Muestreador('POST /casos (HTTP)');
  const mHttpWebhookEntrante = new Muestreador('POST /pbx/webhook entrante (HTTP)');
  const mHttpWebhookColgada = new Muestreador('POST /pbx/webhook colgada (HTTP)');
  const mEntregaDirigida = new Muestreador('Entrega en vivo — aviso dirigido');
  const mEntregaBroadcast = new Muestreador('Entrega en vivo — cambio de estado');
  let socketsConectados = 0;
  let socketsFallidos = 0;

  const pendienteEntrante = new Map(); // callId -> { enviadoEn }
  const pendienteCambio = new Map(); // callId -> { enviadoEn }
  const TIMEOUT_ENTREGA_MS = 15_000;

  // --- conectar operadores por Socket.IO, con ramp-up -----------------------
  const sockets = [];
  const sesiones = [];
  for (const t of tenants) {
    for (const op of t.operadoresConToken) sesiones.push({ tenant: t.codigo, ...op });
  }
  const pasoMs = sesiones.length ? (config.rampUpSec * 1000) / sesiones.length : 0;

  console.log(`Conectando ${sesiones.length} operadores (ramp-up ${config.rampUpSec}s)...`);
  for (const s of sesiones) {
    const socket = io(`${config.baseUrl}/pbx`, {
      auth: { token: s.token },
      transports: ['websocket'],
      reconnection: true,
    });
    socket.on('connect', () => {
      socketsConectados++;
    });
    socket.on('connect_error', (err) => {
      socketsFallidos++;
      console.error(`  socket ${s.tenant}/${s.username}: ${err.message}`);
    });
    socket.on('llamada:entrante', (llamada) => {
      const p = pendienteEntrante.get(llamada.callId);
      if (p) {
        mEntregaDirigida.registrar(Date.now() - p.enviadoEn);
        pendienteEntrante.delete(llamada.callId);
      }
    });
    socket.on('llamada:cambio', (llamada) => {
      const p = pendienteCambio.get(llamada.callId);
      if (p) {
        mEntregaBroadcast.registrar(Date.now() - p.enviadoEn);
        pendienteCambio.delete(llamada.callId);
      }
    });
    sockets.push(socket);
    await sleep(pasoMs);
  }
  await sleep(1500); // deja asentar las conexiones antes de medir
  console.log(`Conectados: ${socketsConectados}/${sesiones.length} (fallidos: ${socketsFallidos})\n`);

  // --- generadores de carga --------------------------------------------------
  let callSeq = 0;
  const timers = [];

  function programar(fn, intervalMs) {
    const jitter = Math.random() * intervalMs;
    const id = setTimeout(function tick() {
      fn().catch((e) => console.error(`  error en tarea programada: ${e.message}`));
      timers.push(setTimeout(tick, intervalMs));
    }, jitter);
    timers.push(id);
  }

  for (const t of tenants) {
    if (config.casesPerTenantPerMin > 0) {
      let opIdx = 0;
      programar(async () => {
        const op = t.operadoresConToken[opIdx++ % t.operadoresConToken.length];
        const inicio = Date.now();
        const res = await api.post(
          '/casos',
          { canal: 'llamada', ciudadano: 'Carga de prueba', titulo: 'Caso sintético de prueba de carga' },
          { headers: { Authorization: `Bearer ${op.token}` } },
        );
        if (res.status >= 200 && res.status < 300) mHttpCasos.registrar(Date.now() - inicio);
        else mHttpCasos.registrarError();
      }, 60_000 / config.casesPerTenantPerMin);
    }

    if (config.callsPerTenantPerMin > 0) {
      let opIdx = 0;
      programar(async () => {
        const op = t.operadoresConToken[opIdx++ % t.operadoresConToken.length];
        const callId = `lt-${t.codigo}-${++callSeq}-${Date.now()}`;
        const numero = `300${Math.floor(1000000 + Math.random() * 8999999)}`;

        let inicio = Date.now();
        pendienteEntrante.set(callId, { enviadoEn: inicio });
        const resEntrante = await api.post(
          '/pbx/webhook',
          { evento: 'entrante', callId, numero, extension: op.extension },
          { headers: { 'x-api-key': t.pbxApiKey } },
        );
        if (resEntrante.status >= 200 && resEntrante.status < 300) mHttpWebhookEntrante.registrar(Date.now() - inicio);
        else {
          mHttpWebhookEntrante.registrarError();
          pendienteEntrante.delete(callId);
        }
        setTimeout(() => {
          if (pendienteEntrante.delete(callId)) { /* nunca llegó: se descarta, no cuenta como muestra */ }
        }, TIMEOUT_ENTREGA_MS);

        // simula el tiempo que timbra antes de colgar (nadie la atiende: es tráfico sintético)
        await sleep(1000 + Math.random() * 3000);

        inicio = Date.now();
        pendienteCambio.set(callId, { enviadoEn: inicio });
        const resColgada = await api.post(
          '/pbx/webhook',
          { evento: 'colgada', callId },
          { headers: { 'x-api-key': t.pbxApiKey } },
        );
        if (resColgada.status >= 200 && resColgada.status < 300) mHttpWebhookColgada.registrar(Date.now() - inicio);
        else {
          mHttpWebhookColgada.registrarError();
          pendienteCambio.delete(callId);
        }
        setTimeout(() => pendienteCambio.delete(callId), TIMEOUT_ENTREGA_MS);
      }, 60_000 / config.callsPerTenantPerMin);
    }
  }

  console.log(`Generando carga durante ${config.durationSec}s...`);
  const inicioCarga = Date.now();
  await new Promise((resolve) => {
    const int = setInterval(() => {
      const transcurrido = (Date.now() - inicioCarga) / 1000;
      process.stdout.write(`\r  ${transcurrido.toFixed(0)}s / ${config.durationSec}s   `);
      if (transcurrido >= config.durationSec) {
        clearInterval(int);
        resolve();
      }
    }, 1000);
  });

  console.log('\n\nDeteniendo generadores y esperando entregas pendientes...');
  timers.forEach(clearTimeout);
  await sleep(TIMEOUT_ENTREGA_MS + 1000); // deja resolver las últimas correlaciones socket
  sockets.forEach((s) => s.disconnect());

  console.log('\n=== Resultado ===');
  console.log(`Operadores conectados: ${socketsConectados}/${sesiones.length} (fallidos: ${socketsFallidos})`);
  console.log(`Llamadas sin entrega dirigida confirmada (timeout ${TIMEOUT_ENTREGA_MS / 1000}s): ${pendienteEntrante.size}`);
  console.log(`Colgadas sin confirmación de cambio de estado: ${pendienteCambio.size}\n`);
  [mHttpCasos, mHttpWebhookEntrante, mHttpWebhookColgada, mEntregaDirigida, mEntregaBroadcast].forEach(imprimirResumen);

  console.log(
    '\nLectura rápida: la fila "Entrega en vivo — aviso dirigido" es la que más importa — es cuánto tarda un\n' +
      'operador en enterarse de una llamada real. Si su p95 crece con más tenants/operadores, ahí está el límite\n' +
      'real de la configuración actual, no en si el proceso "responde" o no.',
  );
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
