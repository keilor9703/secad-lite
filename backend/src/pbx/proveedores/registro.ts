import { DescriptorProveedor, ProveedorPbx } from './proveedor';
import { ProveedorZadarma } from './zadarma.proveedor';
import { ProveedorYaco } from './yaco.proveedor';

/**
 * EL REGISTRO DE PLANTAS TELEFÓNICAS
 *
 * Agregar un proveedor es escribir su archivo y agregarlo a esta lista. Nada
 * más cambia: ni `config_pbx`, ni la pantalla de Plataforma —que se arma del
 * descriptor—, ni la cola, ni los casos, ni los informes.
 *
 * El orden importa poco, salvo que el primero es el que se asume cuando una
 * instancia no tiene fila de configuración: hoy YACO, que es con lo que opera
 * la mayoría. Cambiar ese orden cambiaría, en silencio, el comportamiento de
 * todas las instancias sin configurar.
 */
const IMPLEMENTACIONES: ProveedorPbx[] = [
  new ProveedorYaco(),
  new ProveedorZadarma(),
];

/** Por clave (`'YACO'`, `'ZADARMA'`), que es lo que guarda `config_pbx`. */
const POR_CLAVE = new Map<string, ProveedorPbx>(
  IMPLEMENTACIONES.map((p) => [p.descriptor.clave, p]),
);

/** La clave que se asume sin fila de configuración. */
export const PROVEEDOR_POR_DEFECTO = IMPLEMENTACIONES[0].descriptor.clave;

/** Las claves válidas, para validar lo que llegue del navegador. */
export const CLAVES_PROVEEDOR: string[] = IMPLEMENTACIONES.map((p) => p.descriptor.clave);

/** El proveedor, o null si la clave no es de ninguno. */
export function proveedor(clave: string | null | undefined): ProveedorPbx | null {
  return POR_CLAVE.get(String(clave ?? '').toUpperCase()) ?? null;
}

/** Su ficha, o null. */
export function descriptor(clave: string | null | undefined): DescriptorProveedor | null {
  return proveedor(clave)?.descriptor ?? null;
}

/**
 * El catálogo completo, para la pantalla: qué proveedores hay, qué sabe hacer
 * cada uno y qué datos pide. Es lo que le permite a Plataforma dibujar el
 * formulario sin tener ni un nombre de proveedor escrito a mano.
 */
export function catalogoProveedores(): DescriptorProveedor[] {
  return IMPLEMENTACIONES.map((p) => p.descriptor);
}
