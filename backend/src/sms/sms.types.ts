/**
 * Lo que tiene que saber hacer un proveedor de SMS. Cada implementación recibe
 * sus credenciales como parámetros —no las lee de ningún lado— para que sea el
 * despachador (ProveedorSmsService) quien decida de qué instancia son.
 */
export interface RemitenteSms {
  /** true solo si el proveedor confirmó el envío. */
  enviar(
    cfg: { baseUrl?: string | null; apiKey: string; sender?: string | null },
    numero: string,
    mensaje: string,
  ): Promise<boolean>;
}

/**
 * Deja el número en E.164, que es lo que exigen los dos proveedores.
 *
 * El operador escribe el celular como se lo dictó el ciudadano: «3001234567»,
 * «300 123 4567», «+57 300...». Se normaliza aquí y no en la interfaz porque un
 * número mal formado NO falla: el proveedor responde 200 y el SMS nunca llega,
 * que es la peor forma de fallar.
 */
export function aE164(numero: string): string | null {
  const digitos = (numero ?? '').replace(/\D/g, '');
  // Celular colombiano sin indicativo.
  if (digitos.length === 10 && digitos.startsWith('3')) return `+57${digitos}`;
  if (digitos.length === 12 && digitos.startsWith('57')) return `+${digitos}`;
  if ((numero ?? '').trim().startsWith('+')) return `+${digitos}`;
  return digitos.length >= 8 ? `+${digitos}` : null;
}
