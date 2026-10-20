import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArchivoGenerado,
  DatosPlanta,
  generarConfiguracion,
  nombreCola,
} from './generador';

/**
 * La configuración que se instala en la planta de un municipio.
 *
 * Cada cosa que se protege aquí es un fallo que YA PAGAMOS montando la
 * centralita a mano, y que una plantilla con huecos vuelve a dejar pasar:
 *
 *  1. **Opus antes que ulaw.** La llamada entra, timbra, el operador contesta
 *     y Asterisk la cuelga él mismo: «Unable to find a codec translation
 *     path». Solo está en el log.
 *  2. **La API key en la línea de `System()`.** Visible en `ps aux` para
 *     cualquier usuario del servidor y escrita en el log en cada llamada.
 *  3. **Un `match =` vacío en el `identify`.** Es la regla que decide quién
 *     puede entregar llamadas por el puerto SIP; vacía no protege nada.
 *  4. **`_X.` no casa con `+18335308128`**, porque `X` es un dígito y el `+`
 *     no lo es. La central rechaza la llamada por «extensión no encontrada».
 *  5. **Sin `stunaddr`, el navegador contesta y la llamada se cae**: el
 *     candidato ICE lleva una IP privada.
 *  6. **`chan_sip` cargado** se pelea con pjsip por el subprotocolo del
 *     WebSocket, y el registro del navegador termina en un 403 mudo. Y el
 *     `noload` tiene que ir DENTRO de `[modules]` o se ignora en silencio.
 *  7. **HTTP en un puerto ya ocupado** deja a Asterisk «Server Disabled» y se
 *     lleva también el WebSocket del softphone, sin decir qué pasó.
 *  8. **Un archivo con claves legible por todos** es un secreto publicado.
 */
describe('generador de la configuración de la planta', () => {
  const DATOS: DatosPlanta = {
    tenant: 'itagui',
    dominioSip: 'itagui-pbx.falconcad.com.co',
    puertoSip: 5061,
    rtpDesde: 21000,
    rtpHasta: 21499,
    puertoHttp: 8101,
    ipPublica: '129.80.243.118',
    operadores: [
      { extension: '101', nombre: 'Puesto 1', clave: 'clave-de-la-101' },
      { extension: '102', nombre: 'Puesto 2', clave: 'clave-de-la-102' },
    ],
    troncales: [
      {
        nombre: 'Infobip Bogotá',
        servidor: '6ad3.latam.sip.voice.infobip.com',
        puerto: 5060,
        autenticacion: 'ip',
        redes: '81.23.252.0/24, 81.23.253.0/24',
        numeroPresentado: '+18335308128',
      },
    ],
    numeros: [
      { numero: '+18335308128', tipo: 'did', destino: 'cola' },
      { numero: '+576042345678', tipo: 'did', destino: '102' },
    ],
    falconUrl: 'https://falconcad.com.co/',
    apiKey: 'fk_la_llave_de_itagui',
    ariClave: 'clave-de-ari',
  };

  function generar(
    cambios: Partial<DatosPlanta> = {},
  ): Map<string, ArchivoGenerado> {
    const archivos = generarConfiguracion({ ...DATOS, ...cambios });
    return new Map(archivos.map((a) => [a.ruta, a]));
  }

  const contenido = (cambios: Partial<DatosPlanta>, ruta: string): string =>
    generar(cambios).get(ruta)?.contenido ?? '';

  const contar = (texto: string, aguja: string): number =>
    texto.split(aguja).length - 1;

  describe('los códecs y la troncal', () => {
    it('ulaw, y Opus en ninguna parte: con Opus la central cuelga la llamada ella misma', () => {
      const todos = generarConfiguracion(DATOS)
        .map((a) => a.contenido)
        .join('\n');
      expect(todos).toContain('allow = ulaw,alaw');
      expect(todos.toLowerCase()).not.toContain('allow = opus');
    });

    it('la troncal presenta el DID: sin número de origen, toda saliente es un 403', () => {
      const t = contenido({}, 'etc/pjsip-troncal.conf');
      expect(t).toContain('from_user = 18335308128');
      expect(t).toContain('callerid = 18335308128 <18335308128>');
    });

    it('el identify lleva las redes del operador, nunca un match vacío', () => {
      const t = contenido({}, 'etc/pjsip-troncal.conf');
      expect(t).toContain('type = identify');
      expect(t).toContain('match = 81.23.252.0/24');
      expect(t).toContain('match = 81.23.253.0/24');
      expect(t).not.toMatch(/match\s*=\s*$/m);
    });

    it('sin redes no escribe un identify a medias, y lo dice', () => {
      const t = contenido(
        { troncales: [{ ...DATOS.troncales[0], redes: null }] },
        'etc/pjsip-troncal.conf',
      );
      expect(t).not.toContain('type = identify');
      expect(t).toContain('SIN REDES DECLARADAS');
    });

    it('sin troncal no hay archivo de troncal ni include que apunte a la nada', () => {
      const archivos = generar({ troncales: [] });
      expect(archivos.has('etc/pjsip-troncal.conf')).toBe(false);
      expect(archivos.get('etc/pjsip.conf')?.contenido).not.toContain(
        '#include pjsip-troncal.conf',
      );
    });

    it('una troncal con registro lleva su auth y su registration; una por IP, ninguno', () => {
      const conRegistro = contenido(
        {
          troncales: [
            {
              nombre: 'Claro',
              servidor: 'sbc.claro.co',
              puerto: 5060,
              autenticacion: 'registro',
              usuario: 'itagui123',
              clave: 'secreta',
              numeroPresentado: '+576042345678',
            },
          ],
        },
        'etc/pjsip-troncal.conf',
      );
      expect(conRegistro).toContain('type = registration');
      expect(conRegistro).toContain('username = itagui123');
      expect(conRegistro).toContain('outbound_auth = troncal');
      expect(contenido({}, 'etc/pjsip-troncal.conf')).not.toContain(
        'type = registration',
      );
    });

    it('avisa cuando la troncal no tiene número que presentar, en vez de generar un 403 silencioso', () => {
      const t = contenido(
        { troncales: [{ ...DATOS.troncales[0], numeroPresentado: null }] },
        'etc/pjsip-troncal.conf',
      );
      expect(t).toContain('403');
      expect(t).not.toContain('from_user =');
    });
  });

  describe('la API key y lo demás secreto', () => {
    it('la API key NO aparece en el dialplan: en ps aux y en el log es una llave filtrada', () => {
      const dialplan = contenido({}, 'etc/extensions.conf');
      expect(dialplan).not.toContain(DATOS.apiKey);
      expect(dialplan).toContain('-K /etc/asterisk/falcon-webhook.conf');
    });

    it('la API key vive en su archivo, y ese archivo no es legible por todos', () => {
      const a = generar().get('etc/falcon-webhook.conf')!;
      expect(a.contenido).toContain(`x-api-key: ${DATOS.apiKey}`);
      expect(a.modo).toBe('600');
      expect(a.secreto).toBe(true);
    });

    it('todo archivo que lleve una clave queda marcado como secreto y sin permiso de lectura general', () => {
      for (const a of generarConfiguracion(DATOS)) {
        const lleva = [DATOS.apiKey, DATOS.ariClave, 'clave-de-la-101'].some(
          (s) => a.contenido.includes(s),
        );
        if (lleva) {
          expect(a.secreto).toBe(true);
          expect(a.modo).not.toBe('644');
        }
      }
    });

    it('no quedan huecos de plantilla sin llenar', () => {
      const todos = generarConfiguracion(DATOS)
        .map((a) => a.contenido)
        .join('\n');
      for (const hueco of [
        'IP_PUBLICA',
        'CLAVE_',
        'DID_INFOBIP',
        'FQDN_INFOBIP',
        'URL_DE_FALCON',
      ]) {
        expect(todos).not.toContain(hueco);
      }
    });
  });

  describe('el dialplan', () => {
    it('cada número entra con «+» y sin «+»: «X» es un dígito y el «+» no lo es', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain('exten => +18335308128,1,Set(DESTINO=cola)');
      expect(dp).toContain('exten => 18335308128,1,Set(DESTINO=cola)');
      expect(dp).toContain('exten => +576042345678,1,Set(DESTINO=102)');
      expect(dp).toContain('exten => _+X.,1,Set(DESTINO=cola)');
    });

    it('un número que nadie registró también entra: no se rechaza una emergencia', () => {
      const dp = contenido({ numeros: [] }, 'etc/extensions.conf');
      expect(dp).toContain('exten => _+X.,1,Set(DESTINO=cola)');
      expect(dp).toContain('exten => _X.,1,Set(DESTINO=cola)');
    });

    it('las extensiones internas se marcan entre ellas', () => {
      expect(contenido({}, 'etc/extensions.conf')).toContain(
        'exten => _1XX,1,Set(DESTINO=${EXTEN})',
      );
    });

    it('avisa a FALCON sin bloquear el timbre: en segundo plano y con tope de 3 segundos', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain(
        'curl -s -m 3 -X POST ${FALCON_URL}/api/pbx/webhook',
      );
      expect(dp).toMatch(/"evento":"entrante".*&\)/);
    });

    it('el aviso de la cola va SIN extensión: todavía no se sabe quién va a contestar', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain(
        'Set(AVISO_EXT=${IF($["${DESTINO}" = "cola"]?:${DESTINO})})',
      );
    });

    it('cierra en la extensión h, que corre siempre que se cuelgue', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain('exten => h,1,');
      expect(dp).toMatch(/exten => h,1,[\s\S]*"evento":"colgada"/);
    });

    it('la URL de FALCON va sin barra final, para no armar «//api»', () => {
      expect(contenido({}, 'etc/extensions.conf')).toContain(
        'FALCON_URL = https://falconcad.com.co\n',
      );
    });

    it('graba solo cuando la llamada se establece, con el id que FALCON ya conoce', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain('MixMonitor(${GRABACIONES}/${UNIQUEID}.wav,b)');
    });

    it('la saliente conserva el «+» que espera la troncal, y se lo pone si no viene', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain('exten => _+X.,1,NoOp(FALCON saliente');
      expect(dp).toContain('exten => _X.,1,Goto(salientes,+${EXTEN},1)');
    });
  });

  describe('la cola de operadores', () => {
    it('lleva el nombre del municipio, para poder leerlo en los registros', () => {
      expect(nombreCola('Itagui')).toBe('cola-itagui');
      expect(contenido({}, 'etc/queues.conf')).toContain('[cola-itagui]');
      expect(contenido({}, 'etc/extensions.conf')).toContain(
        'COLA = cola-itagui',
      );
    });

    it('timbra en todos los puestos: en una línea de emergencias manda el tiempo de respuesta', () => {
      expect(contenido({}, 'etc/queues.conf')).toContain('strategy = ringall');
    });

    it('acepta llamadas aunque no haya nadie conectado', () => {
      const q = contenido({}, 'etc/queues.conf');
      expect(q).toContain('joinempty = yes');
      expect(q).toContain('leavewhenempty = no');
      expect(q).toContain('maxlen = 0');
    });

    it('el ciudadano oye timbre y no música: es lo que le dice que su llamada está viva', () => {
      expect(contenido({}, 'etc/extensions.conf')).toContain(
        'Queue(${COLA},r,,,120)',
      );
    });

    it('los miembros son los operadores con extensión', () => {
      const q = contenido({}, 'etc/queues.conf');
      expect(q).toContain('member => PJSIP/101,0,Puesto 1');
      expect(q).toContain('member => PJSIP/102,0,Puesto 2');
    });

    it('sin operadores no inventa miembros: dice qué falta', () => {
      const q = contenido({ operadores: [] }, 'etc/queues.conf');
      expect(q).not.toContain('member =>');
      expect(q).toContain('Sin operadores');
      expect(contenido({ operadores: [] }, 'etc/pjsip.conf')).toContain(
        'SIN OPERADORES',
      );
    });
  });

  describe('las extensiones de los operadores', () => {
    it('cada una con su clave, su webrtc y su transporte', () => {
      const pj = contenido({}, 'etc/pjsip.conf');
      expect(pj).toContain(
        '[101]\ntype = endpoint\ntransport = transport-ws\nwebrtc = yes',
      );
      expect(pj).toContain('password = clave-de-la-101');
      expect(pj).toContain('password = clave-de-la-102');
      expect(pj).toContain('max_contacts = 2');
    });

    it('un nombre con comillas o «<» no rompe la cabecera SIP', () => {
      const pj = contenido(
        {
          operadores: [
            { extension: '101', nombre: 'Ana "La <jefe>"; CAD', clave: 'x' },
          ],
        },
        'etc/pjsip.conf',
      );
      const linea = pj.split('\n').find((l) => l.startsWith('callerid ='))!;
      expect(linea).toMatch(/^callerid = [^"<>;,]+ <101>$/);
      expect(linea).toContain('Ana');
    });
  });

  describe('los puertos y los transportes', () => {
    it('el SIP escucha en el puerto que reparte FALCON, y anuncia la IP pública', () => {
      const pj = contenido({}, 'etc/pjsip.conf');
      expect(pj).toContain('bind = 0.0.0.0:5061');
      expect(pj).toContain('external_media_address = 129.80.243.118');
      expect(pj).toContain('external_signaling_address = 129.80.243.118');
    });

    it('el WebSocket solo escucha en 127.0.0.1: el TLS y la cara pública los pone nginx', () => {
      const pj = contenido({}, 'etc/pjsip.conf');
      expect(pj).toContain('bind = 127.0.0.1:8101');
      const http = contenido({}, 'etc/http.conf');
      expect(http).toContain('bindaddr = 127.0.0.1');
      expect(http).toContain('bindport = 8101');
      expect(http).not.toContain('bindaddr = 0.0.0.0');
    });

    it('por defecto el HTTP escucha en 127.0.0.1, que es lo más cerrado', () => {
      expect(contenido({}, 'etc/http.conf')).toContain('bindaddr = 127.0.0.1');
      expect(contenido({}, 'nginx/itagui-pbx.falconcad.com.co.conf')).toContain(
        'proxy_pass http://127.0.0.1:8101/ws;',
      );
    });

    it('la IP interna la deciden los datos, y http.conf y nginx NO pueden discrepar', () => {
      // El nginx que termina el TLS puede estar en un contenedor en red
      // bridge: ahí su 127.0.0.1 es él mismo, y el síntoma es un 502 en el
      // WebSocket y el botón «Llamar» mudo, sin una línea en ningún log. Lo
      // que importa es que los dos archivos salgan del MISMO dato: si uno
      // apunta a una IP y el otro a otra, no conecta y parecen correctos
      // leídos por separado.
      const cambios = { ipInterna: '172.17.0.1' };
      expect(contenido(cambios, 'etc/http.conf')).toContain(
        'bindaddr = 172.17.0.1',
      );
      const sitio = contenido(
        cambios,
        'nginx/itagui-pbx.falconcad.com.co.conf',
      );
      expect(sitio).toContain('proxy_pass http://172.17.0.1:8101/ws;');
      // ARI también: por ahí entra el botón «Llamar» del caso, y si se queda
      // en 127.0.0.1 falla SOLO esa función, que es más difícil de ver.
      expect(sitio).toContain('proxy_pass http://172.17.0.1:8101/ari/;');
      expect(sitio).not.toContain('127.0.0.1');
    });

    it('el RTP usa la tajada asignada, con ICE y STUN', () => {
      const rtp = contenido({}, 'etc/rtp.conf');
      expect(rtp).toContain('rtpstart = 21000');
      expect(rtp).toContain('rtpend = 21499');
      expect(rtp).toContain('icesupport = yes');
      expect(rtp).toContain('stunaddr = stun.l.google.com:19302');
    });

    it('el audio del navegador NO se abre en la dirección del WebSocket', () => {
      // LA NOCHE ENTERA. El transporte del WebSocket está en 127.0.0.1 porque
      // el TLS lo pone nginx, y Asterisk HEREDA la dirección del transporte
      // para abrir el socket RTP. Sin estas dos líneas el audio del operador
      // abría en 127.0.0.1: los paquetes del navegador rebotaban con «ICMP
      // port unreachable», Asterisk no podía enviar («Error sending STUN
      // request: Invalid argument») y el DTLS no arrancaba nunca. La llamada
      // entra, timbra, el operador contesta Y NO SE OYE NADA de ningún lado,
      // sin un solo mensaje que diga por qué.
      const p = contenido({ ipPrivada: '10.0.0.112' }, 'etc/pjsip.conf');
      // Una por operador, y las dos: «media_address» solo cambia el SDP; la
      // que abre el socket donde toca es «bind_rtp_to_media_address».
      expect(contar(p, 'media_address = 10.0.0.112')).toBe(2);
      expect(contar(p, 'bind_rtp_to_media_address = yes')).toBe(2);
    });

    it('sin IP privada declarada no inventa un media_address', () => {
      // Un servidor cuya IP pública está en la interfaz no necesita esto, y
      // poner una dirección equivocada ahí deja la planta sin audio.
      const p = contenido({}, 'etc/pjsip.conf');
      // Anclado al principio de línea: el comentario del archivo NOMBRA las
      // dos opciones para explicar por qué existen, y un `toContain` suelto
      // se daría por satisfecho con el comentario.
      expect(p).not.toMatch(/^media_address/m);
      expect(p).not.toMatch(/^bind_rtp_to_media_address/m);
    });

    it('con NAT 1:1 anuncia la pública y CONSERVA la privada', () => {
      const rtp = contenido({ ipPrivada: '10.0.0.112' }, 'etc/rtp.conf');
      expect(rtp).toContain('[ice_host_candidates]');
      // «include_local_address» no es un detalle: sin él Asterisk SUSTITUYE
      // la dirección, se queda sin una local real desde la cual enviar, y
      // falla con «Invalid argument» en cada envío. Con la dirección
      // correcta anunciada y nada desde donde mandarla, que es peor que no
      // tocarlo: parece bien configurado y no funciona.
      expect(rtp).toContain(
        '10.0.0.112 => 129.80.243.118,include_local_address',
      );
      // Y con esa sección NO va stunaddr: lo dice la documentación de
      // Asterisk, y en el servidor real el STUN nunca produjo el candidato.
      expect(rtp).not.toContain('stunaddr');
    });

    it('sin NAT 1:1 se queda con el STUN de siempre', () => {
      const rtp = contenido({}, 'etc/rtp.conf');
      expect(rtp).toContain('stunaddr = stun.l.google.com:19302');
      expect(rtp).not.toContain('[ice_host_candidates]');
    });

    it('si la privada ES la pública, no hay NAT que compensar', () => {
      // Un servidor con su IP pública en la interfaz: mapear ahí sería
      // anunciar la misma dirección dos veces.
      const rtp = contenido({ ipPrivada: '129.80.243.118' }, 'etc/rtp.conf');
      expect(rtp).not.toContain('[ice_host_candidates]');
      expect(rtp).toContain('stunaddr');
    });

    it('descarta los puentes de Docker de los candidatos ICE', () => {
      // El contenedor va en la red del host: Asterisk ve «docker0» y un
      // «br-xxxx» por cada stack de Docker de la máquina —en el primer
      // servidor real eran CUATRO— y ofrecía todas esas 172.x al navegador,
      // que no puede alcanzar ninguna.
      const rtp = contenido({ ipPrivada: '10.0.0.112' }, 'etc/rtp.conf');
      expect(rtp).toContain('ice_deny = 172.16.0.0/12');
      expect(rtp).toContain('ice_deny = 192.168.0.0/16');
      expect(rtp).toContain('ice_deny = 169.254.0.0/16');
    });

    it('nunca descarta la red donde vive el propio servidor', () => {
      // Negar el rango que contiene la IP real dejaría a la planta sin un
      // solo candidato: el remedio peor que la enfermedad.
      const rtp = contenido({ ipPrivada: '172.31.5.9' }, 'etc/rtp.conf');
      expect(rtp).not.toContain('ice_deny = 172.16.0.0/12');
      expect(rtp).toContain('ice_deny = 192.168.0.0/16');
      const otro = contenido({ ipPrivada: '192.168.7.3' }, 'etc/rtp.conf');
      expect(otro).not.toContain('ice_deny = 192.168.0.0/16');
      expect(otro).toContain('ice_deny = 172.16.0.0/12');
    });

    it('sin número de respaldo NO emite tramo de desborde', () => {
      // Marcar a un número vacío manda la llamada a un error de la troncal en
      // vez de a un timbre, que es peor que colgar.
      const ext = contenido({}, 'etc/extensions.conf');
      expect(ext).not.toContain('n(desborde)');
      expect(ext).not.toContain('"desborde"');
    });

    it('con número de respaldo, la cola agotada marca hacia allá', () => {
      const ext = contenido(
        { numeroDesborde: '+573001234567' },
        'etc/extensions.conf',
      );
      expect(ext).toContain('n(desborde)');
      expect(ext).toContain('Dial(PJSIP/+573001234567@troncal,60)');
    });

    it('desborda también con la sala VACÍA, que es lo que de verdad asusta', () => {
      // TIMEOUT es que timbró y nadie contestó. JOINEMPTY y LEAVEEMPTY son que
      // no había un solo operador conectado: la madrugada. Dejar caer la
      // llamada justo ahí es dejarla caer cuando el respaldo es lo único que
      // hay.
      const ext = contenido(
        { numeroDesborde: '+573001234567' },
        'etc/extensions.conf',
      );
      expect(ext).toContain('"${QUEUESTATUS}" = "TIMEOUT"');
      expect(ext).toContain('"${QUEUESTATUS}" = "JOINEMPTY"');
      expect(ext).toContain('"${QUEUESTATUS}" = "LEAVEEMPTY"');
    });

    it('avisa a FALCON ANTES de marcar, y sin esperarlo', () => {
      // Si FALCON está caído, la llamada igual tiene que desbordarse. La
      // telefonía nunca espera al software: por eso el «&».
      const ext = contenido(
        { numeroDesborde: '+573001234567' },
        'etc/extensions.conf',
      );
      const aviso = ext.indexOf('"evento":"desborde"');
      const marca = ext.indexOf('Dial(PJSIP/+573001234567@troncal');
      expect(aviso).toBeGreaterThan(0);
      expect(aviso).toBeLessThan(marca);
      // El «&» está en la misma línea del curl, no en cualquier parte.
      const linea = ext.slice(ext.lastIndexOf('\n', aviso) + 1);
      expect(linea.slice(0, linea.indexOf('\n'))).toContain('&)');
    });

    it('la API key del desborde tampoco va en la línea de comandos', () => {
      // Lo que se pasa en la línea de System() aparece en «ps aux» para
      // cualquier usuario del servidor y se escribe en el log de cada llamada.
      const ext = contenido(
        { numeroDesborde: '+573001234567' },
        'etc/extensions.conf',
      );
      const linea = ext
        .split('\n')
        .find((l) => l.includes('"evento":"desborde"'))!;
      expect(linea).toContain('-K /etc/asterisk/falcon-webhook.conf');
      expect(linea).not.toContain('x-api-key');
    });

    it('la espera en cola sale de los datos, no de un número clavado', () => {
      expect(contenido({ timbreCola: 45 }, 'etc/extensions.conf')).toContain(
        'Queue(${COLA},r,,,45)',
      );
      expect(contenido({}, 'etc/extensions.conf')).toContain(
        'Queue(${COLA},r,,,120)',
      );
    });

    it('chan_sip queda fuera, y el noload va DENTRO de [modules]', () => {
      const m = contenido({}, 'etc/modules.conf');
      expect(m).toContain('noload => chan_sip.so');
      // No basta con que aparezca después de [modules]: este archivo está por
      // secciones, y un noload que caiga en OTRA sección se ignora en
      // silencio. Así que entre [modules] y el noload no puede haber otra
      // cabecera de sección.
      const desde = m.indexOf('[modules]');
      const hasta = m.indexOf('noload => chan_sip.so');
      expect(desde).toBeGreaterThanOrEqual(0);
      expect(desde).toBeLessThan(hasta);
      expect(m.slice(desde + '[modules]'.length, hasta)).not.toMatch(
        /^\s*\[[^\]]+\]/m,
      );
    });

    it('el asterisk.conf fija las rutas, porque el montaje tapa el del paquete', () => {
      // La carpeta «etc/» de la planta se monta COMO /etc/asterisk: lo que no
      // generemos, no existe en el contenedor. Sin este archivo Asterisk
      // arranca con los valores con que se compiló la imagen, y cada
      // `asterisk -rx` empieza con «Unable to open specified master config
      // file» — que hace que toda comprobación parezca una falla.
      const a = contenido({}, 'etc/asterisk.conf');
      expect(a).toContain('[directories]');
      expect(a).toContain('astetcdir => /etc/asterisk');
      // Las tres rutas que el compose monta como volumen tienen que coincidir
      // con lo que dice este archivo, o Asterisk escribe donde nadie mira.
      expect(a).toContain('astspooldir => /var/spool/asterisk');
      expect(a).toContain('astlogdir => /var/log/asterisk');
    });

    it('el asterisk.conf NO fija astmoddir', () => {
      // Es la única ruta que, mal puesta, deja a Asterisk sin cargar un solo
      // módulo: la planta muerta y sin decir por qué. El valor de compilación
      // de la imagen ya es el correcto, y omitirlo es lo que lo mantiene
      // correcto si la imagen base cambia de ruta. Esto NO es una omisión: es
      // la decisión, y este test está para que nadie la «complete».
      const a = contenido({}, 'etc/asterisk.conf');
      // `contenido` devuelve '' cuando el archivo no existe, así que una
      // negación sola pasaría también si el archivo faltara.
      expect(a).toContain('[directories]');
      expect(a).not.toContain('astmoddir =');
    });

    it('el logger.conf manda a archivo, y deja «full» apagado', () => {
      // Sin logger.conf Asterisk solo habla por consola: la carpeta «log/» de
      // la planta queda vacía y un problema de hace dos horas no se puede
      // mirar.
      const l = contenido({}, 'etc/logger.conf');
      expect(l).toContain('[logfiles]');
      expect(l).toMatch(/^messages => /m);
      // «full» lleva debug y verbose: en una planta con tráfico crece en gigas
      // y el disco lo comparten todas las plantas del servidor. Se enciende en
      // vivo cuando hace falta, no por archivo.
      expect(l).not.toMatch(/^full => /m);
    });
  });

  describe('el contenedor y nginx', () => {
    it('el contenedor va en la red del host y se llama por el municipio', () => {
      const c = contenido({}, 'docker-compose.yml');
      expect(c).toContain('network_mode: host');
      expect(c).toContain('container_name: asterisk-itagui');
      // Una imagen para todos los municipios: si fuera por municipio,
      // actualizar Asterisk sería un trabajo por municipio.
      expect(c).toContain('image: falcon-pbx:2');
    });

    it('nginx enruta por nombre al puerto de ESTA planta, con su propio certificado', () => {
      const n = generar().get(
        'nginx/itagui-pbx.falconcad.com.co.conf',
      )!.contenido;
      expect(n).toContain('server_name itagui-pbx.falconcad.com.co;');
      expect(n).toContain('proxy_pass http://127.0.0.1:8101/ws;');
      // El certificado de ESTE nombre: es el que deja `certbot certonly
      // --nginx -d <nombre>` sin configurar la API de ningún DNS. Un comodín
      // solo se emite validando por DNS, y para unos pocos municipios no se
      // paga esa complicación.
      expect(n).toContain(
        '/etc/letsencrypt/live/itagui-pbx.falconcad.com.co/fullchain.pem',
      );
      expect(n).toContain(
        '/etc/letsencrypt/live/itagui-pbx.falconcad.com.co/privkey.pem',
      );
      // Y la orden exacta queda escrita en el archivo, para no ir a buscarla.
      expect(n).toContain(
        'certbot certonly --nginx -d itagui-pbx.falconcad.com.co',
      );
      expect(n).toContain('proxy_set_header Upgrade $http_upgrade;');
    });

    it('una llamada larga no muere por inactividad de la señalización', () => {
      const n = generar().get(
        'nginx/itagui-pbx.falconcad.com.co.conf',
      )!.contenido;
      expect(n).toContain('proxy_read_timeout 3600s;');
    });

    it('de Asterisk no se expone nada más que el WebSocket y ARI', () => {
      const n = generar().get(
        'nginx/itagui-pbx.falconcad.com.co.conf',
      )!.contenido;
      expect(n).toContain('location /ws');
      expect(n).toContain('location /ari/');
      expect(n).toMatch(/location \/ \{\s*return 404;/);
    });
  });

  describe('la grabación de la llamada', () => {
    it('graba solo cuando la llamada se establece y avisa a FALCON al terminar', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      expect(dp).toContain(
        'MixMonitor(${GRABACIONES}/${UNIQUEID}.wav,b,bash /etc/asterisk/subir-grabacion.sh ^{UNIQUEID})',
      );
    });

    it('la saliente se graba pero NO se sube: FALCON no tiene esa llamada registrada', () => {
      const dp = contenido({}, 'etc/extensions.conf');
      const salientes = dp.slice(dp.indexOf('[salientes]'));
      expect(salientes).toContain('MixMonitor(');
      expect(salientes).not.toContain('subir-grabacion.sh');
    });

    it('el script de subida es válido para bash', () => {
      const ruta = join(
        mkdtempSync(join(tmpdir(), 'falcon-grab-')),
        'subir.sh',
      );
      writeFileSync(ruta, contenido({}, 'etc/subir-grabacion.sh'));
      expect(() => execFileSync('bash', ['-n', ruta])).not.toThrow();
    });

    it('sube con la credencial SIN Content-Type: la del webhook rompería el multipart', () => {
      const sh = contenido({}, 'etc/subir-grabacion.sh');
      expect(sh).toContain('-K /etc/asterisk/falcon-api.conf');
      expect(sh).not.toContain('falcon-webhook.conf');

      const api = generar().get('etc/falcon-api.conf')!;
      expect(api.contenido).toContain('x-api-key: fk_la_llave_de_itagui');
      // Lo que no puede llevar es la CABECERA; nombrarla en el comentario que
      // explica por qué no está es justamente lo que se quiere.
      expect(api.contenido).not.toMatch(/^header\s*=\s*"Content-Type/m);
      expect(api.modo).toBe('600');
      expect(api.secreto).toBe(true);

      // Y la del webhook sigue llevándolo, que es lo que el aviso necesita.
      expect(generar().get('etc/falcon-webhook.conf')!.contenido).toMatch(
        /^header\s*=\s*"Content-Type: application\/json"/m,
      );
    });

    it('va al endpoint de grabaciones de ESTA instancia', () => {
      expect(contenido({}, 'etc/subir-grabacion.sh')).toContain(
        'URL="https://falconcad.com.co/api/pbx/grabacion"',
      );
    });

    it('SOLO borra el archivo local cuando FALCON confirma', () => {
      const sh = contenido({}, 'etc/subir-grabacion.sh');
      const dosXX = sh.slice(sh.indexOf('  2*)'), sh.indexOf('  *)'));
      const fallo = sh.slice(sh.indexOf('  *)'));
      // En el camino bueno se borra el WAV; en el malo se conserva y se dice.
      expect(dosXX).toContain('rm -f "$WAV"');
      expect(fallo).not.toContain('rm -f "$WAV"');
      expect(fallo).toContain('se conserva');
    });

    it('comprime si puede y sube el WAV si no: la grabación no depende de un paquete', () => {
      const sh = contenido({}, 'etc/subir-grabacion.sh');
      expect(sh).toContain('command -v lame');
      expect(sh).toContain('SUBIR="$WAV"');
      expect(sh).toContain('se sube el WAV');
    });

    it('deja escrito cada fallo con su motivo: nadie está mirando cuando pasa', () => {
      const sh = contenido({}, 'etc/subir-grabacion.sh');
      expect(sh).toContain('falcon-grabaciones.log');
      // Sin `set -e`: lo que hace falta es que cada paso que falle quede
      // anotado, no que el script muera en el primero.
      expect(sh).toContain('set -uo pipefail');
      expect(sh).not.toContain('set -euo pipefail');
    });
  });

  describe('el script que instala la planta', () => {
    const script = (cambios: Partial<DatosPlanta> = {}): ArchivoGenerado =>
      generar(cambios).get('aplicar.sh')!;

    it('es válido para bash: un heredoc roto ejecutaría el dialplan como comandos, y como root', () => {
      const ruta = join(
        mkdtempSync(join(tmpdir(), 'falcon-planta-')),
        'aplicar.sh',
      );
      writeFileSync(ruta, script().contenido);
      // `bash -n` solo analiza, no ejecuta. Si el heredoc de cualquier
      // archivo quedara mal cerrado, aquí se ve; en el servidor se vería
      // ejecutando lo que viniera después del corte.
      expect(() => execFileSync('bash', ['-n', ruta])).not.toThrow();
    });

    it('lleva dentro todos los demás archivos, con su modo', () => {
      const todos = generarConfiguracion(DATOS);
      const sh = todos.find((a) => a.ruta === 'aplicar.sh')!;
      for (const a of todos.filter((x) => x.ruta !== 'aplicar.sh')) {
        expect(sh.contenido).toContain(`/opt/falcon-pbx/itagui/${a.ruta}`);
        expect(sh.contenido).toContain(
          `chmod ${a.modo} "/opt/falcon-pbx/itagui/${a.ruta}"`,
        );
      }
    });

    it('respeta la carpeta que diga quien provisiona: el script y la pantalla no pueden discrepar', () => {
      expect(script({ carpeta: '/srv/plantas/itagui' }).contenido).toContain(
        '/srv/plantas/itagui/etc/pjsip.conf',
      );
    });

    it('elige otro delimitador si el contenido contiene el suyo', () => {
      const conTrampa = script({
        troncales: [{ ...DATOS.troncales[0], nombre: 'FALCON_EOF' }],
      }).contenido;
      expect(conTrampa).toContain("<<'FALCON_EOF_1'");
      const ruta = join(
        mkdtempSync(join(tmpdir(), 'falcon-planta-')),
        'trampa.sh',
      );
      writeFileSync(ruta, conTrampa);
      expect(() => execFileSync('bash', ['-n', ruta])).not.toThrow();
    });

    it('construye la imagen si falta, en vez de mandar a buscar el repositorio', () => {
      const c = script().contenido;
      // El servidor de telefonía no tiene por qué tener una copia del
      // repositorio ni credenciales de git: lo único que llega es este
      // archivo, y trae el Dockerfile dentro.
      expect(c).toContain('docker build -t falcon-pbx:2');
      expect(c).toContain('/opt/falcon-pbx/itagui/imagen');
      expect(c).not.toContain('del repositorio');
      expect(generar().has('imagen/Dockerfile')).toBe(true);
    });

    it('parte de Ubuntu 24.04: ni Debian, ni la 22.04 con su Asterisk viejo', () => {
      const d = contenido({}, 'imagen/Dockerfile');
      // Debian 12 retiró el paquete: «Package 'asterisk' has no installation
      // candidate» y la imagen no se construye. Y la 22.04 trae Asterisk
      // 18.10, anterior a varias correcciones de ICE; la 24.04 trae la 20,
      // que es LTS.
      expect(d).toContain('FROM ubuntu:24.04');
      expect(d).not.toContain('debian');
      // Y sin frontend interactivo, o la construcción se cuelga esperando la
      // zona horaria.
      expect(d).toContain('DEBIAN_FRONTEND=noninteractive');
    });

    it('la imagen trae lo que el dialplan y la grabación necesitan', () => {
      const d = contenido({}, 'imagen/Dockerfile');
      // curl es como el dialplan avisa a FALCON; lame es lo que hace que la
      // grabación cueste cinco veces menos al viajar y al guardarse.
      expect(d).toContain('asterisk');
      expect(d).toContain('curl');
      expect(d).toContain('lame');
      expect(d).toContain('CMD ["asterisk", "-f", "-vvv"]');
    });

    it('es el archivo más sensible del conjunto y lo trata como tal', () => {
      const sh = script();
      expect(sh.modo).toBe('600');
      expect(sh.secreto).toBe(true);
      expect(sh.contenido).toContain('shred -u aplicar.sh');
    });

    it('prueba nginx antes de recargarlo: un nginx caído se lleva a los otros municipios', () => {
      const c = script().contenido;
      // La ORDEN, no la palabra: el comentario que explica por qué no se
      // recarga un nginx detenido también dice «systemctl reload nginx», y
      // buscar la palabra suelta hacía que esta prueba se midiera contra su
      // propia explicación.
      expect(c.indexOf('if nginx -t; then')).toBeLessThan(
        c.indexOf('\n    systemctl reload nginx'),
      );
    });

    it('si el 443 no es del nginx del sistema, no enlaza nada y dice qué falta', () => {
      const c = script().contenido;
      // Enlazar en un nginx que no sirve el 443 no hace nada —el archivo queda
      // escrito y el navegador sigue sin llegar— y recargar uno detenido
      // abortaría la instalación antes de levantar la planta.
      expect(c).toContain('systemctl is-active --quiet nginx');
      expect(c).toContain('no está sirviendo el 443');
      expect(c).toContain('docker cp');
      // Y la planta se levanta igual: la troncal es lo que no puede esperar.
      expect(c).toContain('la planta YA atiende la troncal');
      expect(c.indexOf('no está sirviendo el 443')).toBeLessThan(
        c.indexOf('docker compose up -d'),
      );
    });

    it('reinicia y no recarga: «reload» no descarga módulos, y hay un noload de chan_sip', () => {
      expect(script().contenido).toContain('docker compose restart');
    });

    it('exige root y falla pronto, en vez de dejar media planta escrita', () => {
      const c = script().contenido;
      expect(c).toContain('set -euo pipefail');
      expect(c).toContain('Ejecútelo como root');
    });

    it('dice lo que NO hace, que es donde se queda la gente esperando', () => {
      const c = script().contenido;
      expect(c).toContain('abrir en la nube udp 5061');
      expect(c).toContain('udp 21000-21499');
      expect(c).toContain('entregue en este servidor:5061');
    });

    it('comprueba al final lo que suele estar mal', () => {
      const c = script().contenido;
      expect(c).toContain('pjsip show transports');
      expect(c).toContain('pjsip show aors');
      expect(c).toContain('queue show cola-itagui');
      expect(c).toContain('module show like chan_sip');
    });
  });

  /**
   * LA COPIA DE LA INSTALACIÓN A MANO NO PUEDE DIVERGIR EN LO QUE IMPORTA.
   *
   * `deploy/asterisk/activar-grabacion.sh` enciende la grabación en la
   * centralita que instalamos a mano, sin migrarla al contenedor, y para eso
   * lleva su propia copia del script de subida. Son dos copias, y dos copias
   * de algo que nadie mira a diario es una que se queda vieja.
   *
   * No se exige que sean iguales —la de aquí lleva rutas de la planta
   * generada— sino que cumplan las tres cosas por las que ese script existe.
   * Si alguna se pierde en una de las dos, esto lo dice.
   */
  describe('la copia para la instalación a mano', () => {
    // El script lleva el de subida DENTRO, en un heredoc sin comillas, así
    // que sus `$` vienen escapados (`\$WAV`). Se desescapan para poder
    // comparar lo que importa y no la forma de incrustarlo.
    const aMano = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'deploy',
        'asterisk',
        'activar-grabacion.sh',
      ),
      'utf8',
    ).replace(/\\\$/g, '$');

    it('solo borra el archivo local cuando FALCON confirma', () => {
      const dosXX = aMano.slice(aMano.indexOf('  2*)'), aMano.indexOf('  *)'));
      const fallo = aMano.slice(aMano.indexOf('  *)'));
      expect(dosXX).toContain('rm -f "$WAV"');
      expect(fallo).not.toContain('rm -f "$WAV"');
      expect(fallo).toContain('se conserva');
    });

    it('comprime si puede y sube el WAV si no', () => {
      expect(aMano).toContain('command -v lame');
      expect(aMano).toContain('se sube el WAV');
    });

    it('sube con la credencial sin Content-Type, no con la del webhook', () => {
      expect(aMano).toContain('-K /etc/asterisk/falcon-api.conf');
      // Y NO rota la llave: reutiliza la que la centralita ya tiene, para no
      // dejar el webhook mudo a cambio de encender la grabación.
      expect(aMano).toContain('no se rota');
    });

    it('deja cada fallo escrito, porque nadie está mirando cuando pasa', () => {
      expect(aMano).toContain('falcon-grabaciones.log');
      expect(aMano).toContain('set -uo pipefail');
    });
  });

  it('todo archivo dice que lo generó FALCON, para que nadie lo edite en el servidor', () => {
    for (const a of generarConfiguracion(DATOS)) {
      expect(a.contenido).toContain('GENERADO POR FALCON');
      expect(a.contenido.length).toBeGreaterThan(80);
    }
  });
});
