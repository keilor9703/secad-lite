import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `config_pbx`: qué planta telefónica atiende a cada instancia.
 *
 * Nace por Zadarma. Hasta aquí la única planta era la de YACO, que manda el
 * webhook genérico autenticado con la API key del tenant y no necesita que
 * FALCON guarde nada suyo. Una centralita propia sí: hay que verificar la
 * firma de lo que llega y firmar lo que se le pide (grabaciones, llamada
 * saliente), y eso son dos credenciales por instancia.
 *
 * Dos decisiones que conviene no perder de vista:
 *
 * 1. **Por instancia, no de la plataforma.** Al revés que `config_sms`, cuya
 *    cuenta y factura son del operador del SaaS. La línea del 123 es del
 *    municipio: su número, su centralita, su contrato. Dos municipios no
 *    comparten planta, y uno puede estar migrando mientras el otro no.
 *
 * 2. **NO lleva RLS.** Las seis tablas protegidas guardan datos de casos y
 *    ciudadanos; esta guarda configuración que solo toca el superadmin y que
 *    el webhook —una ruta pública, sin sesión ni `app.tenant` fijado— tiene
 *    que poder leer ANTES de saber a qué inquilino pertenece lo que llega.
 *    Protegerla con RLS la haría ilegible justo en el momento en que hace
 *    falta. El aislamiento aquí lo da la columna `tenant` y el hecho de que
 *    nada de esto se expone al navegador.
 *
 * Sin fila, el comportamiento es el de siempre: `YACO` por el webhook
 * genérico. Esta tabla no puede romper a las instancias que ya funcionan.
 */
export class ConfigPbx1815000000000 implements MigrationInterface {
  name = 'ConfigPbx1815000000000';

  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS config_pbx (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant          varchar(64) NOT NULL UNIQUE,
        proveedor       varchar(16) NOT NULL DEFAULT 'YACO',
        activo          boolean NOT NULL DEFAULT true,
        "zadarmaKey"    varchar(120),
        "zadarmaSecreto" varchar(500),
        "numeroEntrante" varchar(24),
        "actualizadoPor" varchar(120),
        "actualizadoEn" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS config_pbx');
  }
}
