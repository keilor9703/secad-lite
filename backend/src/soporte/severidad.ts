/**
 * La escala de severidad, del lado del servidor.
 *
 * El diálogo del frontend tiene su propia copia de estos textos porque los
 * muestra ANTES de que exista una petición (`frontend/src/app/shared/soporte/
 * soporte.ts`). Aquí vive la que entra en los correos: el cuerpo del ticket lo
 * arma el backend, y no puede depender de que el navegador le mande el título
 * de la severidad — eso lo volvería texto del cliente, que un cliente
 * cualquiera podría cambiar para que la mesa lea «S1 — la operación está
 * detenida» en un ticket que llegó como S4.
 *
 * Las dos copias y la matriz contractual de `docs/mesa-de-ayuda.md` tienen que
 * decir lo mismo. Si cambia el compromiso, cambia en los tres sitios.
 */

export const SEVERIDADES = ['S1', 'S2', 'S3', 'S4'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

interface Nivel {
  titulo: string;
  /** La misma frase que leyó quien reportó al elegir esta severidad. */
  compromiso: string;
}

const NIVELES: Record<Severidad, Nivel> = {
  S1: { titulo: 'La operación está detenida', compromiso: 'Respuesta en 15 minutos, a cualquier hora' },
  S2: { titulo: 'Funciona, pero mal', compromiso: 'Respuesta en 1 hora dentro del horario' },
  S3: { titulo: 'Falla algo que no frena la operación', compromiso: 'Respuesta el siguiente día hábil' },
  S4: { titulo: 'Petición, duda o mejora', compromiso: 'Respuesta en 2 días hábiles' },
};

/** Siempre devuelve algo: una severidad desconocida se atiende como S3. */
export function nivelDe(severidad: string): Nivel & { id: Severidad } {
  const id = (SEVERIDADES as readonly string[]).includes(severidad) ? (severidad as Severidad) : 'S3';
  return { id, ...NIVELES[id] };
}
