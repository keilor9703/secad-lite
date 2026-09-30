import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Código público corto de la videollamada.
 *
 * El enlace del ciudadano llevaba el JWT entero en la ruta: más de 300
 * caracteres que en un SMS parecen cualquier cosa menos la línea de
 * emergencias. Ahora lleva `<instancia>-<codigo>` y el token firmado lo
 * entrega el servidor cuando el código resulta válido.
 *
 * El índice es único POR INSTANCIA y parcial: las sesiones anteriores a este
 * cambio quedan con el código en nulo y se les asigna uno cuando alguien pide
 * su enlace, así que no puede exigirse NOT NULL ni contar los nulos como
 * repetidos.
 */
export class VideoCodigoCorto1806000000000 implements MigrationInterface {
  name = 'VideoCodigoCorto1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "video_sesiones" ADD COLUMN IF NOT EXISTS "codigo" character varying(24)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_video_sesiones_tenant_codigo"
         ON "video_sesiones" ("tenant", "codigo") WHERE "codigo" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_video_sesiones_tenant_codigo"`);
    await queryRunner.query(`ALTER TABLE "video_sesiones" DROP COLUMN IF EXISTS "codigo"`);
  }
}
