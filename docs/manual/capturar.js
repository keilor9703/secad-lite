// Capturas del sistema corriendo de verdad, para el manual de usuario.
// No hay maquetas: es la instancia local con los datos de demostración.
const { chromium } = require('/tmp/claude-0/-home-user/66d52dd1-f3d0-5470-9923-d11ebc5098b7/scratchpad/manual/node_modules/playwright-core');
const SALIDA = '/tmp/claude-0/-home-user/66d52dd1-f3d0-5470-9923-d11ebc5098b7/scratchpad/manual/capturas';
const RAIZ = 'http://127.0.0.1:4200';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// Ancho suficiente para que la barra de módulos no quede cortada en «Admin…».
const VENTANA = { width: 1600, height: 950 };

const esperar = (p, ms) => p.waitForTimeout(ms);

async function entrar(p, usuario, contrasena = 'demo') {
  await p.goto(`${RAIZ}/login`, { waitUntil: 'domcontentloaded' });
  await p.getByLabel(/usuario/i).fill(usuario);
  await p.getByLabel(/contrase/i).fill(contrasena);
  await p.getByRole('button', { name: /ingresar/i }).click();
  await p.waitForURL(u => !String(u).includes('/login'), { timeout: 30_000 });
  await esperar(p, 1800);
}

/** El combobox propio: botón con aria-label, lista de <li> con el texto. */
async function elegir(p, etiqueta, opcion) {
  await p.locator(`[aria-label="${etiqueta}"]`).first().click();
  await esperar(p, 400);
  // Un clic del DOM no basta: el componente escucha el puntero, no el click
  // sintético. force evita la espera de accionabilidad (lo tapa el flotante).
  await p.locator('[role=option]', { hasText: opcion }).first().click({ force: true });
  await esperar(p, 900);
}

async function tomar(p, nombre, { espera = 2200, completa = false } = {}) {
  await esperar(p, espera);
  await p.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: completa });
  console.log(`  ✔ ${nombre}`);
}

(async () => {
  const navegador = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors',
           '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const nuevoCtx = async () => {
    const ctx = await navegador.newContext({ viewport: VENTANA, locale: 'es-CO' });
    return [ctx, await ctx.newPage()];
  };

  // ── 01 · Inicio de sesión ────────────────────────────────────────────────
  {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 720 }, locale: 'es-CO' });
    const p = await ctx.newPage();
    await p.goto(`${RAIZ}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
    await tomar(p, '01-login', { espera: 2500 });
    await ctx.close();
  }

  // ── Recepción, con el operador ───────────────────────────────────────────
  {
    const [ctx, p] = await nuevoCtx();
    await entrar(p, 'operador1');
    await p.goto(`${RAIZ}/recepcion`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '02-recepcion');

    // El mismo formulario, diligenciado como en una llamada real.
    await p.getByPlaceholder(/nombre del llamante/i).fill('Luisa Restrepo');
    await p.getByPlaceholder(/abonado/i).fill('3104557821');
    await p.locator('input[placeholder="p. ej. 102"]').fill('102');
    await esperar(p, 1200);
    await p.getByPlaceholder(/lo que narra quien reporta/i)
      .fill('Dos sujetos en moto le arrebataron el bolso a una señora frente al parque y salieron hacia la calle 21. La señora está bien, no requiere ambulancia.');
    await p.getByPlaceholder(/escriba la direcci/i).fill('Parque principal');
    await esperar(p, 800);
    await tomar(p, '03-recepcion-diligenciada');
    await ctx.close();
  }

  // ── Despacho, consulta, panel, mapa, recursos, catálogos, administración ─
  {
    const [ctx, p] = await nuevoCtx();
    await entrar(p, 'admin1');

    await p.goto(`${RAIZ}/despacho`, { waitUntil: 'domcontentloaded' });
    await esperar(p, 1500);
    try {
      await elegir(p, 'Agencia', 'Policía Nacional');
      await elegir(p, 'Canal', 'PONAL');
    } catch (e) { console.log(`  (bandeja: ${e.message.slice(0, 90)})`); }
    await tomar(p, '04-despacho');

    // El detalle de un caso: la ficha donde se despacha, se remite y se cierra.
    const CASO = process.env.CASO_DEMO;
    if (CASO) {
      await p.goto(`${RAIZ}/caso/${CASO}`, { waitUntil: 'domcontentloaded' });
      await tomar(p, '05-detalle-caso', { espera: 3000 });
    }

    await p.goto(`${RAIZ}/casos`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '06-consulta');

    await p.goto(`${RAIZ}/dashboard`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '07-panel', { espera: 3500 });

    await p.goto(`${RAIZ}/mapa`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '08-mapa', { espera: 4000 });

    await p.goto(`${RAIZ}/recursos`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '09-recursos');

    await p.goto(`${RAIZ}/catalogos`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '10-catalogos');

    await p.goto(`${RAIZ}/admin`, { waitUntil: 'domcontentloaded' });
    await tomar(p, '11-administracion-roles');
    try {
      await p.getByRole('tab', { name: /usuarios/i }).click();
    } catch { await p.getByText(/^Usuarios$/).first().click().catch(() => {}); }
    await tomar(p, '12-administracion-usuarios');

    await ctx.close();
  }

  await navegador.close();
  console.log('listo');
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
