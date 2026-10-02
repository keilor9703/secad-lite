import { Caso } from '../../core/models';

/**
 * Mínimo de caracteres para que la búsqueda mire los identificadores.
 *
 * Los id son UUID, y un UUID contiene casi cualquier combinación corta de
 * dígitos y letras a–f: buscar «ab» contra ellos devolvería medio listado y
 * la barra dejaría de servir para lo que se usa el 99% de las veces, que es
 * buscar por texto. Con seis caracteres o más, una coincidencia accidental
 * dentro de otro UUID es ya improbable, y nadie busca un caso por su id
 * tecleando menos que eso: o lo pega entero, o copia un trozo reconocible.
 */
export const MINIMO_ID = 6;

/**
 * ¿Este caso coincide con lo que escribió el operador?
 *
 * `consulta` debe venir ya recortada y en minúscula.
 *
 * Vive fuera del componente porque es la regla que decide qué encuentra y qué
 * no un operador que está buscando un caso con alguien al teléfono: conviene
 * poder probarla sola, sin montar la pantalla entera.
 */
export function coincideBusqueda(c: Caso, consulta: string): boolean {
  if (!consulta) return true;

  const porTexto = [c.titulo, c.ciudadano, c.direccion, c.barrio, c.codigoCaso, c.agencia]
    .some((v) => (v ?? '').toLowerCase().includes(consulta));
  if (porTexto) return true;

  // El id del caso y el de la llamada. Se buscan los dos porque el operador
  // usa el que tenga a mano: el del caso si viene de un informe o de otro
  // módulo, el de la llamada si está rastreando algo desde la planta.
  return consulta.length >= MINIMO_ID
    && [c.id, c.llamadaId].some((v) => (v ?? '').toLowerCase().includes(consulta));
}
