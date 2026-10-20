import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POR DÓNDE ALCANZA NGINX A LA PLANTA.
 *
 * El HTTP de Asterisk —el WebSocket del softphone y ARI— escucha en UNA sola
 * IP interna, y cuál sea depende de dónde corra el nginx que termina el TLS:
 * `127.0.0.1` si está en el host, y la IP del host en el puente de Docker si
 * está en un contenedor en red bridge. Estaba clavado en `127.0.0.1`, y en el
 * primer servidor real el nginx resultó estar en una red bridge: ahí
 * `127.0.0.1` es el contenedor de nginx hablándose a sí mismo, y el síntoma
 * fue un 502 en el WebSocket sin una línea en ningún log que lo explicara.
 *
 * Nula a propósito, y se lee con `ipInternaDe()` como `127.0.0.1`: si alguien
 * deja el campo vacío, el error posible es «no conecta», nunca «quedó
 * abierto».
 */
export class IpInternaDeLaPlanta1820000000000 implements MigrationInterface {
  name = 'IpInternaDeLaPlanta1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" ADD COLUMN IF NOT EXISTS "ipInterna" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" DROP COLUMN IF EXISTS "ipInterna"`,
    );
  }
}
