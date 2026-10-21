import { CanalEnlace } from '../../core/models';

/**
 * POR DÓNDE SALE EL ENLACE DE LA VIDEOLLAMADA: LA PARTE QUE SE PUEDE PROBAR.
 *
 * Vive fuera del componente porque la pantalla de administración inyecta una
 * docena de servicios y lo que hay que garantizar aquí es pequeño y concreto:
 * que lo guardado se pinte igual que está, que reordenar no pierda ni duplique
 * un camino, y que lo que se manda al servidor sea exactamente lo que el
 * administrador ve en la lista.
 *
 * El backend tiene su propia copia de la decisión
 * (`backend/src/videollamada/orden-envio.ts`): esto es la pantalla, no la
 * regla. Si los dos no coinciden, manda el backend.
 */

/** Un camino en la lista: el canal, y si está en uso. */
export interface FilaDeCamino {
  canal: CanalEnlace;
  usar: boolean;
}

/**
 * Los tres caminos con sus letras pequeñas, en el orden automático del
 * backend.
 *
 * El texto no es decorativo: quien elige el orden tiene que saber que la
 * plantilla llega como un botón y solo a móviles, que el texto libre depende
 * de una ventana de 24 horas, y que el SMS se paga. Sin eso, la pantalla
 * invita a configurar a ciegas algo que decide si el ciudadano recibe el
 * enlace.
 */
export const CAMINOS_DEL_ENLACE: { canal: CanalEnlace; nombre: string; nota: string }[] = [
  {
    canal: 'whatsapp', nombre: 'WhatsApp · texto libre',
    nota: 'Gratis y el enlace es pulsable, pero solo se puede si el ciudadano '
      + 'escribió a la línea en las últimas 24 horas.',
  },
  {
    canal: 'plantilla', nombre: 'WhatsApp · plantilla aprobada',
    nota: 'La única forma de escribirle primero. Llega como un BOTÓN, no como un '
      + 'enlace: hay que decírselo. Solo a móviles.',
  },
  {
    canal: 'sms', nombre: 'SMS',
    nota: 'Llega a cualquier teléfono, sin datos ni WhatsApp. Se paga, y en muchos '
      + 'teléfonos el enlace no se vuelve pulsable.',
  },
];

/** Todos los caminos en uso, en el orden automático. */
export function todosEnUso(): FilaDeCamino[] {
  return CAMINOS_DEL_ENLACE.map((c) => ({ canal: c.canal, usar: true }));
}

/**
 * De lo que devuelve el servidor a lo que se pinta.
 *
 * `null` = lo decide el sistema, y entonces la lista queda en el orden
 * automático: al pasar a manual, el administrador parte de lo que hoy está
 * pasando de verdad y no de una lista vacía.
 *
 * Los caminos que el orden guardado NO incluye se pintan igual, destildados y
 * al final: es la única forma de volver a activarlos.
 */
export function filasDesde(guardado: CanalEnlace[] | null | undefined): {
  auto: boolean; filas: FilaDeCamino[];
} {
  if (!guardado?.length) return { auto: !guardado, filas: todosEnUso() };
  const fuera = CAMINOS_DEL_ENLACE
    .map((c) => c.canal)
    .filter((canal) => !guardado.includes(canal));
  return {
    auto: false,
    filas: [
      ...guardado.map((canal) => ({ canal, usar: true })),
      ...fuera.map((canal) => ({ canal, usar: false })),
    ],
  };
}

/**
 * Lo que se le manda al servidor: `null` si lo decide el sistema, y si no, los
 * caminos activos en su orden.
 */
export function ordenParaGuardar(auto: boolean, filas: FilaDeCamino[]): CanalEnlace[] | null {
  if (auto) return null;
  return filas.filter((f) => f.usar).map((f) => f.canal);
}

/**
 * Mueve un camino una posición: `-1` lo sube, `+1` lo baja.
 *
 * Devuelve la lista intacta si el movimiento se sale de los extremos, en vez
 * de perder la fila o duplicarla —que es lo que pasa al intercambiar con un
 * índice que no existe.
 */
export function moverCamino(filas: FilaDeCamino[], i: number, delta: number): FilaDeCamino[] {
  const destino = i + delta;
  if (i < 0 || i >= filas.length || destino < 0 || destino >= filas.length) return filas;
  const copia = [...filas];
  [copia[i], copia[destino]] = [copia[destino], copia[i]];
  return copia;
}

export function alternarCamino(filas: FilaDeCamino[], canal: CanalEnlace): FilaDeCamino[] {
  return filas.map((f) => (f.canal === canal ? { ...f, usar: !f.usar } : f));
}

/**
 * ¿Se quedó sin ningún camino? Guardar así dejaría al ciudadano sin enlace por
 * ninguna vía, y nadie se enteraría hasta la primera emergencia.
 */
export function sinNingunCamino(auto: boolean, filas: FilaDeCamino[]): boolean {
  return !auto && !filas.some((f) => f.usar);
}

export function nombreDelCamino(canal: CanalEnlace): string {
  return CAMINOS_DEL_ENLACE.find((c) => c.canal === canal)?.nombre ?? canal;
}

export function notaDelCamino(canal: CanalEnlace): string {
  return CAMINOS_DEL_ENLACE.find((c) => c.canal === canal)?.nota ?? '';
}
