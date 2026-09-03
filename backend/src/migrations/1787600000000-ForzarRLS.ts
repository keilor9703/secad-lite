import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Complementa HabilitarRLS: por defecto Postgres exime al DUEÑO de la tabla
 * de sus propias políticas RLS, y el rol con el que la app se conecta es
 * justamente el dueño (creó las tablas al sincronizar/migrar). Sin FORCE
 * ROW LEVEL SECURITY, las políticas de tenant_isolation existían pero nunca
 * se evaluaban para ninguna consulta de la aplicación — probado en vivo:
 * con la política activa pero sin FORCE, un listado seguía trayendo todos
 * los tenants igual.
 */
export class ForzarRLS1787600000000 implements MigrationInterface {
  name = 'ForzarRLS1787600000000';

  private readonly tablas = [
    'casos', 'casos_eventos', 'asignaciones', 'recursos',
    'llamadas', 'casos_mensajes',
  ];

  async up(runner: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await runner.query(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY`);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await runner.query(`ALTER TABLE ${tabla} NO FORCE ROW LEVEL SECURITY`);
    }
  }
}
