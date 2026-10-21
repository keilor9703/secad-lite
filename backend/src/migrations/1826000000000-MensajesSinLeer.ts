import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LOS MENSAJES QUE LLEGAN A UN CASO QUE YA EXISTE.
 *
 * Un caso de WhatsApp no termina cuando nace. El ciudadano sigue escribiendo
 * dentro del MISMO caso —una conversación es una emergencia, no cinco— y eso
 * era invisible desde Recepción y Despacho: la fila seguía diciendo lo que
 * dijo el primer mensaje, con su misma antigüedad, y el hilo solo existía
 * para quien abriera el caso.
 *
 * El 21 de octubre de 2026 entraron seis mensajes seguidos a un caso y en el
 * tablero no cambió nada. En una prueba eso es confusión; en turno es un
 * «ya entró al cuarto de mi hija» que llega a la base de datos y a nadie en
 * pantalla.
 *
 * Se cuenta en una columna y no con un `count` sobre los mensajes porque el
 * tablero lista decenas de casos, y una subconsulta por fila es justo lo que
 * no hay que poner en la pantalla que tiene que ir rápida.
 *
 * `DEFAULT 0` y no nulo: un caso sin mensajes nuevos tiene cero, no
 * «desconocido». Un nulo obligaría a cada lector a decidir qué significa, y
 * el que lo decida mal enseñará una insignia que no se apaga nunca.
 */
export class MensajesSinLeer1826000000000 implements MigrationInterface {
  name = 'MensajesSinLeer1826000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "mensajesSinLeer" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "casos" DROP COLUMN IF EXISTS "mensajesSinLeer"`,
    );
  }
}
