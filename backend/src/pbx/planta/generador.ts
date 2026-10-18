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
  /** Servidor STUN para el candidato público de Asterisk. */
  stun?: string;
  /** Segundos que timbra la cola antes de rendirse. */
  timbreCola?: number;
  /**
   * La carpeta de la planta en el servidor. La pone quien provisiona, para
   * que el script de instalación y lo que dice la pantalla no puedan
   * discrepar — un script que escribe en otra carpeta que la que se enseñó es
   * media hora buscando archivos.
   */
  carpeta?: string;
}

const STUN_POR_DEFECTO = 'stun.l.google.com:19302';
const TIMBRE_COLA_POR_DEFECTO = 120;

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
    texto('etc/modules.conf', modulesConf()),
    conClaves('etc/falcon-webhook.conf', webhookConf(d)),
    conClaves('etc/ari.conf', ariConf(d)),
    texto('docker-compose.yml', composeYml(d)),
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
[${op.extension}]
type = endpoint
transport = transport-ws
webrtc = yes
context = entrantes
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
    const did = (t.numeroPresentado ?? '').replace(/\D/g, '');

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
 same => n,MixMonitor(\${GRABACIONES}/\${UNIQUEID}.wav,b)
 same => n,GotoIf($["\${DESTINO}" = "cola"]?cola:directo)

 same => n(cola),Queue(\${COLA},r,,,${timbre})
 same => n,Hangup()

 same => n(directo),Dial(PJSIP/\${DESTINO},30)
 same => n,Hangup()

;; Se cuelga: se cierra en FALCON. Pase lo que pase.
exten => h,1,NoOp(FALCON fin id=\${UNIQUEID} estado=\${DIALSTATUS}\${QUEUESTATUS})
 same => n,System(curl -s -m 3 -X POST \${FALCON_URL}/api/pbx/webhook -K /etc/asterisk/falcon-webhook.conf -d '{"evento":"colgada","callId":"\${UNIQUEID}"}' &)


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

;; Sin «+»: se le pone y se sigue por el patrón de arriba. No se marca «pelado»
;; porque la troncal rechaza lo que no venga en E.164.
exten => _X.,1,Goto(salientes,+\${EXTEN},1)
`);

  return partes.join('');
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
  return `${encabezado(d, 'rtp.conf')}[general]
;; La tajada de puertos de audio de ESTA planta. El contenedor comparte la red
;; del host, así que el rango es del host y lo reparte FALCON: no lo cambie a
;; mano o se cruzará con el de otro municipio (ver asignador-puertos.ts).
rtpstart = ${d.rtpDesde}
rtpend = ${d.rtpHasta}

;; ─────────────────────────────────────────────────────────────────────────
;; ICE Y STUN — SIN ESTO EL NAVEGADOR CONTESTA Y LA LLAMADA SE CAE
;;
;; \`external_media_address\` del transporte reescribe la IP del SDP, pero NO
;; los candidatos ICE, y el navegador elige por ICE. Sin un candidato con la
;; IP pública, el navegador manda su audio a una dirección privada: la llamada
;; se establece, se oye un instante y se corta. Ya lo diagnosticamos una vez.
;; ─────────────────────────────────────────────────────────────────────────
icesupport = yes
stunaddr = ${d.stun ?? STUN_POR_DEFECTO}
`;
}

function httpConf(d: DatosPlanta): string {
  return `${encabezado(d, 'http.conf')}[general]
enabled = yes
;; SOLO 127.0.0.1. El TLS y la cara pública los pone nginx; un Asterisk
;; escuchando HTTP en 0.0.0.0 es ARI expuesto a internet.
;;
;; Y el puerto lo reparte FALCON por una razón vivida: en el servidor hay
;; otros servicios, y cuando Asterisk intentó tomar un 8088 ya ocupado el
;; síntoma fue un «Server Disabled» que se llevó también el WebSocket del
;; softphone, sin decir en ningún lado que el puerto estaba tomado.
bindaddr = 127.0.0.1
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
    # monta en /etc/asterisk. Se construye en el servidor desde
    # deploy/pbx/Dockerfile del repositorio:
    #   docker build -t falcon-pbx:1 /opt/falcon-pbx/imagen
    image: falcon-pbx:1
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

  ssl_certificate     /etc/letsencrypt/live/${dominioComodin(d.dominioSip)}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${dominioComodin(d.dominioSip)}/privkey.pem;

  # El WebSocket del softphone. El audio NO pasa por aquí: va directo por ICE
  # contra la IP pública del servidor.
  location /ws {
    proxy_pass http://127.0.0.1:${d.puertoHttp}/ws;
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
    proxy_pass http://127.0.0.1:${d.puertoHttp}/ari/;
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
if ! docker image inspect falcon-pbx:1 >/dev/null 2>&1; then
  echo "➤ Falta la imagen falcon-pbx:1. Constrúyala una vez en este servidor:"
  echo "    docker build -t falcon-pbx:1 /opt/falcon-pbx/imagen"
  echo "  (el Dockerfile está en deploy/pbx/ del repositorio)"
  exit 1
fi

# ── El sitio de nginx ───────────────────────────────────────────────────────
if [ -d /etc/nginx/sites-enabled ]; then
  ln -sf "${carpeta}/nginx/${d.dominioSip}.conf" "/etc/nginx/sites-enabled/${d.dominioSip}.conf"
  # Probar ANTES de recargar: un nginx que no arranca se lleva por delante a
  # los demás municipios del servidor, que no tienen nada que ver con esto.
  nginx -t
  systemctl reload nginx
  echo "✔ nginx recargado para ${d.dominioSip}"
else
  echo "⚠ No encontré /etc/nginx/sites-enabled: enlace el sitio a mano."
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

/** `itagui-pbx.falconcad.com.co` → `falconcad.com.co`, que es donde está el comodín. */
function dominioComodin(dominio: string): string {
  const partes = dominio.split('.');
  return partes.length > 2 ? partes.slice(1).join('.') : dominio;
}
