import { AutenticacionTroncal } from './pbx-troncal.entity';
import { nombreContenedor } from './planta-asterisk.entity';
import { redesDe } from './pbx-troncal.entity';

/**
 * GENERAR LA CONFIGURACIÓN DE UNA PLANTA — de las filas de la base a los
 * archivos que lee Asterisk.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTO
 *
 * De `deploy/asterisk/*.plantilla`, que es lo que montamos a mano y lo que
 * está probado en una llamada real de punta a punta: entró por la troncal de
 * Infobip, timbró en el navegador y se escuchó por los dos lados. Esos
 * archivos se quedan como referencia, pero la verdad pasa a ser esta función:
 * una plantilla con huecos se llena a mano, y llenar a mano es donde se
 * equivoca uno —el puerto en el transporte que no era, el `match` vacío, la
 * clave en la línea de comandos—. Cada uno de esos tres fallos nos costó una
 * tarde y los tres están evitados aquí por construcción.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA FUNCIÓN PURA Y NO UN MÓDULO QUE ESCRIBE EN EL DISCO
 *
 * Porque así se puede PROBAR lo que se va a escribir sin un servidor, y se
 * puede MOSTRAR en pantalla antes de aplicarlo. Quien provisiona un municipio
 * tiene que poder leer lo que va a quedar instalado —y, cuando algo no
 * funcione, comparar lo generado contra lo que hay en el servidor— sin entrar
 * por SSH. Escribir y reiniciar es otro problema, de otro módulo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ÚNICO CAMBIO DELIBERADO RESPECTO A LO QUE YA FUNCIONA
 *
 * El transporte del navegador pasa de `wss` en el 8089 a `ws` en el 127.0.0.1,
 * detrás de nginx. No es un ajuste cosmético y conviene saber por qué:
 *
 *  - Con `wss` en Asterisk, cada planta necesita su puerto abierto en la nube
 *    Y su certificado. Eso es un trámite por municipio vendido.
 *  - Con nginx delante, hay UN certificado comodín y UN puerto (el 443, el
 *    único que una red corporativa o un celular en datos dejan pasar sin
 *    preguntar), y el nombre decide a qué planta entra cada operador.
 *
 * El audio NO pasa por nginx: el navegador negocia por ICE contra la IP
 * pública del servidor, igual que antes. Por eso `rtp.conf` sigue llevando
 * `stunaddr` —sin él, el navegador contesta y la llamada se cae a los pocos
 * segundos, que es exactamente el fallo que ya diagnosticamos—.
 */

/** Un archivo a instalar en la planta. */
export interface ArchivoGenerado {
  /** Ruta relativa a la carpeta de la planta en el servidor. */
  ruta: string;
  contenido: string;
  /**
   * Permisos en octal. En un servidor compartido, un archivo de configuración
   * legible por todos es un secreto publicado, así que:
   *
   *  - `644` lo que no tiene nada secreto (el dialplan, la cola, los puertos).
   *  - `600` lo que tiene secretos: las claves SIP de los operadores, la de la
   *    troncal, la de ARI y la API key del webhook. Asterisk los lee igual
   *    porque dentro de SU contenedor corre como root (ver
   *    `deploy/pbx/Dockerfile`); esa decisión es justamente la que permite el
   *    permiso más estricto sin que la planta se quede sin arrancar, que es
   *    una forma especialmente confusa de fallar.
   */
  modo: '600' | '644';
  /**
   * Si lleva algo secreto. Lo usa la pantalla para NO mostrar el contenido y
   * el registro de auditoría para no copiarlo.
   */
  secreto: boolean;
}

/** Un operador con su extensión, tal como se registra en el navegador. */
export interface OperadorPlanta {
  extension: string;
  /** Para el `callerid`: lo que ve quien recibe una llamada suya. */
  nombre: string;
  /** La clave SIP EN CLARO. Viene descifrada de `usuarios.sipClave`. */
  clave: string;
}

export interface TroncalPlanta {
  nombre: string;
  servidor: string;
  puerto: number;
  autenticacion: AutenticacionTroncal;
  usuario?: string | null;
  /** EN CLARO. Viene descifrada de `pbx_troncal.clave`. */
  clave?: string | null;
  redes?: string | null;
  /** El número que presenta al salir (E.164). Sin él, toda saliente es un 403. */
  numeroPresentado?: string | null;
}

export interface NumeroPlanta {
  numero: string;
  tipo: 'did' | 'corto';
  /** `cola` o una extensión. */
  destino: string;
}

export interface DatosPlanta {
  tenant: string;
  dominioSip: string;
  puertoSip: number;
  rtpDesde: number;
  rtpHasta: number;
  puertoHttp: number;
  /** La IP pública del servidor. Sin ella, audio de una sola vía. */
  ipPublica: string;
  operadores: OperadorPlanta[];
  troncales: TroncalPlanta[];
  numeros: NumeroPlanta[];
  /** La URL de FALCON a la que el dialplan avisa. */
  falconUrl: string;
  /** La API key de ESTA instancia, en claro. Va al archivo con modo 600. */
  apiKey: string;
  /** La clave del usuario `falcon` de ARI, para el botón «Llamar». */
  ariClave: string;
  /**
   * La IP de la interfaz real del servidor (`10.0.0.112`), la que tiene la
   * máquina de verdad. Vacío = no se toca nada y Asterisk decide.
   *
   * Hacen falta DOS cosas con ella, y las dos nos costaron una noche entera:
   *
   *  1. **El socket de audio del navegador.** Asterisk hereda la dirección
   *     del TRANSPORTE para abrir el socket RTP, y el transporte del
   *     WebSocket está en 127.0.0.1 —a propósito, porque el TLS lo pone
   *     nginx—. Resultado: el RTP de esa pata abría en 127.0.0.1, los
   *     paquetes del navegador rebotaban con «ICMP port unreachable» y
   *     Asterisk no podía enviar («Invalid argument»). La llamada entra,
   *     timbra, se contesta y NO SE OYE NADA de ningún lado.
   *  2. **El candidato ICE.** En una nube con NAT 1:1 la IP pública no está
   *     en ninguna interfaz, así que Asterisk solo podía ofrecer la privada,
   *     que el navegador no alcanza.
   *
   * Las dos se arreglan desde este campo, y por eso es uno solo.
   */
  ipPrivada?: string;
  /**
   * La IP del host por la que el nginx que termina el TLS alcanza a ESTA
   * planta. Vacío = `127.0.0.1`.
   *
   * No es un lujo: depende de DÓNDE corre ese nginx, y los dos casos existen
   * en el mismo servidor.
   *
   *  - **nginx en el host** (o en la red del host) → `127.0.0.1`. Lo más
   *    cerrado posible: el HTTP de la planta no sale de la máquina.
   *  - **nginx en un contenedor en red bridge** → la IP del host en el puente
   *    de Docker (`172.17.0.1` normalmente, se lee con
   *    `ip -4 addr show docker0`). Ahí `127.0.0.1` es el contenedor de nginx
   *    hablándose a sí mismo, y el síntoma es un 502 en el WebSocket y el
   *    botón «Llamar» del caso sin responder —sin una línea en ningún log que
   *    diga por qué—. Es exactamente lo que pasó en el primer servidor.
   *
   * Lo que NO vale es `0.0.0.0`: eso es ARI —con su clave— abierto al
   * internet si algún día se abre el puerto en la nube.
   */
  ipInterna?: string;
  /** Servidor STUN para el candidato público de Asterisk. */
  stun?: string;
  /** Segundos que timbra la cola antes de rendirse. */
  timbreCola?: number;
  /**
   * A dónde va la llamada cuando nadie en la sala contesta. Vacío = a ninguna
   * parte, y entonces se cae.
   *
   * Es la diferencia entre «no alcanzamos a contestar» y «nadie se enteró de
   * que había una llamada». En una línea de emergencia es lo único que no se
   * puede permitir, y por eso la llamada desbordada queda registrada COMO
   * desbordada y no como perdida.
   */
  numeroDesborde?: string;
  /**
   * El indicativo del país, sin «+». Vacío = 57.
   *
   * Lo usa el plan de marcación para completar un número nacional. Ver
   * `INDICATIVO_POR_DEFECTO` y el contexto `[salientes]` de `extensionsConf`.
   */
  indicativoPais?: string;
  /**
   * La carpeta de la planta en el servidor. La pone quien provisiona, para
   * que el script de instalación y lo que dice la pantalla no puedan
   * discrepar — un script que escribe en otra carpeta que la que se enseñó es
   * media hora buscando archivos.
   */
  carpeta?: string;
}

const STUN_POR_DEFECTO = 'stun.l.google.com:19302';
const IP_INTERNA_POR_DEFECTO = '127.0.0.1';

/** La IP interna de la planta, con el valor más cerrado por defecto. */
function interna(d: DatosPlanta): string {
  return d.ipInterna?.trim() || IP_INTERNA_POR_DEFECTO;
}

/** La IP de la interfaz real del servidor, o vacío si no se declaró. */
function privada(d: DatosPlanta): string {
  return d.ipPrivada?.trim() || '';
}

/**
 * ¿Hay que anunciar la pública en lugar de la privada en los candidatos ICE?
 *
 * Solo cuando las dos se conocen Y son distintas: si son iguales, la máquina
 * tiene su IP pública en la interfaz y no hay NAT que compensar — mapear ahí
 * sería anunciar lo mismo dos veces.
 */
function hayNat11(d: DatosPlanta): boolean {
  const p = privada(d);
  return !!p && !!d.ipPublica && p !== d.ipPublica;
}
const TIMBRE_COLA_POR_DEFECTO = 120;

/**
 * Colombia. Es el valor por defecto porque FALCON es un sistema nacional,
 * pero NO está clavado: cada planta puede traer el suyo.
 */
export const INDICATIVO_POR_DEFECTO = '57';

/** El indicativo de esta planta, sin «+» y solo dígitos. */
function indicativo(d: DatosPlanta): string {
  return (d.indicativoPais ?? '').replace(/\D/g, '') || INDICATIVO_POR_DEFECTO;
}

/**
 * Un número en E.164: dígitos con un «+» delante.
 *
 * NO inventa indicativo. Lo que entra sin él sale sin él, porque aquí no hay
 * forma de saber si `3175882321` es un celular colombiano o el fragmento de
 * algo más largo; eso lo decide el plan de marcación, que sí sabe de qué
 * planta se trata. Devuelve cadena vacía si no queda ningún dígito, que es
 * lo que la troncal usa para avisar que no hay número que presentar.
 */
function e164(crudo?: string | null): string {
  const digitos = (crudo ?? '').replace(/\D/g, '');
  return digitos ? `+${digitos}` : '';
}

/**
 * Todos los archivos de la planta, en el orden en que conviene leerlos.
 *
 * Las rutas son relativas a la carpeta de la planta en el servidor
 * (`/opt/falcon-pbx/<tenant>/`), y las de Asterisk van bajo `etc/` porque es
 * esa carpeta la que se monta en el contenedor como `/etc/asterisk`.
 */
export function generarConfiguracion(d: DatosPlanta): ArchivoGenerado[] {
  const archivos: ArchivoGenerado[] = [
    // pjsip.conf lleva las claves SIP de los operadores: no es un archivo
    // público, aunque el resto de su contenido lo sea.
    conClaves('etc/pjsip.conf', pjsipConf(d)),
    texto('etc/extensions.conf', extensionsConf(d)),
    texto('etc/queues.conf', queuesConf(d)),
    texto('etc/rtp.conf', rtpConf(d)),
    texto('etc/http.conf', httpConf(d)),
    texto('etc/asterisk.conf', asteriskConf(d)),
    texto('etc/logger.conf', loggerConf(d)),
    texto('etc/modules.conf', modulesConf()),
    conClaves('etc/falcon-webhook.conf', webhookConf(d)),
    conClaves('etc/falcon-api.conf', apiConf(d)),
    texto('etc/subir-grabacion.sh', subirGrabacionSh(d)),
    conClaves('etc/ari.conf', ariConf(d)),
    texto('docker-compose.yml', composeYml(d)),
    texto('imagen/Dockerfile', dockerfile()),
    texto(`nginx/${d.dominioSip}.conf`, nginxSite(d)),
  ];
  const troncal = troncalConf(d);
  // Un bloque de troncal con los campos vacíos NO es «una troncal apagada»:
  // es una configuración inválida que deja sin proteger el puerto SIP. En la
  // primera instalación real dejó un `match =` en blanco en el `identify`.
  // Así que si no hay datos, no hay archivo.
  if (troncal) {
    archivos.splice(1, 0, conClaves('etc/pjsip-troncal.conf', troncal));
  }
  // El script va de ÚLTIMO, y de último de verdad: lleva DENTRO a todos los
  // demás, así que se arma cuando la lista ya está completa —con la troncal
  // incluida—. Armarlo antes dejaba un script que instalaba la planta sin su
  // troncal, y eso no falla al aplicar: falla cuando entra la primera
  // llamada y no hay por dónde.
  archivos.push(conClaves('aplicar.sh', aplicarSh(d, archivos)));
  return archivos;
}

function texto(ruta: string, contenido: string): ArchivoGenerado {
  return { ruta, contenido, modo: '644', secreto: false };
}

/** Un archivo con credenciales que Asterisk tiene que poder leer. */
function conClaves(ruta: string, contenido: string): ArchivoGenerado {
  return { ruta, contenido, modo: '600', secreto: true };
}

/** El encabezado que lleva todo archivo generado, para que nadie lo edite a mano. */
function encabezado(d: DatosPlanta, archivo: string): string {
  return [
    ';',
    `; ${archivo} — planta de «${d.tenant}» (${d.dominioSip})`,
    ';',
    '; GENERADO POR FALCON. No lo edite aquí: el próximo provisionamiento lo',
    '; sobrescribe. Lo que haya que cambiar se cambia en FALCON, en Plataforma →',
    '; Planta telefónica, y se vuelve a aplicar.',
    ';',
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// pjsip.conf — transportes y extensiones
// ─────────────────────────────────────────────────────────────────────────────
function pjsipConf(d: DatosPlanta): string {
  const partes = [
    encabezado(d, 'pjsip.conf'),
    `;; ─────────────────────────────────────────────────────────────────────
;; DOS TRANSPORTES, PORQUE SON DOS MUNDOS
;;
;; El navegador del operador entra por WebSocket, y la troncal del operador
;; telefónico por UDP de toda la vida.
;;
;; El WebSocket va SIN cifrado y escuchando solo en 127.0.0.1: el TLS lo pone
;; nginx en el 443, que es el único puerto que una red corporativa o un
;; celular en datos dejan pasar sin preguntar. Así hay un certificado comodín
;; para todos los municipios en vez de uno por planta.
;; ─────────────────────────────────────────────────────────────────────────

[transport-ws]
type = transport
protocol = ws
bind = 127.0.0.1:${d.puertoHttp}

[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:${d.puertoSip}
;; SIN ESTAS DOS LÍNEAS: AUDIO DE UNA SOLA VÍA. Asterisk anunciaría su IP
;; privada en el SDP y el audio de vuelta no llega a ninguna parte.
external_media_address = ${d.ipPublica}
external_signaling_address = ${d.ipPublica}
;; Las redes de adentro, para que Asterisk sepa cuándo NO reescribir.
local_net = 10.0.0.0/8
local_net = 172.16.0.0/12
local_net = 192.168.0.0/16
`,
  ];

  if (!d.operadores.length) {
    partes.push(`
;; SIN OPERADORES TODAVÍA. En FALCON, a cada funcionario se le pone su
;; extensión y su clave SIP (Administración → Funcionarios); al volver a
;; aplicar, aparecen aquí.
`);
  }

  for (const op of d.operadores) {
    partes.push(`
;; ── Operador ${op.extension} ─────────────────────────────────────────────
;; «webrtc = yes» activa de un golpe lo que exige el navegador: ICE, DTLS,
;; rtcp-mux y AVPF. Sin eso el registro funciona y la llamada no suena.
;;
;; ULAW Y NO OPUS, y no es por simplificar: el paquete de Asterisk no trae el
;; codificador de Opus y la troncal entrega ulaw. Con opus primero, la llamada
;; entra, timbra, el operador contesta — y Asterisk la cuelga él mismo con un
;; «Unable to find a codec translation path: (opus) -> (ulaw)» que solo está
;; en el log. Ya nos pasó en la primera llamada real.
;;
;; Y «media_address» con «bind_rtp_to_media_address» no son adorno: sin ellos
;; Asterisk hereda la dirección del TRANSPORTE para abrir el socket de audio,
;; y este transporte está en 127.0.0.1 porque el TLS lo pone nginx. El RTP del
;; navegador abría entonces en 127.0.0.1: los paquetes del operador rebotaban
;; con «ICMP port unreachable», Asterisk no podía enviar («Error sending STUN
;; request: Invalid argument») y el DTLS nunca arrancaba. La llamada entra,
;; timbra, el operador contesta Y NO SE OYE NADA de ningún lado — sin un solo
;; mensaje que diga por qué. Costó una noche entera encontrarlo.
[${op.extension}]
type = endpoint
transport = transport-ws
webrtc = yes${
      privada(d)
        ? `
media_address = ${privada(d)}
bind_rtp_to_media_address = yes`
        : ''
    }
;; «internos» y NO «entrantes»: este contexto es lo que el operador puede
;; MARCAR desde su softphone, y lo único que debe poder marcar son sus
;; compañeros. Con «entrantes» compartía contexto con la troncal, así que todo
;; lo que la troncal alcanza lo alcanzaba también cualquiera con una clave SIP.
context = internos
disallow = all
allow = ulaw,alaw
auth = ${op.extension}
aors = ${op.extension}
callerid = ${limpiarCallerid(op.nombre)} <${op.extension}>

[${op.extension}]
type = auth
auth_type = userpass
username = ${op.extension}
password = ${op.clave}

[${op.extension}]
type = aor
max_contacts = 2        ; el operador puede tener dos pestañas abiertas
remove_existing = yes   ; y la tercera desplaza a la más vieja, no falla
`);
  }

  if (troncalConf(d)) partes.push('\n#include pjsip-troncal.conf\n');
  return partes.join('');
}

/** El `callerid` no admite comillas ni `<`: romperían la cabecera SIP. */
function limpiarCallerid(nombre: string): string {
  return (
    (nombre ?? '')
      .replace(/["<>;,]/g, ' ')
      .trim()
      .slice(0, 40) || 'Operador'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// pjsip-troncal.conf
// ─────────────────────────────────────────────────────────────────────────────
function troncalConf(d: DatosPlanta): string | null {
  const usables = d.troncales.filter((t) => t.servidor?.trim());
  if (!usables.length) return null;

  const partes = [encabezado(d, 'pjsip-troncal.conf')];
  usables.forEach((t, i) => {
    // La primera se llama «troncal» para que el dialplan de salientes no
    // tenga que saber de nombres; las demás llevan sufijo.
    const nombre = i === 0 ? 'troncal' : `troncal${i + 1}`;
    // CON el «+»: Infobip entrega y recibe en E.164, y `replace(/\D/g,'')`
    // —que es lo que había aquí— se lo comía. Salía `From: <sip:1833…>` en
    // vez de `<sip:+1833…>`, contra lo que dice el comentario de
    // `[salientes]` doce líneas más abajo. Medido el 20/10/2026.
    const did = e164(t.numeroPresentado);

    partes.push(`
;; ── ${t.nombre} ─────────────────────────────────────────────────────────
[${nombre}]
type = aor
contact = sip:${t.servidor}:${t.puerto}
;; Un OPTIONS cada minuto: así se sabe que la troncal está viva ANTES de que
;; entre una llamada y no después. Se ve con «pjsip show aors».
qualify_frequency = 60

[${nombre}]
type = endpoint
transport = transport-udp
context = entrantes
disallow = all
;; G729 no, aunque el operador lo ofrezca: el paquete no trae el codificador.
allow = ulaw,alaw
aors = ${nombre}${t.autenticacion !== 'ip' ? `\noutbound_auth = ${nombre}` : ''}${
      did
        ? `
;; QUIÉN DICE QUE LLAMA — sin esto, toda saliente es un 403. Visto con
;; Infobip: sin número de origen el \`From\` sale como «anonymous» y el
;; operador contesta 403 Forbidden sin más explicación.
from_user = ${did}
callerid = ${did} <${did}>`
        : `
;; OJO: sin número que presentar, las SALIENTES por esta troncal van a dar
;; 403. Registre el DID del municipio en FALCON y vuelva a aplicar.`
    }
;; El número de quien llama es el ÚNICO rastro del ciudadano. Sin esto, el
;; caso nace sin a quién devolverle la llamada.
trust_id_inbound = yes
;; NAT: contestar a donde llegó el paquete, no a lo que diga el SDP.
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes
direct_media = no
`);

    if (t.autenticacion !== 'ip' && t.usuario) {
      partes.push(`[${nombre}]
type = auth
auth_type = userpass
username = ${t.usuario}
password = ${t.clave ?? ''}
`);
    }
    if (t.autenticacion === 'registro' && t.usuario) {
      partes.push(`[${nombre}]
type = registration
transport = transport-udp
outbound_auth = ${nombre}
server_uri = sip:${t.servidor}:${t.puerto}
client_uri = sip:${t.usuario}@${t.servidor}
retry_interval = 60
`);
    }

    const redes = redesDe(t.redes);
    if (redes.length) {
      partes.push(`[${nombre}]
type = identify
endpoint = ${nombre}
;; SOLO estas redes pueden entregar llamadas por el puerto SIP. Sin esto,
;; cualquiera que lo encuentre puede cursar llamadas a costa del municipio.
${redes.map((r) => `match = ${r}`).join('\n')}
`);
    } else if (t.autenticacion === 'ip') {
      partes.push(`;; SIN REDES DECLARADAS no hay «identify», y una troncal estática sin
;; identify NO recibe: Asterisk no sabe que esas llamadas son de su
;; operador. Pídale al operador sus subredes de SBC y regístrelas en FALCON.
`);
    }
  });

  return partes.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// extensions.conf — el dialplan
// ─────────────────────────────────────────────────────────────────────────────
function extensionsConf(d: DatosPlanta): string {
  const timbre = d.timbreCola ?? TIMBRE_COLA_POR_DEFECTO;
  const cc = indicativo(d);
  const partes = [
    encabezado(d, 'extensions.conf'),
    `[general]
static = yes
writeprotect = yes

[globals]
;; La URL no es secreta. La API key SÍ, y por eso NO está aquí: va en
;; /etc/asterisk/falcon-webhook.conf, que curl lee con -K.
;;
;; El motivo es concreto y ya nos pasó: lo que se pasa en la línea de
;; \`System()\` aparece en la lista de procesos del servidor (\`ps aux\`),
;; visible para cualquier usuario de la máquina, y además queda escrito en el
;; log de Asterisk cada vez que entra una llamada. Una llave en el log es una
;; llave filtrada.
FALCON_URL = ${d.falconUrl.replace(/\/+$/, '')}
COLA = ${nombreCola(d.tenant)}
GRABACIONES = /var/spool/asterisk/monitor


[entrantes]
;; ─────────────────────────────────────────────────────────────────────────
;; A QUIÉN TIMBRARLE
;;
;; Entre extensiones, lo marcado ES la extensión. Pero la llamada del
;; CIUDADANO entra por el DID, y \`Dial(PJSIP/+18335308128)\` intenta llamar a
;; un endpoint que no existe: la llamada muere sin timbrar en ninguna parte y
;; en el log solo queda un «not found» que no se parece a su causa.
;;
;; Y van DOS patrones por cada número porque \`X\` significa «un dígito del 0
;; al 9» y el \`+\` no lo es: con solo \`_X.\`, un DID en E.164 —como lo manda
;; Infobip— no casa con nada y la central rechaza la llamada.
;; ─────────────────────────────────────────────────────────────────────────

;; Interna: 101, 102, 103…
exten => _1XX,1,Set(DESTINO=\${EXTEN})
 same => n,Goto(atender,s,1)
`,
  ];

  for (const n of d.numeros) {
    const digitos = n.numero.replace(/\D/g, '');
    if (!digitos) continue;
    const destino = n.destino?.trim() || 'cola';
    partes.push(`
;; ${n.numero}${destino === 'cola' ? ' → la cola de operadores' : ` → extensión ${destino}`}
exten => +${digitos},1,Set(DESTINO=${destino})
 same => n,Goto(atender,s,1)
exten => ${digitos},1,Set(DESTINO=${destino})
 same => n,Goto(atender,s,1)
`);
  }

  partes.push(`
;; ─────────────────────────────────────────────────────────────────────────
;; CUALQUIER OTRO NÚMERO TAMBIÉN ENTRA A LA COLA, y eso es a propósito.
;;
;; Lo estricto sería rechazar un número no registrado. En una línea de
;; emergencias, no: si al municipio le activan un DID nuevo y nadie lo
;; registró en FALCON todavía, la llamada tiene que timbrar igual. Un número
;; de más en la cola se arregla en un minuto; una llamada rechazada, no.
;; ─────────────────────────────────────────────────────────────────────────
exten => _+X.,1,Set(DESTINO=cola)
 same => n,Goto(atender,s,1)
exten => _X.,1,Set(DESTINO=cola)
 same => n,Goto(atender,s,1)


[atender]
;; ─────────────────────────────────────────────────────────────────────────
;; AVISARLE A FALCON Y TIMBRAR
;;
;; Aquí está el ahorro de todo el diseño: no hace falta un traductor de
;; eventos en FALCON, porque esto habla directamente su modelo contra el
;; webhook genérico —el mismo por donde entran las llamadas de YACO—.
;;
;; TRES COSAS QUE NO SON ADORNO:
;;
;;  1. El \`&\` del final y el \`-m 3\`. Sin ellos, si FALCON tarda en
;;     responder, el dialplan se queda esperando y EL TELÉFONO NO TIMBRA.
;;     Avisar nunca puede retrasar la llamada.
;;  2. \`\${UNIQUEID}\` es el callId, y es lo que ata el «entrante» con el
;;     «colgada» y con la llamada que el navegador ve por SIP.
;;  3. La extensión \`h\` corre SIEMPRE al colgar, conteste quien conteste y
;;     cuelgue quien cuelgue. Por eso el cierre va ahí y no después del Dial:
;;     con Zadarma se aprendió por las malas que colgar no cerraba la llamada
;;     en FALCON.
;;
;; EL AVISO NO LLEVA EXTENSIÓN CUANDO VA A LA COLA, y es correcto: todavía no
;; se sabe quién va a contestar. La barra de cada operador reconoce su llamada
;; por el número, y quien contesta primero la reclama.
;; ─────────────────────────────────────────────────────────────────────────
exten => s,1,NoOp(FALCON entrante \${CALLERID(num)} -> \${DESTINO} id=\${UNIQUEID})
 same => n,Set(CDR(userfield)=\${UNIQUEID})
 same => n,Set(AVISO_EXT=\${IF($["\${DESTINO}" = "cola"]?:\${DESTINO})})
 same => n,System(curl -s -m 3 -X POST \${FALCON_URL}/api/pbx/webhook -K /etc/asterisk/falcon-webhook.conf -d '{"evento":"entrante","callId":"\${UNIQUEID}","numero":"\${CALLERID(num)}","extension":"\${AVISO_EXT}"}' &)
;; ─────────────────────────────────────────────────────────────────────────
;; LA GRABACIÓN
;;
;; \`b\` graba solo cuando la llamada queda establecida: así no quedan cientos
;; de archivos de 0 segundos de llamadas que nadie contestó. El nombre lleva
;; el \${UNIQUEID}, que es el mismo identificador que FALCON guarda en la
;; llamada — es lo que permitirá adjuntarla al caso sin adivinar.
;; ─────────────────────────────────────────────────────────────────────────
 same => n,MixMonitor(\${GRABACIONES}/\${UNIQUEID}.wav,b,bash /etc/asterisk/subir-grabacion.sh ^{UNIQUEID})
 same => n,GotoIf($["\${DESTINO}" = "cola"]?cola:directo)

 same => n(cola),Queue(\${COLA},r,,,${timbre})
${desbordeDialplan(d)} same => n,Hangup()

 same => n(directo),Dial(PJSIP/\${DESTINO},30)
 same => n,Hangup()

;; Se cuelga: se cierra en FALCON. Pase lo que pase.
exten => h,1,NoOp(FALCON fin id=\${UNIQUEID} estado=\${DIALSTATUS}\${QUEUESTATUS})
 same => n,System(curl -s -m 3 -X POST \${FALCON_URL}/api/pbx/webhook -K /etc/asterisk/falcon-webhook.conf -d '{"evento":"colgada","callId":"\${UNIQUEID}"}' &)


${internosDialplan(d)}
[salientes]
;; ─────────────────────────────────────────────────────────────────────────
;; LO QUE SALE — el botón «Llamar» del caso
;;
;; ARI crea el canal del OPERADOR y, cuando descuelga, lo manda aquí para que
;; marque al ciudadano. Ese orden importa: si se llamara primero al ciudadano,
;; contestaría a un silencio mientras la central busca a un operador que puede
;; no estar en su puesto.
;;
;; La cola de un CAD es de lo que ENTRA, así que una saliente NO se avisa como
;; «entrante»: no debe aparecer en la cola de Recepción.
;; ─────────────────────────────────────────────────────────────────────────
;; Con «+», que es como lo manda FALCON y como lo espera la troncal: Infobip
;; entrega y recibe en E.164 con el «+».
exten => _+X.,1,NoOp(FALCON saliente hacia \${EXTEN})
 same => n,MixMonitor(\${GRABACIONES}/\${UNIQUEID}.wav,b)
 same => n,Dial(PJSIP/\${EXTEN}@troncal,60)
 same => n,Hangup()

;; Trae el indicativo del país pero sin «+»: solo hay que ponérselo.
exten => _${cc}X.,1,Goto(salientes,+\${EXTEN},1)

;; NACIONAL, sin indicativo. Es el caso NORMAL en operación: nadie teclea
;; «+57» en el campo Teléfono de un caso mientras toma una emergencia.
;;
;; Antes aquí solo se ponía el «+», y por eso un 3175882321 salía marcado como
;; «+3175882321», que no es E.164 de ningún país. Infobip contestó «484
;; Address Incomplete», con toda la razón. Medido el 20/10/2026.
;;
;; El patrón de arriba no se come ninguno de estos: en Colombia ningún
;; abonado nacional empieza por 57 —los celulares empiezan por 3 y los fijos
;; por 60—. En otro país con otro indicativo habría que revisarlo.
exten => _X.,1,Goto(salientes,+${cc}\${EXTEN},1)
`);

  return partes.join('');
}

/**
 * El tramo de desborde: qué pasa cuando la cola se agota sin que nadie conteste.
 *
 * Sin número de respaldo configurado no emite NADA, y la llamada se cae como
 * siempre. Es deliberado: marcar a un número vacío manda la llamada a un error
 * de la troncal en vez de a un timbre, que es peor que colgar.
 *
 * Se desborda en los tres finales en que la cola no entregó la llamada:
 *
 *  - `TIMEOUT`    — timbró y nadie contestó.
 *  - `JOINEMPTY`  — no había un solo operador conectado cuando entró.
 *  - `LEAVEEMPTY` — el último operador se desconectó mientras esperaba.
 *
 * Los tres últimos son los que de verdad asustan: la sala vacía de madrugada.
 * Tratarlos distinto sería dejar la llamada caer justo cuando el respaldo es
 * lo único que hay.
 *
 * El aviso a FALCON va ANTES de marcar, y con `&` como todos los demás: si
 * FALCON está caído, la llamada igual se desborda. La telefonía nunca espera
 * al software.
 */
function desbordeDialplan(d: DatosPlanta): string {
  const numero = (d.numeroDesborde ?? '').trim();
  if (!numero) return '';

  const aviso =
    `System(curl -s -m 3 -X POST \${FALCON_URL}/api/pbx/webhook ` +
    `-K /etc/asterisk/falcon-webhook.conf ` +
    `-d '{"evento":"desborde","callId":"\${UNIQUEID}","numeroDestino":"${numero}"}' &)`;

  return ` same => n,GotoIf($["\${QUEUESTATUS}" = "TIMEOUT"]?desborde)
 same => n,GotoIf($["\${QUEUESTATUS}" = "JOINEMPTY"]?desborde)
 same => n,GotoIf($["\${QUEUESTATUS}" = "LEAVEEMPTY"]?desborde)
 same => n,Hangup()

;; ─────────────────────────────────────────────────────────────────────────
;; EL DESBORDE — nadie en la sala contestó
;;
;; El aviso va ANTES de marcar y con «&»: si FALCON está caído, la llamada
;; igual se desborda. Y queda registrada COMO desbordada, no como perdida:
;; meterlas en el mismo cajón pierde la única señal que distingue «no
;; alcanzamos a contestar» de «nadie se enteró de que había una llamada».
;; ─────────────────────────────────────────────────────────────────────────
 same => n(desborde),NoOp(FALCON desborde id=\${UNIQUEID} motivo=\${QUEUESTATUS})
 same => n,${aviso}
 same => n,Dial(PJSIP/${numero}@troncal,60)
`;
}

/**
 * `[internos]` — lo que un operador puede marcar desde su softphone.
 *
 * Hoy solo una cosa: otro operador. Es lo que hace posible la transferencia, y
 * es deliberadamente todo lo que hay. Las extensiones de operador vivían en
 * `entrantes`, o sea en el mismo contexto que la troncal: cualquiera con una
 * clave SIP alcanzaba lo mismo que el operador telefónico. Un contexto propio
 * cierra eso sin pedirle nada a nadie.
 *
 * **Si el destino no contesta, la llamada VUELVE A LA COLA.** Una
 * transferencia ciega contra un puesto vacío es una llamada al 123 soltada al
 * aire, y eso no se puede permitir aunque el operador se haya equivocado de
 * compañero. Con el regreso, el peor caso de una transferencia errada es que
 * la llamada vuelva a timbrar en la sala — y si tampoco la toman ahí, sigue el
 * camino de siempre y se va al respaldo.
 *
 * El aviso a FALCON va ANTES de marcar y con `&`, como todos: es lo que hace
 * que el caso aparezca en la pantalla del que la recibe. Si FALCON está caído,
 * la transferencia igual ocurre; lo que se pierde es el caso en pantalla, no
 * la llamada.
 */
function internosDialplan(d: DatosPlanta): string {
  const timbre = d.timbreCola ?? TIMBRE_COLA_POR_DEFECTO;
  const cola = nombreCola(d.tenant);

  if (!d.operadores.length) {
    return `[internos]
;; Sin operadores todavía: póngales extensión en FALCON y vuelva a aplicar.

`;
  }

  const bloques = d.operadores
    .map((op) => {
      const aviso =
        `System(curl -s -m 3 -X POST \${FALCON_URL}/api/pbx/webhook ` +
        `-K /etc/asterisk/falcon-webhook.conf ` +
        `-d '{"evento":"transferida","callId":"\${LINKEDID}","extension":"${op.extension}"}' &)`;
      return `exten => ${op.extension},1,NoOp(FALCON transferencia id=\${LINKEDID} hacia=${op.extension})
 same => n,${aviso}
 same => n,Dial(PJSIP/${op.extension},30)
;; No contestó: vuelve a la sala en vez de caerse.
 same => n,Queue(${cola},r,,,${timbre})
 same => n,Hangup()`;
    })
    .join('\n\n');

  return `[internos]
;; ─────────────────────────────────────────────────────────────────────────
;; LO QUE UN OPERADOR PUEDE MARCAR — hoy, solo sus compañeros
;;
;; «callId» va con \${LINKEDID} y no con \${UNIQUEID}: el canal de la
;; transferencia es NUEVO y tiene su propio UNIQUEID, pero LINKEDID sigue
;; siendo el de la llamada original. Es lo que permite que el caso siga a la
;; llamada en vez de abrirse uno nuevo en el puesto que la recibe.
;; ─────────────────────────────────────────────────────────────────────────
${bloques}

`;
}

/** El nombre de la cola lleva el municipio: en los logs y en `queue show` se lee quién es. */
export function nombreCola(tenant: string): string {
  return `cola-${tenant.trim().toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// queues.conf — la cola de operadores (ACD)
// ─────────────────────────────────────────────────────────────────────────────
function queuesConf(d: DatosPlanta): string {
  const miembros = d.operadores.length
    ? d.operadores
        .map(
          (o) =>
            `member => PJSIP/${o.extension},0,${limpiarCallerid(o.nombre)}`,
        )
        .join('\n')
    : ';; Sin operadores todavía: póngales extensión en FALCON y vuelva a aplicar.';

  return `${encabezado(d, 'queues.conf')}[general]
;; Que un agente no tenga un retiro automático por no contestar: en el 123 el
;; operador puede estar atendiendo a alguien de pie frente al mostrador. Que
;; la cola lo salte es correcto; que lo expulse, no.
autofill = yes
monitor-type = MixMonitor

[${nombreCola(d.tenant)}]
;; ─────────────────────────────────────────────────────────────────────────
;; RINGALL, NO «EL QUE LLEVA MÁS RATO LIBRE»
;;
;; En un centro de atención comercial se reparte parejo para que nadie
;; trabaje más que otro. En una línea de emergencias manda el tiempo de
;; respuesta: timbra en TODOS los puestos y atiende el primero que pueda.
;; ─────────────────────────────────────────────────────────────────────────
strategy = ringall
;; Cuánto timbra en cada vuelta antes de reintentar.
timeout = 20
retry = 1
;; Sin descanso obligatorio entre llamadas: el que colgó puede recibir ya.
wrapuptime = 0
;; A un operador que ya está en llamada no se le timbra otra.
ringinuse = no
;; LA COLA ACEPTA LLAMADAS AUNQUE NO HAYA NADIE CONECTADO, y aunque nadie
;; contesta eso suene mal: rechazar la llamada de una emergencia porque el
;; turno no se ha conectado es peor que dejarla timbrando mientras alguien
;; entra. Lo que sí hay que vigilar —y por eso la cola de FALCON existe— es
;; que no se queden llamadas sin atender.
joinempty = yes
leavewhenempty = no
;; Sin tope de llamadas en espera: la que no quepa sería una emergencia
;; rechazada.
maxlen = 0
;; Que el tope de espera se reinicie cuando un agente deja de timbrar, para
;; que una vuelta fallida no consuma el tiempo del ciudadano.
timeoutrestart = yes
;; NADA DE MÚSICA: el ciudadano tiene que oír el TIMBRE, que es lo que le dice
;; que su llamada está viva y que alguien la va a tomar. Eso no se configura
;; aquí sino en la llamada a Queue() del dialplan, con la opción «r».
${miembros}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// rtp.conf, http.conf, modules.conf, ari.conf, falcon-webhook.conf
// ─────────────────────────────────────────────────────────────────────────────
function rtpConf(d: DatosPlanta): string {
  const partes = [
    `${encabezado(d, 'rtp.conf')}[general]`,
    `;; La tajada de puertos de audio de ESTA planta. El contenedor comparte la red
;; del host, así que el rango es del host y lo reparte FALCON: no lo cambie a
;; mano o se cruzará con el de otro municipio (ver asignador-puertos.ts).
rtpstart = ${d.rtpDesde}
rtpend = ${d.rtpHasta}
`,
    `;; ─────────────────────────────────────────────────────────────────────────
;; ICE — SIN ESTO EL NAVEGADOR CONTESTA Y NO SE OYE NADA
;; ─────────────────────────────────────────────────────────────────────────
icesupport = yes
`,
  ];

  // Los puentes de Docker fuera de los candidatos. El contenedor va en la red
  // del host, así que Asterisk ve «docker0» y un «br-xxxx» por cada stack de
  // Docker que haya en la máquina, y ofrecía todas esas 172.x al navegador,
  // que no puede alcanzar ninguna. En el primer servidor real eran CUATRO.
  //
  // Se excluye solo lo que NO contenga la IP real del servidor: si la máquina
  // vive en 172.16/12, negar ese rango la dejaría sin un solo candidato.
  const descartables = ['172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'];
  const aNegar = descartables.filter((red) => !enLaRed(privada(d), red));
  if (aNegar.length) {
    partes.push(
      `;; Fuera los puentes de Docker y las redes que no son de este servidor.
${aNegar.map((red) => `ice_deny = ${red}`).join('\n')}
`,
    );
  }

  if (hayNat11(d)) {
    // NAT 1:1 de nube (OCI, EC2, …): la IP pública NO está en ninguna
    // interfaz, así que Asterisk solo puede ofrecer la privada y el navegador
    // no la alcanza. «include_local_address» es imprescindible: sin él
    // Asterisk SUSTITUYE la dirección y se queda sin una local real desde la
    // que enviar, y entonces falla con «Invalid argument» en cada envío.
    //
    // Y con esta sección NO va «stunaddr»: lo dice la documentación de
    // Asterisk, y además aquí el STUN nunca produjo el candidato público.
    partes.push(
      `;; NAT 1:1 de la nube: la IP pública no está en ninguna interfaz. Se anuncia
;; la pública y se CONSERVA la privada —«include_local_address»— porque es la
;; única desde la que Asterisk puede enviar de verdad.
[ice_host_candidates]
${privada(d)} => ${d.ipPublica},include_local_address
`,
    );
  } else {
    partes.push(
      `;; Sin NAT 1:1 declarado: la dirección externa se descubre por STUN.
stunaddr = ${d.stun ?? STUN_POR_DEFECTO}
`,
    );
  }

  return partes.join('\n');
}

/** ¿Está esta IPv4 dentro de ese CIDR? Vacío = no está en ninguna. */
function enLaRed(ip: string, cidr: string): boolean {
  if (!ip) return false;
  const [red, bitsTexto] = cidr.split('/');
  const bits = Number(bitsTexto);
  const aNumero = (texto: string): number | null => {
    const partes = texto.split('.');
    if (partes.length !== 4) return null;
    let n = 0;
    for (const parte of partes) {
      const octeto = Number(parte);
      if (!Number.isInteger(octeto) || octeto < 0 || octeto > 255) return null;
      n = n * 256 + octeto;
    }
    return n;
  };
  const a = aNumero(ip);
  const b = aNumero(red);
  if (a === null || b === null || !Number.isInteger(bits)) return false;
  // Un desplazamiento de 32 en JavaScript no desplaza nada (da ~0), así que
  // una máscara /0 se calcularía mal. Se trata aparte.
  const mascara = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return (a & mascara) >>> 0 === (b & mascara) >>> 0;
}

function httpConf(d: DatosPlanta): string {
  return `${encabezado(d, 'http.conf')}[general]
enabled = yes
;; Una sola IP, la mínima que sirva. El TLS y la cara pública los pone nginx;
;; un Asterisk escuchando HTTP en 0.0.0.0 es ARI expuesto a internet.
;;
;; Cuál es la mínima depende de dónde corra ese nginx: 127.0.0.1 si está en el
;; host, y la IP del host en el puente de Docker si está en un contenedor en
;; red bridge —porque entonces el 127.0.0.1 del contenedor es él mismo—. Lo
;; decide FALCON con el campo «IP interna» de la planta.
;;
;; Y el puerto lo reparte FALCON por una razón vivida: en el servidor hay
;; otros servicios, y cuando Asterisk intentó tomar un 8088 ya ocupado el
;; síntoma fue un «Server Disabled» que se llevó también el WebSocket del
;; softphone, sin decir en ningún lado que el puerto estaba tomado.
bindaddr = ${interna(d)}
bindport = ${d.puertoHttp}
;; El WebSocket del softphone y ARI viven en este mismo servidor HTTP.
`;
}

function modulesConf(): string {
  return `;
; modules.conf — planta de FALCON CAD
;
; GENERADO POR FALCON. No lo edite aquí.
;
[modules]
autoload = yes

;; ─────────────────────────────────────────────────────────────────────────
;; CHAN_SIP FUERA, Y NO ES LIMPIEZA
;;
;; El canal SIP viejo se pelea con res_pjsip por el subprotocolo «sip» del
;; WebSocket: con los dos cargados, el registro del navegador termina en un
;; 403 que no dice nada de la causa. Media tarde costó encontrarlo.
;;
;; Y un detalle que también costó: este archivo está POR SECCIONES, así que un
;; \`noload\` escrito al final del archivo queda fuera de [modules] y se
;; ignora en silencio. Va aquí dentro. Además \`reload\` no descarga módulos:
;; hay que reiniciar.
;; ─────────────────────────────────────────────────────────────────────────
noload => chan_sip.so
`;
}

function asteriskConf(d: DatosPlanta): string {
  return `${encabezado(d, 'asterisk.conf')};; ─────────────────────────────────────────────────────────────────────────
;; POR QUÉ ESTE ARCHIVO EXISTE
;;
;; El contenedor monta la carpeta «etc/» de la planta COMO /etc/asterisk, así
;; que tapa la que trae el paquete: lo que no generemos aquí, no existe allá
;; dentro. Sin este archivo, Asterisk arranca con sus valores de compilación
;; —funciona— pero cada \`asterisk -rx\` empieza con:
;;
;;   Unable to open specified master config file '/etc/asterisk/asterisk.conf',
;;   using built-in defaults
;;
;; y eso hace que toda comprobación parezca una falla. Además deja el arranque
;; dependiendo de con qué rutas se compiló la imagen, que es justo lo que no
;; queremos que cambie cuando cambie la imagen base.
;; ─────────────────────────────────────────────────────────────────────────
[directories](!)
astetcdir => /etc/asterisk
astvarlibdir => /var/lib/asterisk
astdbdir => /var/lib/asterisk
astkeydir => /var/lib/asterisk
astdatadir => /var/lib/asterisk
astagidir => /var/lib/asterisk/agi-bin
astspooldir => /var/spool/asterisk
astrundir => /var/run/asterisk
astlogdir => /var/log/asterisk

;; astmoddir NO se pone, y es a propósito: es la única ruta que, mal puesta,
;; deja a Asterisk sin cargar un solo módulo —es decir, la planta muerta sin
;; decir por qué—. El valor de compilación de la imagen ya es el correcto
;; (quedó comprobado: con este archivo ausente, res_pjsip cargó), y omitirlo
;; es lo que lo mantiene correcto si mañana la imagen base cambia de ruta.

[options]
;; Nada aquí: el verbose lo pone el \`CMD\` de la imagen (\`asterisk -f -vvv\`) y
;; el resto son los valores de siempre. Este archivo está para FIJAR LAS RUTAS,
;; no para cambiar comportamiento; si algún día hace falta una opción, va aquí
;; con el motivo escrito al lado.
`;
}

function loggerConf(d: DatosPlanta): string {
  return `${encabezado(d, 'logger.conf')}[general]
dateformat = %F %T

[logfiles]
;; Sin este archivo, Asterisk solo habla por consola: la carpeta «log/» de la
;; planta se queda vacía y un problema de hace dos horas no se puede mirar.
console => notice,warning,error
messages => notice,warning,error

;; «full» (que incluye debug y verbose) queda APAGADO a propósito: en una
;; planta con tráfico crece en gigas y el disco de este servidor lo comparten
;; todas las plantas. Para un rato de diagnóstico se enciende en vivo, sin
;; tocar el archivo ni reiniciar:
;;   asterisk -rx 'logger add channel /var/log/asterisk/diag verbose,debug'
;;   asterisk -rx 'logger remove channel /var/log/asterisk/diag'
;;
;; Y los archivos NO rotan por tamaño: rotan cuando se lo piden.
;;   asterisk -rx 'logger rotate'
`;
}

function ariConf(d: DatosPlanta): string {
  return `${encabezado(d, 'ari.conf')}[general]
enabled = yes
;; Sin eventos por WebSocket: FALCON solo usa ARI para ORIGINAR la llamada del
;; botón «Llamar». Lo que pasa con las llamadas lo cuenta el dialplan por el
;; webhook, que es un camino menos y sin conexión permanente que mantener.
allowed_origins = *

[falcon]
type = user
read_only = no
password = ${d.ariClave}
`;
}

function webhookConf(d: DatosPlanta): string {
  return `# falcon-webhook.conf — credencial del webhook de la planta de «${d.tenant}»
#
# GENERADO POR FALCON. Modo 600: lo lee curl con -K y nadie más.
#
# ESTE ARCHIVO EXISTE POR UN FALLO NUESTRO. La API key iba en la línea de
# \`System()\` del dialplan, y eso la deja visible en \`ps aux\` para cualquier
# usuario del servidor y escrita en el log de Asterisk en cada llamada.
# Aquí no: curl la lee de un archivo que solo root puede abrir.
#
# Si rota la API key de la instancia en FALCON, vuelva a aplicar la
# configuración de la planta — o la central dejará de poder avisar.
header = "x-api-key: ${d.apiKey}"
header = "Content-Type: application/json"
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// docker-compose.yml y el sitio de nginx
// ─────────────────────────────────────────────────────────────────────────────
function composeYml(d: DatosPlanta): string {
  return `# docker-compose.yml — planta de «${d.tenant}»
#
# GENERADO POR FALCON. No lo edite aquí.
#
# RED DEL HOST, y no por pereza:
#
#  - Publicar cientos de puertos RTP por el NAT de Docker es inviable:
#    docker-proxy abre un proceso por puerto publicado.
#  - Lo que la planta ORIGINA —el keepalive OPTIONS, el registro, la llamada
#    saliente— saldría con un puerto de origen que el SBC del operador no
#    reconoce, y lo rechaza con 403.
#
# El aislamiento que se busca aquí es el de la CONFIGURACIÓN —que un
# extensions.conf mal editado no pueda tumbar la línea de otro municipio—, no
# el de la red. El precio es que los puertos son del host y los reparte
# FALCON.
services:
  asterisk:
    # La imagen es UNA para todos los municipios; lo que cambia es lo que se
    # monta en /etc/asterisk. La construye «aplicar.sh» la primera vez, con el
    # Dockerfile que viene en este mismo paquete —así este servidor no
    # necesita una copia del código ni credenciales de git—:
    #   docker build -t falcon-pbx:2 ./imagen
    image: falcon-pbx:2
    container_name: ${nombreContenedor(d.tenant)}
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./etc:/etc/asterisk
      - ./grabaciones:/var/spool/asterisk/monitor
      - ./log:/var/log/asterisk
    # Puertos de ESTA planta (los gestiona FALCON, están aquí para poder
    # auditar el servidor leyendo este archivo):
    #   SIP        udp ${d.puertoSip}
    #   RTP        udp ${d.rtpDesde}-${d.rtpHasta}
    #   HTTP/ARI   tcp 127.0.0.1:${d.puertoHttp}
`;
}

function nginxSite(d: DatosPlanta): string {
  return `# ${d.dominioSip} — planta de «${d.tenant}»
#
# GENERADO POR FALCON. No lo edite aquí.
#
# Un nombre por municipio sobre UN certificado comodín y UN puerto: así dar de
# alta un municipio no exige abrir un puerto en la nube ni emitir un
# certificado nuevo.
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name ${d.dominioSip};

  # El certificado de ESTE nombre, que es el que deja certbot con una sola
  # orden y se renueva solo:
  #
  #   sudo certbot certonly --nginx -d ${d.dominioSip}
  #
  # Un comodín (*.${dominioPadre(d.dominioSip)}) ahorraría una orden por
  # municipio, pero Let's Encrypt solo lo emite validando por DNS, o sea
  # configurando la API del proveedor de DNS. Para unos pocos municipios no se
  # paga; cuando sean diez, se emite el comodín y estas dos líneas pasan a
  # apuntar a /etc/letsencrypt/live/${dominioPadre(d.dominioSip)}/.
  ssl_certificate     /etc/letsencrypt/live/${d.dominioSip}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${d.dominioSip}/privkey.pem;

  # El WebSocket del softphone. El audio NO pasa por aquí: va directo por ICE
  # contra la IP pública del servidor.
  location /ws {
    proxy_pass http://${interna(d)}:${d.puertoHttp}/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Una llamada larga no puede morir por inactividad de la señalización.
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  # ARI, para el botón «Llamar» del caso. Solo FALCON lo usa.
  location /ari/ {
    proxy_pass http://${interna(d)}:${d.puertoHttp}/ari/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # Nada más de Asterisk se expone.
  location / {
    return 404;
  }
}
`;
}

/**
 * La credencial para SUBIR archivos, aparte de la del webhook.
 *
 * Son dos archivos y no uno por una razón concreta: el del webhook fija
 * `Content-Type: application/json`, que es lo que el aviso necesita y lo que
 * ROMPERÍA una subida multipart —curl tiene que poner ahí su propio
 * `multipart/form-data` con el límite—. Un solo archivo compartido haría que
 * la grabación se subiera con un tipo que el servidor no sabe desarmar, y el
 * error sería un 400 que no se parece a su causa.
 */
function apiConf(d: DatosPlanta): string {
  return `# falcon-api.conf — credencial de la planta de «${d.tenant}» para SUBIR archivos
#
# GENERADO POR FALCON. Modo 600.
#
# Es la misma API key del webhook, en un archivo aparte y SIN Content-Type: la
# subida de la grabación es multipart y curl tiene que poner el suyo.
header = "x-api-key: ${d.apiKey}"
`;
}

/**
 * EL SCRIPT QUE SUBE LA GRABACIÓN — lo ejecuta MixMonitor al terminar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES DECISIONES QUE NO SON DE ESTILO
 *
 *  1. **Solo borra cuando FALCON confirma.** Si la subida falla —la red, un
 *     caso que todavía no existe, FALCON caído—, el archivo se queda en la
 *     planta. Una grabación de una llamada al 123 no se pierde porque un POST
 *     devolvió 500; y un archivo que sobra es visible, mientras que uno
 *     borrado no vuelve.
 *  2. **Comprime si puede, y si no sube el WAV.** Un WAV de 8 kHz son ~960 KB
 *     por minuto; en MP3 a 24 kbps, ~180 KB. Con `lame` presente comprime, y
 *     sin él sube el WAV igual: la grabación no depende de que un paquete
 *     esté instalado.
 *  3. **No corre con `set -e`.** Lo ejecuta Asterisk y su salida no la lee
 *     nadie en el momento: lo que hace falta es que cada paso que falle quede
 *     ESCRITO con su motivo, no que el script muera en el primero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SUBE, A PROPÓSITO
 *
 * Las SALIENTES. El dialplan las graba —son evidencia igual— pero no las
 * sube, porque FALCON no registra todavía la llamada saliente como una
 * llamada propia y no habría a qué atarla: el servidor respondería «no hay
 * ninguna llamada con ese callId» y el archivo se quedaría aquí de todos
 * modos. Quedan en el volumen de grabaciones de la planta.
 */
function subirGrabacionSh(d: DatosPlanta): string {
  const url = `${d.falconUrl.replace(/\/+$/, '')}/api/pbx/grabacion`;
  return `#!/usr/bin/env bash
#
# subir-grabacion.sh — planta de «${d.tenant}»
#
# GENERADO POR FALCON. Lo ejecuta MixMonitor al terminar de grabar:
#
#   MixMonitor(archivo.wav,b,bash /etc/asterisk/subir-grabacion.sh ^{UNIQUEID})
#
# Sube la grabación al caso de esa llamada. Solo borra el archivo local cuando
# FALCON confirma que lo recibió.
#
# Sin «set -e» a propósito: lo que hace falta es que cada fallo quede escrito,
# no que el script muera en el primero.
set -uo pipefail

ID="\${1:-}"
DIR="/var/spool/asterisk/monitor"
LOG="/var/log/asterisk/falcon-grabaciones.log"
URL="${url}"

anotar() { echo "$(date '+%Y-%m-%d %H:%M:%S') [\$ID] \$*" >> "\$LOG" 2>/dev/null || true; }

if [ -z "\$ID" ]; then
  anotar "sin UNIQUEID: no hay nada que subir"
  exit 0
fi

WAV="\$DIR/\$ID.wav"
if [ ! -s "\$WAV" ]; then
  anotar "no existe o está vacío: \$WAV"
  exit 0
fi

# Duración aproximada, solo para la descripción: MixMonitor escribe WAV de
# 8 kHz, 16 bits, mono — 16000 bytes por segundo, menos la cabecera.
BYTES="$(stat -c %s "\$WAV" 2>/dev/null || echo 0)"
SEGUNDOS="$(( (BYTES > 44 ? BYTES - 44 : 0) / 16000 ))"

# Comprimir si se puede; si no, se sube el WAV tal cual.
SUBIR="\$WAV"
TEMPORAL=""
if command -v lame >/dev/null 2>&1; then
  MP3="\$DIR/\$ID.mp3"
  if lame --quiet -m m -b 24 "\$WAV" "\$MP3" 2>/dev/null && [ -s "\$MP3" ]; then
    SUBIR="\$MP3"
    TEMPORAL="\$MP3"
  else
    anotar "lame falló; se sube el WAV"
    rm -f "\$MP3"
  fi
fi

CUERPO="$(mktemp)"
CODIGO="$(curl -sS -m 300 -o "\$CUERPO" -w '%{http_code}' \\
  -K /etc/asterisk/falcon-api.conf \\
  -F "file=@\$SUBIR" \\
  -F "callId=\$ID" \\
  -F "segundos=\$SEGUNDOS" \\
  "\$URL" 2>>"\$LOG")"

case "\$CODIGO" in
  2*)
    anotar "subida ok (\$CODIGO, \$(stat -c %s "\$SUBIR" 2>/dev/null || echo '?') bytes): \$(head -c 300 "\$CUERPO")"
    # Ahora sí: FALCON la tiene, con su hash y su copia.
    rm -f "\$WAV" "\$TEMPORAL"
    ;;
  *)
    # Se CONSERVA el WAV. Lo que sobra se ve; lo que se borró, no vuelve.
    anotar "no se pudo subir (\$CODIGO): \$(head -c 300 "\$CUERPO")"
    anotar "se conserva \$WAV para reintentar a mano"
    [ -n "\$TEMPORAL" ] && rm -f "\$TEMPORAL"
    ;;
esac
rm -f "\$CUERPO"
`;
}

/**
 * EL SCRIPT QUE INSTALA LA PLANTA — un solo archivo, un solo comando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO Y NO «COPIE ESTOS DIEZ ARCHIVOS AL SERVIDOR»
 *
 * Porque copiar diez archivos a mano es exactamente el trabajo que este
 * módulo existe para quitar, y porque el orden importa: los permisos antes de
 * arrancar, nginx probado antes de recargar, Asterisk reiniciado y no
 * recargado —`reload` no descarga módulos, y eso ya nos costó una tarde con
 * `chan_sip`—.
 *
 * Lleva los archivos DENTRO, en heredocs con el delimitador entre comillas
 * para que el shell no expanda nada: un `${EXTEN}` del dialplan expandido por
 * bash deja una configuración silenciosamente distinta de la que se revisó en
 * pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE EL SCRIPT NO HACE, A PROPÓSITO
 *
 *  - **No abre puertos en la nube.** Eso vive en la consola del proveedor y
 *    no en un script; además es la parte que conviene revisar con la cabeza
 *    fría.
 *  - **No pide el certificado.** Es un comodín compartido por todas las
 *    plantas: se emite una vez por servidor, no por municipio.
 *  - **No borra nada.** Si la carpeta ya existe, sobrescribe los archivos
 *    generados y deja el resto —grabaciones y registros— donde está.
 *
 * Lleva TODAS las claves de la planta, así que es el archivo más sensible del
 * conjunto: modo 600 y se borra del servidor cuando termina de usarse.
 */
function aplicarSh(d: DatosPlanta, archivos: ArchivoGenerado[]): string {
  const carpeta = (d.carpeta ?? `/opt/falcon-pbx/${d.tenant}`).replace(
    /\/+$/,
    '',
  );
  const escribir = archivos
    .map((a) => {
      const delim = delimitadorPara(a.contenido);
      return [
        `install -d -m 755 "$(dirname "${carpeta}/${a.ruta}")"`,
        `cat > "${carpeta}/${a.ruta}" <<'${delim}'`,
        a.contenido.replace(/\n$/, ''),
        delim,
        `chmod ${a.modo} "${carpeta}/${a.ruta}"`,
        '',
      ].join('\n');
    })
    .join('\n');

  return `#!/usr/bin/env bash
#
# aplicar.sh — instala la planta de «${d.tenant}» en este servidor.
#
# GENERADO POR FALCON. Se ejecuta como root, una sola vez:
#
#   sudo bash aplicar.sh
#
# CONTIENE LAS CLAVES DE ESTA PLANTA. Bórrelo del servidor al terminar:
#
#   shred -u aplicar.sh   # o rm -f aplicar.sh
#
set -euo pipefail

if [ "\${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Ejecútelo como root: sudo bash aplicar.sh" >&2
  exit 1
fi

echo "➤ Planta de «${d.tenant}» → ${carpeta}"
install -d -m 755 "${carpeta}" "${carpeta}/etc" "${carpeta}/grabaciones" "${carpeta}/log" "${carpeta}/nginx"

${escribir}
# ── La imagen, una sola para todos los municipios ───────────────────────────
#
# Se construye aquí mismo si falta, con el Dockerfile que este paquete trae.
# Antes el script se rendía y pedía construirla «desde el repositorio», y ese
# repositorio no tiene por qué existir en el servidor de telefonía: lo único
# que tiene que llegar aquí es este archivo.
if ! docker image inspect falcon-pbx:2 >/dev/null 2>&1; then
  echo "➤ Construyendo la imagen falcon-pbx:2 (una sola vez por servidor)"
  docker build -t falcon-pbx:2 "${carpeta}/imagen"
fi

# ── El sitio de nginx ───────────────────────────────────────────────────────
#
# Solo si el nginx DEL SISTEMA es el que está sirviendo el 443. En un servidor
# donde el 443 lo tiene otra cosa —un contenedor, Traefik, el nginx de otro
# despliegue— enlazar aquí no hace nada: el archivo queda escrito y el
# navegador sigue sin llegar. Peor todavía, «systemctl reload nginx» sobre un
# nginx detenido falla, y con «set -e» abortaría la instalación ANTES de
# levantar la planta.
#
# Así que esto se decide mirando quién tiene el 443, y si no es el nginx del
# sistema, se dice exactamente qué falta y se SIGUE: la planta queda
# funcionando para la troncal, que es lo que no puede esperar; el softphone
# entra en cuanto se enganche el sitio.
QUIEN_443="$(ss -lntpH 'sport = :443' 2>/dev/null | head -1)"
if systemctl is-active --quiet nginx 2>/dev/null && [ -d /etc/nginx/sites-enabled ]; then
  ln -sf "${carpeta}/nginx/${d.dominioSip}.conf" "/etc/nginx/sites-enabled/${d.dominioSip}.conf"
  # Probar ANTES de recargar: un nginx que no arranca se lleva por delante a
  # los demás municipios del servidor, que no tienen nada que ver con esto.
  if nginx -t; then
    systemctl reload nginx
    echo "✔ nginx recargado para ${d.dominioSip}"
  else
    echo "⚠ La configuración de nginx no pasó la prueba; NO se recargó."
    echo "  El sitio quedó enlazado en /etc/nginx/sites-enabled/${d.dominioSip}.conf"
  fi
else
  echo
  echo "⚠ El nginx del sistema no está sirviendo el 443, así que no enlacé nada."
  if [ -n "\$QUIEN_443" ]; then
    echo "  Quien lo tiene: \$QUIEN_443"
  fi
  echo "  El sitio de esta planta está en:"
  echo "    ${carpeta}/nginx/${d.dominioSip}.conf"
  echo "  Cópielo a la configuración de QUIEN sirve el 443 y recárguelo. Si es"
  echo "  un contenedor de nginx, suele ser algo como:"
  echo "    docker cp ${carpeta}/nginx/${d.dominioSip}.conf <contenedor>:/etc/nginx/conf.d/"
  echo "    docker exec <contenedor> nginx -t && docker exec <contenedor> nginx -s reload"
  echo "  Ese contenedor necesita ver /etc/letsencrypt (el certificado) y poder"
  echo "  alcanzar 127.0.0.1:${d.puertoHttp} del host."
  echo "  Mientras tanto la planta YA atiende la troncal; lo que falta es el"
  echo "  softphone del navegador."
  echo
fi

# ── El contenedor ───────────────────────────────────────────────────────────
cd "${carpeta}"
docker compose up -d
# «restart» y no «reload»: reload NO descarga módulos, y la configuración
# generada incluye un noload de chan_sip que solo surte efecto al reiniciar.
docker compose restart
sleep 3

echo
echo "➤ Comprobaciones"
docker compose exec -T asterisk asterisk -rx 'pjsip show transports' || true
docker compose exec -T asterisk asterisk -rx 'pjsip show aors' || true
docker compose exec -T asterisk asterisk -rx 'queue show ${nombreCola(d.tenant)}' || true
docker compose exec -T asterisk asterisk -rx 'module show like chan_sip' || true

echo
echo "✔ Planta de «${d.tenant}» aplicada."
echo "  SIP udp ${d.puertoSip} · RTP udp ${d.rtpDesde}-${d.rtpHasta} · HTTP 127.0.0.1:${d.puertoHttp}"
echo "  Operadores: ${d.operadores.map((o) => o.extension).join(', ') || 'ninguno todavía'}"
echo
echo "  Falta, y NO lo hace este script:"
echo "   · abrir en la nube udp ${d.puertoSip} y udp ${d.rtpDesde}-${d.rtpHasta}"
echo "   · decirle al operador que entregue en este servidor:${d.puertoSip}"
echo "   · borrar este archivo: shred -u aplicar.sh"
`;
}

/**
 * LA IMAGEN DE LAS PLANTAS — una sola para todos los municipios.
 *
 * Viaja con la configuración, y eso es deliberado: así el servidor de
 * telefonía no necesita una copia del repositorio ni credenciales de git. Lo
 * único que tiene que llegar es `aplicar.sh`, que la construye si falta.
 *
 * Una imagen para todos y no una por municipio: lo que cambia entre plantas
 * es lo que se monta en `/etc/asterisk`. Si fuera por municipio, actualizar
 * Asterisk sería un trabajo por municipio.
 *
 * UBUNTU 22.04, Y NO DEBIAN. Debian 12 (bookworm) **retiró el paquete
 * `asterisk`**: la imagen falla al construirse con «Package 'asterisk' has no
 * installation candidate». Lo descubrimos aplicando. Ubuntu 22.04 sí lo trae,
 * y es exactamente el que corre hoy en el servidor —la instalación a mano se
 * hizo con el `apt` de esa misma Ubuntu, y con ella entró la primera llamada
 * real de punta a punta—. O sea que no es una elección: es la que está
 * probada.
 *
 * Y el paquete de la distribución, no una imagen de terceros: una etiqueta de
 * Docker Hub puede cambiar o desaparecer sin avisar.
 */
function dockerfile(): string {
  return `# Dockerfile — imagen de las plantas de FALCON
#
# GENERADO POR FALCON. No lo edite aquí: el próximo provisionamiento lo
# sobrescribe. Lo construye «aplicar.sh» si no existe todavía:
#
#   docker build -t falcon-pbx:2 /opt/falcon-pbx/<instancia>/imagen
#
# Ubuntu 24.04 y NO Debian: Debian 12 retiró el paquete «asterisk» y la
# imagen no se puede construir.
#
# Y 24.04 y no 22.04: la 22.04 trae Asterisk 18.10, anterior a varias
# correcciones de ICE. La 24.04 trae Asterisk 20, que es LTS.
FROM ubuntu:24.04

# Sin esto, algún paquete abre el diálogo de la zona horaria y la construcción
# se queda esperando a alguien que nunca va a contestar.
ENV DEBIAN_FRONTEND=noninteractive

# «curl» no es un extra: es como el dialplan le avisa a FALCON de cada
# llamada. «lame» tampoco: la grabación de una llamada en WAV de 8 kHz son
# ~960 KB por minuto, y en MP3 a 24 kbps unos 180 KB — los mismos bytes que
# después viajan a FALCON y se guardan en la base del municipio. El script de
# subida funciona sin él (sube el WAV), pero con él cuesta cinco veces menos.
RUN apt-get update \\
 && apt-get install -y --no-install-recommends \\
      asterisk \\
      curl \\
      ca-certificates \\
      lame \\
      tzdata \\
 && rm -rf /var/lib/apt/lists/*

# NO se instalan las locuciones: el dialplan no reproduce ninguna. El
# ciudadano en espera oye TIMBRE, no música ni «su llamada es importante»,
# porque el timbre es lo que le dice que su llamada está viva. Eso ahorra unos
# 40 MB y una decisión de idioma por municipio.

# La configuración entra por volumen; las grabaciones y los registros salen
# por volumen. La imagen no guarda nada propio de ningún municipio.
VOLUME ["/etc/asterisk", "/var/spool/asterisk/monitor", "/var/log/asterisk"]

# En primer plano, para que Docker lo supervise y «restart: unless-stopped»
# funcione. Como root dentro de SU contenedor: así los archivos con claves
# pueden quedar en 600 sin que el proceso se quede sin poder leerlos, que es
# una forma especialmente confusa de no arrancar.
CMD ["asterisk", "-f", "-vvv"]
`;
}

/**
 * Un delimitador de heredoc que no aparezca en el contenido.
 *
 * Paranoia justificada: si el delimitador apareciera dentro del archivo, el
 * heredoc se cortaría ahí y el resto del contenido se ejecutaría COMO
 * COMANDOS. En un script que corre como root.
 */
function delimitadorPara(contenido: string): string {
  let delim = 'FALCON_EOF';
  let n = 0;
  while (contenido.includes(delim)) {
    n += 1;
    delim = `FALCON_EOF_${n}`;
  }
  return delim;
}

/** `itagui-pbx.falconcad.com.co` → `falconcad.com.co`: solo para los avisos. */
function dominioPadre(dominio: string): string {
  const partes = dominio.split('.');
  return partes.length > 2 ? partes.slice(1).join('.') : dominio;
}
