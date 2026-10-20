import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EL DESBORDE DE LA COLA.
 *
 * Hasta ahora, si nadie en la sala contestaba, el ciudadano oía timbre hasta
 * que la cola se rendía y la llamada se perdía EN SILENCIO: no quedaba
 * constancia de que alguien llamó y no lo atendimos.
 *
 * Con esto la llamada se va a un número de respaldo —un celular de turno, otra
 * sala, un supervisor— y queda registrada como `desbordada`, que es un estado
 * distinto de `perdida`. La diferencia es la que importa en una línea de
 * emergencia: «no alcanzamos a contestar» no es «nadie se enteró de que había
 * una llamada».
 *
 * Los dos campos son nulos a propósito: una planta sin número de respaldo se
 * comporta como antes. Lo que no se puede es apuntar a un número que la
 * troncal rechace, porque eso manda la llamada a un error en vez de a un
 * timbre — peor que colgar.
 */
export class DesbordeDeLaCola1823000000000 implements MigrationInterface {
  name = 'DesbordeDeLaCola1823000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" ADD COLUMN IF NOT EXISTS "numeroDesborde" character varying(24)`,
    );
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" ADD COLUMN IF NOT EXISTS "segundosEnCola" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" DROP COLUMN IF EXISTS "segundosEnCola"`,
    );
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" DROP COLUMN IF EXISTS "numeroDesborde"`,
    );
  }
}
