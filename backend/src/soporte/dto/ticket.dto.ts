import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SEVERIDADES } from '../severidad';

/**
 * Lo que manda el diálogo de soporte del frontend.
 *
 * **Todos los campos llevan decorador, y eso no es estilo.** El ValidationPipe
 * global de `main.ts` corre con `whitelist: true`: una propiedad sin decorador
 * se BORRA del cuerpo en silencio — no falla al compilar, no falla al arrancar
 * y no falla en la petición, simplemente llega vacía. Así se rompieron dos
 * endpoints antes (ver `src/auth/dto/whitelist.spec.ts`), y aquí el daño
 * sería un ticket que llega a la mesa sin el relato. `dto/whitelist.spec.ts`
 * lo vigila.
 */
export class TicketDto {
  @IsIn(SEVERIDADES as unknown as string[])
  severidad!: string;

  /**
   * Lo que escribió la persona. El mínimo es el mismo que habilita el botón en
   * el diálogo: un ticket que dice «no sirve» cuesta una ida y vuelta.
   */
  @IsString() @MinLength(10) @MaxLength(4000)
  relato!: string;

  /**
   * El informe de diagnóstico, ya en texto, tal como lo vio quien reporta. El
   * backend NO lo arma ni lo completa: lo que viaja es exactamente lo que se
   * mostró en pantalla, porque eso es lo que la persona autorizó a enviar.
   *
   * El tope son 20 000 caracteres: el informe real mide unos 1 500 con los 25
   * errores del búfer, así que sobra margen sin dejar que alguien use el
   * endpoint para empujar medio megabyte a un correo.
   */
  @IsString() @MaxLength(20_000)
  contexto!: string;

  /**
   * La ruta en la que estaba quien reporta, para el panel de triaje del correo.
   *
   * Va aparte del contexto en vez de sacarse de él con una expresión regular:
   * el informe es texto pensado para una persona, y el día que se le cambie
   * una etiqueta, una extracción silenciosa empezaría a mandar tickets sin
   * pantalla sin que nadie se enterara.
   *
   * Opcional a propósito. Un navegador con el bundle anterior en caché no
   * manda este campo, y de todos los endpoints del sistema, el de reportar un
   * problema es el último que debería responder 400 a quien ya está teniendo
   * un mal día: el dato está igual dentro del contexto.
   */
  @IsOptional() @IsString() @MaxLength(200)
  pantalla?: string;
}
