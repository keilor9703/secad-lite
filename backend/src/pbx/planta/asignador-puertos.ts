/**
 * EL ASIGNADOR DE PUERTOS — lo que hace que dar de alta un municipio sea
 * llenar un formulario y no una sesión de terminal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA
 *
 * Nuestra arquitectura es **un Asterisk por instancia sobre un servidor
 * compartido**: un contenedor por municipio, aislados entre sí. Lo que NO se
 * puede aislar en un servidor compartido son los puertos: si dos contenedores
 * publican el 5060, el segundo no arranca; si dos publican rangos RTP que se
 * cruzan, el audio de un municipio puede entrar por el puerto del otro.
 *
 * Hoy eso se resuelve a mano —se mira `ss -lntup`, se elige un número libre y
 * se escribe en tres archivos—. A la tercera instancia eso se equivoca, y el
 * síntoma aparece en producción, en una llamada al 123.
 *
 * Así que esta decisión se escribe UNA vez, aquí, como función pura: entra la
 * lista de lo que ya está ocupado en ese servidor y sale la primera ranura
 * libre. Pura a propósito: la parte que no se puede probar con una base de
 * datos de verdad es justo la que tiene que estar probada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA «RANURA» Y NO DOS CONTADORES INDEPENDIENTES
 *
 * Una planta necesita dos cosas: un puerto de señalización (SIP) y una tajada
 * de puertos para el audio (RTP). Se podrían asignar por separado, y entonces
 * la planta 3 tendría el SIP de la 3 y el RTP de la 7 — nadie entiende eso
 * mirando `ss`, ni en pantalla, ni a las dos de la mañana.
 *
 * Con una ranura `n`, SIP y RTP se derivan del MISMO número: la ranura 3 es el
 * puerto 5063 y el rango 22000–22499. Se lee de corrido. El costo es que una
 * ranura se salta entera si cualquiera de sus dos mitades está tomada, y a
 * cambio el servidor se puede auditar de un vistazo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN LAS BANDAS (los números no son arbitrarios)
 *
 *  - **RTP arranca en 20500 y no en 10000**, porque 10000–20000 es el rango
 *    POR DEFECTO de Asterisk y es el que usa la centralita que ya instalamos
 *    a mano: la banda nueva no se cruza con lo que ya está corriendo.
 *
 *  - **RTP termina en 32499 y no más arriba**, porque en Linux
 *    `net.ipv4.ip_local_port_range` empieza en 32768: a partir de ahí el
 *    kernel reparte puertos a cualquier socket saliente del servidor. Un
 *    rango RTP ahí arriba funciona durante semanas y un día un `curl` toma el
 *    puerto antes que Asterisk, y el audio de UNA llamada se cae sin dejar
 *    rastro en ningún log. Esa clase de fallo no se diagnostica: se evita.
 *
 *  - **500 puertos por planta** son 250 llamadas simultáneas (RTP y RTCP van
 *    en pares), contra los 10 canales que da una troncal. Sobra por un factor
 *    de 25, y así caben 24 plantas por servidor — más contenedores de los que
 *    aguanta cómodamente una máquina de este tamaño, que es el límite real.
 *
 *  - **No hay banda de puertos TLS/WSS por planta**, y esa ausencia es una
 *    decisión: el navegador del operador entra por nginx en el 443 y se enruta
 *    POR NOMBRE (`itagui-pbx.…` → su contenedor). Un puerto por instancia
 *    obligaría a abrir un puerto en la nube por municipio y a un certificado
 *    por puerto; un nombre no cuesta nada.
 *
 *  - **HTTP/ARI arranca en 8100**, por encima del 8088 que ya usa `secad-api`
 *    en el servidor donde montamos la centralita. Ese choque ya nos pasó:
 *    Asterisk intentó tomar el 8088, no pudo, y el síntoma fue un «Server
 *    Disabled» que además se llevó el WebSocket del 8089 —o sea, el
 *    softphone— sin decir en ningún lado que el puerto estaba ocupado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL CONTENEDOR VA EN LA RED DEL HOST, Y POR QUÉ ESO HACE ESTO
 * IMPRESCINDIBLE EN VEZ DE OPCIONAL
 *
 * Un contenedor con red propia tendría sus puertos aislados y nada de esto
 * haría falta. No se puede, por dos razones de telefonía:
 *
 *  1. **Publicar un rango RTP por el NAT de Docker es inviable.** Son cientos
 *     de puertos UDP por instancia, y `docker-proxy` abre un proceso por
 *     puerto publicado.
 *  2. **Lo que la planta ORIGINA saldría con otro puerto.** La troncal entra
 *     bien por DNAT, pero el keepalive OPTIONS, el registro y la llamada
 *     saliente salen con un puerto de origen que el SBC del operador no
 *     reconoce, y los rechaza con 403. Ya vimos un 403 de Infobip por otro
 *     motivo (`From: anonymous`) y costó media tarde de captura de tráfico.
 *
 * Así que el contenedor comparte la pila de red del host: el aislamiento que
 * buscamos es el de la CONFIGURACIÓN —que un `extensions.conf` mal editado no
 * pueda tumbar la línea de otro municipio—, no el de la red. El precio es que
 * TODOS los puertos que escucha la planta son del host y tienen que ser
 * únicos: el SIP, la tajada RTP y el de HTTP/ARI. De ahí este archivo.
 */

/** Los puertos que ocupa UNA planta en el servidor. */
export interface RanuraPuertos {
  /** Señalización SIP (UDP), por donde entra la troncal del operador. */
  puertoSip: number;
  /** Tajada de audio, inclusive. */
  rtpDesde: number;
  rtpHasta: number;
  /**
   * HTTP de Asterisk: el WebSocket del softphone y la interfaz ARI. Escucha
   * en 127.0.0.1 y lo publica nginx en el 443 por nombre; nunca se abre en la
   * nube.
   */
  puertoHttp: number;
}

/** Las bandas de un servidor y lo que en él no se puede tocar. */
export interface PlanDePuertos {
  /** Banda de señalización, inclusive. */
  sipDesde: number;
  sipHasta: number;
  /** Banda de audio, inclusive. */
  rtpDesde: number;
  rtpHasta: number;
  /** Tamaño de la tajada RTP de cada planta. Par: RTP y RTCP van en pares. */
  puertosRtpPorPlanta: number;
  /** Banda de HTTP/ARI, inclusive. Solo escucha en 127.0.0.1. */
  httpDesde: number;
  httpHasta: number;
  /**
   * Puertos del servidor que son de otro servicio y que ninguna planta puede
   * recibir — ni como puerto SIP, ni dentro de su tajada RTP.
   *
   * No es paranoia: el servidor donde está la centralita de pruebas también
   * corre SECAD, FALCON test y coturn, y el 3478 de coturn fue justamente el
   * que tuvimos que prestarle a SIP cuando no se podía abrir un puerto nuevo.
   */
  reservados: readonly number[];
}

/** El plan de un servidor nuestro recién puesto. Ver la cabecera. */
export const PLAN_POR_DEFECTO: PlanDePuertos = {
  sipDesde: 5060,
  sipHasta: 5083,
  rtpDesde: 20500,
  rtpHasta: 32499,
  puertosRtpPorPlanta: 500,
  httpDesde: 8100,
  httpHasta: 8123,
  reservados: [],
};

export type ResultadoRanura =
  { ok: true; ranura: RanuraPuertos } | { ok: false; error: string };

/** Cuántas plantas caben en el plan: la banda más corta manda. */
export function cuantasRanuras(plan: PlanDePuertos): number {
  const porSip = plan.sipHasta - plan.sipDesde + 1;
  const porRtp = Math.floor(
    (plan.rtpHasta - plan.rtpDesde + 1) / plan.puertosRtpPorPlanta,
  );
  const porHttp = plan.httpHasta - plan.httpDesde + 1;
  return Math.max(0, Math.min(porSip, porRtp, porHttp));
}

/** Los puertos que le tocan a la ranura `n`, o null si ya no está en banda. */
export function ranuraDe(
  n: number,
  plan: PlanDePuertos = PLAN_POR_DEFECTO,
): RanuraPuertos | null {
  if (n < 0 || n >= cuantasRanuras(plan)) return null;
  const rtpDesde = plan.rtpDesde + n * plan.puertosRtpPorPlanta;
  return {
    puertoSip: plan.sipDesde + n,
    rtpDesde,
    rtpHasta: rtpDesde + plan.puertosRtpPorPlanta - 1,
    puertoHttp: plan.httpDesde + n,
  };
}

/**
 * La primera ranura libre del servidor.
 *
 * `ocupadas` son las plantas que YA están en ese servidor; quien edita una
 * planta existente tiene que excluir su propia fila, o chocará consigo misma.
 *
 * **Reutiliza los huecos.** Si se da de baja un municipio, su ranura vuelve a
 * la bolsa en vez de quedar quemada para siempre: la banda es finita y un
 * servidor de pruebas se provisiona y se desprovisiona muchas veces. Es
 * seguro porque la ranura se reutiliza sobre un contenedor NUEVO: el endpoint
 * SIP autentica a quien se registra, y Asterisk descarta con `strictrtp` el
 * audio que no pertenece a una sesión viva suya.
 */
export function asignarRanura(
  ocupadas: readonly RanuraPuertos[],
  plan: PlanDePuertos = PLAN_POR_DEFECTO,
): ResultadoRanura {
  const malElPlan = revisarPlan(plan);
  if (malElPlan) return { ok: false, error: malElPlan };

  const cuantas = cuantasRanuras(plan);
  for (let n = 0; n < cuantas; n++) {
    const ranura = ranuraDe(n, plan)!;
    if (!revisarChoques(ranura, ocupadas, plan)) return { ok: true, ranura };
  }

  return {
    ok: false,
    error:
      `Este servidor ya no tiene puertos libres: su plan admite ${cuantas} plantas ` +
      `(SIP ${plan.sipDesde}–${plan.sipHasta}, RTP ${plan.rtpDesde}–${plan.rtpHasta}) ` +
      'y están todas tomadas. Agregue un servidor o amplíe las bandas.',
  };
}

/**
 * Por qué estos puertos no se pueden usar, o null si se pueden.
 *
 * Se usa para validar lo que un administrador escribe A MANO, y por eso NO
 * exige que los puertos estén dentro de la banda: la centralita que ya está
 * corriendo escucha SIP en el 3478 —un puerto que le prestamos a coturn
 * cuando no podíamos abrir ninguno nuevo— y tiene que poder quedar registrada
 * tal como está. Lo que sí se rechaza es lo que rompe: un puerto de otro
 * servicio y un cruce con otra planta.
 */
export function revisarChoques(
  ranura: RanuraPuertos,
  ocupadas: readonly RanuraPuertos[],
  plan: PlanDePuertos = PLAN_POR_DEFECTO,
): string | null {
  const malFormada = revisarForma(ranura);
  if (malFormada) return malFormada;

  // Con el contenedor en la red del host, los tres puertos viven en el MISMO
  // espacio: el HTTP de una planta y el SIP de otra se pelean igual que dos
  // SIP. Así que no se comparan campo contra campo —que es lo que uno escribe
  // por descuido y deja justo ese hueco—, sino el conjunto completo contra el
  // conjunto completo.
  const sueltos = puertosSueltos(ranura);

  for (const reservado of plan.reservados) {
    const mio = sueltos.find((s) => s.puerto === reservado);
    if (mio) {
      return `El puerto ${reservado} (${mio.rol}) es de otro servicio de este servidor.`;
    }
    if (dentro(reservado, ranura)) {
      return (
        `El rango RTP ${ranura.rtpDesde}–${ranura.rtpHasta} contiene el puerto ${reservado}, ` +
        'que es de otro servicio de este servidor.'
      );
    }
  }

  for (const otra of ocupadas) {
    const ajenos = puertosSueltos(otra);
    for (const mio of sueltos) {
      const choque = ajenos.find((a) => a.puerto === mio.puerto);
      if (choque) {
        return (
          `El puerto ${mio.puerto} (${mio.rol}) ya lo usa otra planta de este servidor` +
          `${choque.rol === mio.rol ? '' : ` como puerto ${choque.rol}`}.`
        );
      }
      if (dentro(mio.puerto, otra)) {
        return (
          `El puerto ${mio.puerto} (${mio.rol}) cae dentro del rango RTP de otra planta ` +
          `de este servidor (${otra.rtpDesde}–${otra.rtpHasta}).`
        );
      }
    }
    for (const ajeno of ajenos) {
      if (dentro(ajeno.puerto, ranura)) {
        return (
          `El rango RTP ${ranura.rtpDesde}–${ranura.rtpHasta} contiene el puerto ` +
          `${ajeno.puerto}, que otra planta de este servidor usa como puerto ${ajeno.rol}.`
        );
      }
    }
    if (ranura.rtpDesde <= otra.rtpHasta && otra.rtpDesde <= ranura.rtpHasta) {
      return (
        `El rango RTP ${ranura.rtpDesde}–${ranura.rtpHasta} se cruza con el de otra planta ` +
        `de este servidor (${otra.rtpDesde}–${otra.rtpHasta}).`
      );
    }
  }

  return null;
}

/** Los puertos sueltos de una planta, con el nombre que entiende un humano. */
function puertosSueltos(r: RanuraPuertos): { puerto: number; rol: string }[] {
  return [
    { puerto: r.puertoSip, rol: 'SIP' },
    { puerto: r.puertoHttp, rol: 'HTTP/ARI' },
  ];
}

function dentro(puerto: number, r: RanuraPuertos): boolean {
  return puerto >= r.rtpDesde && puerto <= r.rtpHasta;
}

/** Lo que está mal en la ranura misma, sin mirar a las demás. */
function revisarForma(ranura: RanuraPuertos): string | null {
  for (const { puerto, rol } of puertosSueltos(ranura)) {
    if (!enteroPositivo(puerto) || puerto > 65535) {
      return `«${puerto}» no es un puerto válido (${rol}).`;
    }
  }
  if (
    !enteroPositivo(ranura.rtpDesde) ||
    !enteroPositivo(ranura.rtpHasta) ||
    ranura.rtpHasta > 65535
  ) {
    return `«${ranura.rtpDesde}–${ranura.rtpHasta}» no es un rango de puertos válido.`;
  }
  if (ranura.rtpHasta < ranura.rtpDesde) {
    return `El rango RTP está al revés: ${ranura.rtpDesde}–${ranura.rtpHasta}.`;
  }
  if (ranura.rtpDesde % 2 !== 0) {
    // RTP toma el par y RTCP el impar siguiente. Si el rango arranca impar, el
    // primer par queda partido entre dos plantas.
    return `El rango RTP tiene que empezar en un puerto par; ${ranura.rtpDesde} es impar.`;
  }
  if (ranura.puertoSip === ranura.puertoHttp) {
    return `El puerto SIP y el de HTTP/ARI no pueden ser el mismo (${ranura.puertoSip}).`;
  }
  for (const { puerto, rol } of puertosSueltos(ranura)) {
    if (dentro(puerto, ranura)) {
      return `El puerto ${puerto} (${rol}) cae dentro del rango RTP de la misma planta.`;
    }
  }
  return null;
}

/**
 * Un plan mal escrito reparte puertos que se cruzan, y eso se descubre con
 * audio cortado en producción. Mejor que no reparta nada.
 */
function revisarPlan(plan: PlanDePuertos): string | null {
  if (plan.puertosRtpPorPlanta < 2 || plan.puertosRtpPorPlanta % 2 !== 0) {
    return 'El plan de puertos es inválido: la tajada RTP por planta tiene que ser un número par de al menos 2.';
  }
  if (plan.rtpDesde % 2 !== 0) {
    return 'El plan de puertos es inválido: la banda RTP tiene que empezar en un puerto par.';
  }
  if (
    seCruzan(plan.sipDesde, plan.sipHasta, plan.rtpDesde, plan.rtpHasta) ||
    seCruzan(plan.httpDesde, plan.httpHasta, plan.rtpDesde, plan.rtpHasta) ||
    seCruzan(plan.sipDesde, plan.sipHasta, plan.httpDesde, plan.httpHasta)
  ) {
    return 'El plan de puertos es inválido: sus bandas se cruzan entre sí.';
  }
  if (cuantasRanuras(plan) === 0) {
    return 'El plan de puertos es inválido: las bandas no alcanzan para ninguna planta.';
  }
  return null;
}

function seCruzan(
  aDesde: number,
  aHasta: number,
  bDesde: number,
  bHasta: number,
): boolean {
  return aDesde <= bHasta && bDesde <= aHasta;
}

function enteroPositivo(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
