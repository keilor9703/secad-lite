import { DescriptorProveedor, ProveedorPbx } from './proveedor';

/**
 * YACO — la planta con la que opera hoy la mayoría.
 *
 * No tiene traductor ni verificación propios, y eso no es una omisión: YACO
 * entrega las llamadas por el **webhook genérico** (`POST /api/pbx/webhook`),
 * que ya habla el modelo de FALCON y se autentica con la API key del tenant.
 * No hay nada que traducir ni credenciales nuestras que guardar.
 *
 * Conviene no confundir dos cosas que se parecen:
 *
 *  - **esta** integración, «Planta telefónica (PBX)», es por donde hoy entran
 *    de verdad las llamadas de YACO;
 *  - la integración **CTI / YACO (barra embebida)** —`docs/integracion-cti-yaco.md`—
 *    es otra, y en FALCON está solo como **esqueleto**: el proveedor todavía no
 *    ha desarrollado la barra.
 *
 * `marcar` y `softphone` no están entre sus capacidades porque la llamada la
 * controla su plataforma: FALCON no tiene por dónde pedirle que origine una,
 * ni credenciales SIP con las que registrarse. Si algún día las publica, lo
 * que cambia es este archivo.
 */
export class ProveedorYaco implements ProveedorPbx {
  readonly descriptor: DescriptorProveedor = {
    clave: 'YACO',
    nombre: 'YACO',
    resumen: 'La planta del proveedor de telefonía del municipio. Entrega las llamadas por el webhook genérico, autenticado con la API key de la instancia: FALCON no guarda credenciales suyas.',
    capacidades: ['entrantes'],
    credenciales: [],
    rutaAviso: '/api/pbx/webhook',
    dondeSePega: 'En la configuración de la central del proveedor, con la API key de la instancia en el encabezado x-api-key',
  };
}
