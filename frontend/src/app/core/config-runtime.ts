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
 * Credenciales firmadas por el backend, si las entregó.
 *
 * Son de vida corta: el backend las deriva de un secreto que comparte con
 * coturn y que nunca sale del servidor. Reemplazan a la credencial estática de
 * `runtime.json`, que viajaba en un archivo público y por lo tanto era, en los
 * hechos, una credencial publicada en internet.
 */
let firmados: RTCIceServer[] | null = null;
let firmadosVencenEn = 0;

/**
 * Guarda lo que entregó el backend. Lo llaman los dos extremos antes de crear
 * la RTCPeerConnection: el despachador desde `GET /videollamada/ice`, y el
 * ciudadano desde la respuesta del enlace público, que ya trae los suyos.
 *
 * `venceEn` viene en segundos unix. Si no viene, se le da un margen corto: es
 * preferible volver a pedirlas de más que arrancar una llamada con una
 * credencial que coturn ya rechaza.
 */
export function guardarIceFirmados(servers: RTCIceServer[] | undefined, venceEn?: number): void {
  // Solo se adoptan si traen un TURN autenticado.
  //
  // Un backend sin TURN_SECRET responde con una lista que NO está vacía: trae
  // el STUN. Mirar solo la longitud hacía que esa lista se adoptara como si
  // fueran credenciales firmadas, y el TURN desaparecía de la llamada. En
  // cualquier red con NAT cerrado eso es video en negro y sin audio — y no se
  // nota en WiFi, que es donde se prueba.
  if (!traeTurnAutenticado(servers)) return;
  firmados = servers!;
  firmadosVencenEn = venceEn ? venceEn * 1000 : Date.now() + 5 * 60_000;
}

/** ¿La lista trae un TURN con credencial, o es solo STUN? */
function traeTurnAutenticado(servers: RTCIceServer[] | undefined): boolean {
  return (servers ?? []).some((s) => {
    if (!s?.username || !s?.credential) return false;
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^turns?:/i.test(String(u ?? '')));
  });
}

/** Para la prueba y para el cierre de sesión: no dejar credenciales colgando. */
export function olvidarIceFirmados(): void {
  firmados = null;
  firmadosVencenEn = 0;
}

/** ¿Hay credenciales firmadas y todavía vigentes? */
export function hayIceFirmadosVigentes(ahora: number = Date.now()): boolean {
  // Un minuto de colchón: una credencial que vence durante el intercambio ICE
  // deja la llamada sin relevo a mitad de camino.
  return Boolean(firmados?.length) && ahora < firmadosVencenEn - 60_000;
}

/**
 * Los servidores ICE de la videollamada, para los DOS extremos: la consola del
 * despachador y la página del ciudadano. Una sola fuente, para que no se
 * configure uno y se olvide el otro.
 *
 * Orden de preferencia:
 *   1. lo que firmó el backend, mientras esté vigente;
 *   2. `runtime.json`, que es el respaldo mientras el despliegue no tenga
 *      configurado `TURN_SECRET`;
 *   3. `environment`, para un despliegue que todavía no montó el archivo.
 *
 * Los tres escalones existen a propósito: así este cambio se puede desplegar
 * sin coordinar el reinicio del backend con el de coturn, y sin que una
 * videollamada se quede sin relevo en el intervalo.
 */
export function iceServers(): RTCIceServer[] {
  if (hayIceFirmadosVigentes()) return firmados!;

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
