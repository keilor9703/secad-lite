import { environment } from '../../environments/environment';

/**
 * Configuración que se resuelve EN EL SERVIDOR, no al compilar.
 *
 * El TURN vivía dentro de `environment.prod.ts`, es decir dentro del código:
 * la credencial quedaba escrita en el repositorio y horneada en el paquete que
 * descarga el navegador. Con el repositorio público eso es una credencial
 * publicada; y aun en privado, cambiar de servidor TURN obligaba a recompilar
 * y redesplegar el frontend entero.
 *
 * Ahora sale de un archivo que sirve nginx y que el despliegue monta aparte
 * (`/config/runtime.json`). Cambiarlo es editar un archivo y recargar la
 * página: ni compilar, ni redesplegar, ni tocar el repositorio.
 *
 * Que la credencial llegue igual al navegador es inevitable —es quien
 * autentica el ALLOCATE contra el TURN— pero ya no está en el código fuente
 * ni se arrastra en el historial de git.
 */
export interface ConfigRuntime {
  /** `turn:host:3478?transport=udp`, etc. Vacío = solo STUN. */
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
  /** Para sustituir el STUN público por uno propio, si algún día hace falta. */
  stunUrls?: string[];
}

/** De dónde se lee. nginx la monta desde el despliegue; ver docs/MIGRACION.md. */
const RUTA = '/config/runtime.json';

/** Si nadie configura otro, el STUN público de Google. */
const STUN_POR_DEFECTO = ['stun:stun.l.google.com:19302'];

let config: ConfigRuntime = {};

/**
 * Carga el archivo antes de arrancar la aplicación.
 *
 * NO falla nunca: si el archivo no existe —desarrollo con `ng serve`, o un
 * despliegue que todavía no lo montó— se sigue con los valores por defecto.
 * Un CAD no puede negarse a arrancar porque falte un archivo de ajustes; sin
 * TURN la videollamada funciona igual en la mayoría de las redes, y lo que
 * haya que avisar se avisa por consola.
 */
export async function cargarConfigRuntime(): Promise<void> {
  try {
    const res = await fetch(RUTA, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = (await res.json()) as ConfigRuntime;
  } catch {
    config = {};
  }

  if (environment.production && !config.turnUrls?.length) {
    console.warn(
      `[config] Sin servidor TURN configurado en ${RUTA}. La videollamada puede ` +
      'quedarse en negro en redes móviles con NAT simétrico.');
  }
}

/**
 * Los servidores ICE de la videollamada, para los DOS extremos: la consola del
 * despachador y la página del ciudadano. Una sola fuente, para que no se
 * configure uno y se olvide el otro.
 */
export function iceServers(): RTCIceServer[] {
  // Compatibilidad: un despliegue que todavía no montó el archivo sigue
  // tomando lo que hubiera en `environment`.
  const legado = environment as Partial<ConfigRuntime>;
  const stun = config.stunUrls?.length ? config.stunUrls : STUN_POR_DEFECTO;
  const servers: RTCIceServer[] = [{ urls: stun }];

  const urls = config.turnUrls?.length ? config.turnUrls : legado.turnUrls;
  if (urls?.length) {
    servers.push({
      urls,
      username: config.turnUsername ?? legado.turnUsername,
      credential: config.turnCredential ?? legado.turnCredential,
    });
  }
  return servers;
}
