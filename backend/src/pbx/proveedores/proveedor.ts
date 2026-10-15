import { TenantEntity } from '../../tenants/tenant.entity';
import { CuerpoAviso, ResultadoVerificacion, TraduccionAviso } from './aviso';

/**
 * QUÉ ES UNA PLANTA TELEFÓNICA PARA FALCON
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN PUERTO Y NO UN MÓDULO POR PROVEEDOR
 *
 * La primera versión de esto se escribió para Zadarma y se le notaba: la tabla
 * de configuración tenía columnas `zadarmaKey` y `zadarmaSecreto`, y la
 * pantalla de Plataforma pedía «Key de la API de Zadarma» con ese texto
 * escrito a mano. Funcionaba, y cada proveedor nuevo —Infobip, el que venga—
 * costaba dos columnas, un trozo de pantalla y una rama más en el servicio de
 * configuración. Al tercero, nadie recuerda qué campo usa cuál.
 *
 * Y la realidad es que todos los proveedores se parecen: entregan llamadas
 * entrantes por webhook, muchos saben originar una llamada por API, algunos
 * dejan contestar por WebRTC, algunos graban. Lo que cambia es el DETALLE
 * —cómo se firma, cómo se llaman los campos, qué sabe hacer cada uno—, no la
 * forma.
 *
 * Así que aquí un proveedor DECLARA lo que es:
 *
 *  - qué **capacidades** tiene (y FALCON no ofrece en pantalla lo que el
 *    proveedor no sabe hacer, en vez de dejar al operador descubrirlo con un
 *    error);
 *  - qué **credenciales** necesita, cada una con su etiqueta, su ayuda y si es
 *    secreta (el cifrado y el «solo de escritura» salen de ahí, no de una
 *    lista de columnas en el servicio);
 *  - cómo **verifica** y **traduce** lo que llega, si recibe entrantes;
 *  - cómo **marca** y cómo arma la **configuración del softphone**, si sabe.
 *
 * Agregar un proveedor es escribir un archivo y registrarlo. Nada más cambia:
 * ni la tabla, ni la pantalla, ni la cola, ni los casos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE EL PUERTO NO UNIFICA, A PROPÓSITO
 *
 * **La dirección del webhook es una por proveedor** (`/api/pbx/zadarma/:clave`
 * y no `/api/pbx/avisos/:proveedor/:clave`). Dos razones: cada panel de
 * proveedor admite UNA dirección y su validación es propia —Zadarma exige
 * devolver un `zd_echo` tal cual, otro exigirá otra cosa—, y la dirección que
 * ya está pegada en un panel de producción no se puede mover sin que se caiga
 * la línea del 123 de un municipio. La verificación y la traducción SÍ pasan
 * por el puerto; el transporte y el saludo, no.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Lo que un proveedor sabe hacer.
 *
 * Es lo que la pantalla consulta para no ofrecer lo imposible: con YACO no se
 * dibuja el botón de marcar, porque hoy la llamada la controla su barra y
 * FALCON no tiene por dónde pedirla.
 */
export const CAPACIDADES_PBX = [
  /** Entrega llamadas entrantes a FALCON (webhook). Es el mínimo para existir. */
  'entrantes',
  /** Sabe originar una llamada por API: el botón «Llamar» del caso. */
  'marcar',
  /** Deja contestar DENTRO de FALCON (SIP sobre WebSocket / WebRTC). */
  'softphone',
  /** Graba y permite traer la grabación al caso. */
  'grabacion',
] as const;

export type CapacidadPbx = (typeof CAPACIDADES_PBX)[number];

/**
 * Un dato que el proveedor necesita de nosotros, descrito por él mismo.
 *
 * `secreto` manda más de lo que parece: decide que el valor se cifre en
 * reposo, que NUNCA vuelva al navegador (ni truncado) y que un formulario que
 * no lo recibió tampoco lo borre al guardar. Esa regla estaba escrita a mano
 * para los dos campos de Zadarma; ahora sale del descriptor, así que un
 * proveedor nuevo no puede olvidarla.
 */
export interface CampoCredencial {
  /** Cómo se guarda dentro de `config_pbx.credenciales`. */
  clave: string;
  /** Lo que lee el superadmin en la pantalla. */
  etiqueta: string;
  /** Dónde se consigue, dicho en el idioma del panel del proveedor. */
  ayuda: string;
  /** Cifrado en reposo, nunca de vuelta al navegador. */
  secreto: boolean;
  /** Sin esto, el proveedor no puede operar y la planta no se deja encender. */
  requerido: boolean;
  /**
   * Forma esperada, como fuente de una expresión regular.
   *
   * No sirve para rechazar —si el proveedor cambia el formato, esto no puede
   * dejar la integración muerta— sino para poder DECIRLO: una llave pegada con
   * un espacio da el mismo «authentication failed» que una llave equivocada, y
   * sin esta pista hay que adivinar cuál de los dos es.
   */
  forma?: string;
  /** Un ejemplo con la forma correcta, inventado. Nunca un valor real. */
  ejemplo?: string;
}

/** Las credenciales de una instancia, ya en claro. Las secretas se descifran. */
export type CredencialesPbx = Record<string, string>;

/**
 * La ficha del proveedor: lo que la pantalla y la configuración necesitan
 * saber de él sin tener que conocerlo.
 */
export interface DescriptorProveedor {
  /** Lo que se guarda en `config_pbx.proveedor`. En mayúsculas. */
  clave: string;
  /** El nombre con el que se lo conoce. */
  nombre: string;
  /** Una línea: qué es y de quién es la factura. */
  resumen: string;
  capacidades: readonly CapacidadPbx[];
  credenciales: readonly CampoCredencial[];
  /**
   * La ruta del webhook de ESTE proveedor, si recibe entrantes. La pantalla le
   * pega el origen y la llave de la instancia para armar lo que hay que
   * copiar en el panel del proveedor.
   */
  rutaAviso?: string;
  /** Dónde se pega esa dirección, dicho como lo dice su panel. */
  dondeSePega?: string;
}

/** Resultado de pedirle al proveedor que origine una llamada. */
export interface ResultadoMarcar {
  ok: boolean;
  /** Identificador de la llamada en la central, si lo devuelve. */
  id?: string;
  /** Qué falló, en términos que sirvan al operador y no solo al log. */
  error?: string;
}

/** Lo que el navegador necesita para registrarse como teléfono. */
export interface ConfigSoftphone {
  /** WebSocket de señalización del proveedor (`wss://…`). */
  wss: string;
  /** Dominio SIP con el que se arma la identidad del usuario. */
  dominio: string;
  /** La extensión de este operador. */
  usuario: string;
  /** Su clave SIP. Viaja al navegador por fuerza: es quien se registra. */
  clave: string;
  /** Servidores ICE, si el proveedor exige los suyos. */
  ice?: { urls: string | string[]; username?: string; credential?: string }[];
}

/**
 * Un proveedor de telefonía, visto por FALCON.
 *
 * Todo lo que no sea `descriptor` es opcional: un proveedor que solo entrega
 * entrantes implementa `verificar` y `traducir` y nada más. La pantalla no
 * ofrecerá lo demás, porque sus capacidades no lo declaran.
 */
export interface ProveedorPbx {
  readonly descriptor: DescriptorProveedor;

  /**
   * ¿Este aviso viene de verdad del proveedor? Es lo único que autentica un
   * webhook público.
   */
  verificar?(cuerpo: CuerpoAviso, firma: string | undefined, cred: CredencialesPbx): ResultadoVerificacion;

  /** Del idioma del proveedor al modelo de llamada de FALCON. */
  traducir?(cuerpo: CuerpoAviso): TraduccionAviso;

  /**
   * Pide una llamada: la central llama primero a la extensión del operador y,
   * cuando descuelga, al ciudadano.
   */
  marcar?(cred: CredencialesPbx, orden: { extension: string; numero: string }): Promise<ResultadoMarcar>;

  /** La configuración que se le entrega al navegador de ese operador. */
  softphone?(cred: CredencialesPbx, extension: string, claveSip: string): ConfigSoftphone | null;

  /** Para los mensajes de error: el tenant al que pertenece lo que se procesa. */
  readonly nombreCorto?: (t: TenantEntity) => string;
}

/** ¿El proveedor declara esta capacidad? */
export function puede(p: DescriptorProveedor | null | undefined, c: CapacidadPbx): boolean {
  return !!p?.capacidades.includes(c);
}

/** Los campos secretos de un proveedor, que es lo que decide qué se cifra. */
export function camposSecretos(d: DescriptorProveedor): string[] {
  return d.credenciales.filter((c) => c.secreto).map((c) => c.clave);
}

/**
 * ¿Están todas las credenciales requeridas? Es lo que decide si la planta se
 * puede encender, sin que el servicio de configuración sepa de qué proveedor
 * se trata.
 */
export function faltanRequeridas(d: DescriptorProveedor, cred: CredencialesPbx): string[] {
  return d.credenciales.filter((c) => c.requerido && !cred[c.clave]?.trim()).map((c) => c.etiqueta);
}
