// Una ventana ajustada a cada pantalla: la tarjeta llena el encuadre sin
// recortes ni fondo sobrante. Más fiable que adivinar la caja de la tarjeta,
// que resultó ser el formulario interno y cortaba el título y el pie.
const { chromium } = require('/tmp/claude-0/-home-user/66d52dd1-f3d0-5470-9923-d11ebc5098b7/scratchpad/manual/node_modules/playwright-core');
const SALIDA = '/tmp/claude-0/-home-user/66d52dd1-f3d0-5470-9923-d11ebc5098b7/scratchpad/manual/capturas';

async function tomar(n, { ancho, alto, nombre, antes }) {
  const ctx = await n.newContext({ viewport: { width: ancho, height: alto }, locale: 'es-CO', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:4200/login', { waitUntil: 'networkidle', timeout: 60_000 });
  await p.waitForTimeout(2200);
  if (antes) await antes(p);
  await p.screenshot({ path: `${SALIDA}/${nombre}.png` });
  console.log(`  ✔ ${nombre} (${ancho}×${alto})`);
  await ctx.close();
}

(async () => {
  const n = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors', '--force-color-profile=srgb'] });

  await tomar(n, { ancho: 720, alto: 560, nombre: '01-login' });

  await tomar(n, { ancho: 720, alto: 760, nombre: '13-doble-factor', antes: async p => {
    await p.getByLabel(/usuario/i).fill('supervisor1');
    await p.getByLabel(/contrase/i).fill('demo');
    await p.getByRole('button', { name: /ingresar/i }).click();
    await p.waitForTimeout(3500);
  }});

  await n.close();
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
