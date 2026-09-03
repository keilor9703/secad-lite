import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Habilita Row-Level Security en las tablas principales de FALCON CAD.
 * Cada request del backend establece app.tenant con SET LOCAL antes de
 * ejecutar queries; las políticas RLS usan esa variable para aislar tenants.
 *
 * IMPORTANTE: Requiere que el usuario de la BD tenga BYPASSRLS para poder
 * crear las políticas, pero NO para leerlas. El usuario de la app debe
 * ser creado SIN BYPASSRLS para que las políticas apliquen.
 *
 * El método down() DESHABILITA RLS — no borra las políticas para facilitar
 * la re-habilitación.
 */
export class HabilitarRLS1725400000000 implements MigrationInterface {
  name = 'HabilitarRLS1725400000000';

  private readonly tablas = [
    'casos', 'casos_eventos', 'asignaciones', 'recursos',
    'llamadas', 'casos_mensajes',
  ];

  async up(runner: QueryRunner): Promise<void> {
    // Función helper que el middleware usa para establecer el tenant
    await runner.query(`
      CREATE OR REPLACE FUNCTION set_tenant(t text)
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM set_config('app.tenant', t, true); -- true = LOCAL (solo esta transacción)
      END;
      $$;
    `);

    for (const tabla of this.tablas) {
      // Habilitar RLS (sin FORCE: el superuser sigue teniendo acceso completo)
      await runner.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      // Policy de lectura/escritura: solo filas del tenant activo
      await runner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${tabla};
        CREATE POLICY tenant_isolation ON ${tabla}
          USING (tenant = current_setting('app.tenant', true))
          WITH CHECK (tenant = current_setting('app.tenant', true));
      `);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await runner.query(`ALTER TABLE ${tabla} DISABLE ROW LEVEL SECURITY`);
    }
    await runner.query(`DROP FUNCTION IF EXISTS set_tenant(text)`);
  }
}
