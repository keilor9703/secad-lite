import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LA IP DE LA INTERFAZ REAL DEL SERVIDOR.
 *
 * Arregla dos averías de audio que pasaron en el primer servidor real, y que
 * tienen en común que la llamada entra, timbra, el operador contesta y no se
 * oye nada de ningún lado, sin un solo mensaje que explique por qué:
 *
 *  1. Asterisk HEREDA la dirección del transporte para abrir el socket de
 *     audio, y el transporte del WebSocket está en 127.0.0.1 porque el TLS lo
 *     pone nginx. El RTP del operador abría en 127.0.0.1: sus paquetes
 *     rebotaban con «ICMP port unreachable» y Asterisk no podía enviar.
 *  2. Con NAT 1:1 de nube la IP pública no está en ninguna interfaz, así que
 *     Asterisk solo podía ofrecer la privada, que el navegador no alcanza.
 *
 * Nula a propósito: un servidor cuya IP pública está en la interfaz no
 * necesita nada de esto, y poner una dirección equivocada es peor que no
 * poner ninguna.
 */
export class IpPrivadaDeLaPlanta1821000000000 implements MigrationInterface {
  name = 'IpPrivadaDeLaPlanta1821000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" ADD COLUMN IF NOT EXISTS "ipPrivada" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" DROP COLUMN IF EXISTS "ipPrivada"`,
    );
  }
}
