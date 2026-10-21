import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UN MENSAJE DE WHATSAPP YA NO ES UN CASO.
 *
 * Hasta el 21/10/2026 sí lo era: «Holaaa» acababa en la bandeja de Recepción
 * compitiendo por atención con una emergencia real. Una línea 123 publicada
 * recibe saludos, stickers, números equivocados y gente probando si contesta
 * un robot, y eso hacía inviable abrir el canal.
 *
 * Esta tabla es el paso previo al caso: la conversación. Guarda en qué punto
 * de la admisión va cada número — si ya se le saludó, si hay caso, si se le
 * preguntó el tipo, si se le preguntó la dirección.
 *
 * Vive en la base y no en memoria del proceso porque el backend corre con
 * tres réplicas: dos mensajes seguidos del mismo ciudadano pueden caer en
 * réplicas distintas, y un estado en memoria haría que la segunda no supiera
 * nada de la primera — el bot volvería a saludar, o no reconocería la
 * respuesta al menú.
 *
 * El índice único por (tenant, teléfono) es lo que garantiza UNA conversación
 * por ciudadano: sin él, dos mensajes simultáneos crearían dos filas y el
 * estado de admisión se bifurcaría.
 */
export class AdmisionDeWhatsapp1827000000000 implements MigrationInterface {
  name = 'AdmisionDeWhatsapp1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_conversaciones" (
        "id"              uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant"          character varying(64) NOT NULL,
        "telefono"        character varying(24) NOT NULL,
        "estado"          character varying(20) NOT NULL DEFAULT 'nueva',
        "casoId"          uuid,
        "mensajesDelBot"  integer NOT NULL DEFAULT 0,
        "creadoEn"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "actualizadoEn"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_conversaciones" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wa_conv_tenant_telefono"
        ON "whatsapp_conversaciones" ("tenant", "telefono")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wa_conv_tenant_telefono"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_conversaciones"`);
  }
}
