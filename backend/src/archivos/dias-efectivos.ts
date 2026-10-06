/**
 * El plazo de UNA pasada de archivado no puede convertirse en el de siempre.
 *
 * Nació de una tentación concreta: para comprobar la cadena el día que se
 * configura el almacén, bajar `ARCHIVO_DIAS` a 1 y acordarse de devolverlo.
 * Acordarse no es un mecanismo — si se olvida, al día siguiente se archiva
 * TODO lo que tenga más de un día, en silencio y sin que nadie lo pida.
 *
 * Por eso el valor suelto vive aquí, con dos límites: solo puede ACORTAR el
 * plazo, nunca alargarlo, y nunca se guarda en ninguna parte.
 */
export function diasEfectivos(configurado: number, soloEstaVez?: number): number {
  if (soloEstaVez == null) return configurado;
  const n = Math.floor(soloEstaVez);
  // Cero o negativo significaría «todo, incluso lo grabado hace un minuto».
  if (!Number.isFinite(n) || n < 1) return configurado;
  // Para ALARGAR está ARCHIVO_DIAS, que es deliberado y queda escrito. Una
  // llamada suelta no debe poder dejar sin archivar lo que ya tocaba.
  return Math.min(n, configurado);
}
