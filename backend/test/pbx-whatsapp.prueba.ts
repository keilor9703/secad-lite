/**
 * El número del llamante tiene que llegar al formulario de Recepción POR IGUAL
 * venga la llamada de la planta o de WhatsApp.
 *
 * Un operador reportó que con WhatsApp el campo "Abonado" queda vacío. Esta
 * prueba recorre el camino completo —webhook de la central, cola, "Tomar
 * llamada"— con PostgreSQL de verdad y con los tres orígenes, para separar dos
 * cosas que de otro modo se confunden: si FALCON pierde el número, o si la
 * central nunca lo mandó.
 *
 *   DATABASE_URL=postgres://falcon_app:falcon@127.0.0.1:5496/falcon \
 *     npx ts-node -r tsconfig-paths/register test/pbx-whatsapp.prueba.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { LlamadaEntity, OrigenLlamada } from '../src/pbx/llamada.entity';
import { TenantEntity } from '../src/tenants/tenant.entity';
import { PbxService, ActorPbx, WebhookLlamadaDto } from '../src/pbx/pbx.service';
import { TenantRlsService } from '../src/common/tenant-rls.service';
import { CasosService } from '../src/casos/casos.service';
import { UsuariosService } from '../src/usuarios/usuarios.service';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

async function main(): Promise<number> {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://falcon_app:falcon@127.0.0.1:5496/falcon',
    entities: [LlamadaEntity, TenantEntity],
    synchronize: true,
    logging: false,
  });
  await ds.initialize();

  await ds.query(`
    CREATE OR REPLACE FUNCTION set_tenant(t text)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN PERFORM set_config('app.tenant', t, true); END; $$;
  `);
  await ds.query(`ALTER TABLE llamadas ENABLE ROW LEVEL SECURITY`);
  await ds.query(`ALTER TABLE llamadas FORCE ROW LEVEL SECURITY`);
  await ds.query(`DROP POLICY IF EXISTS tenant_isolation ON llamadas`);
  await ds.query(`
    CREATE POLICY tenant_isolation ON llamadas
      USING (tenant = current_setting('app.tenant', true))
      WITH CHECK (tenant = current_setting('app.tenant', true));
  `);

  const rls = new TenantRlsService(ds);
  // El webhook, la cola y "Tomar llamada" no tocan casos ni usuarios; se
  // sustituyen para poder ejercitar el camino real sin levantar media
  // aplicación. `buscarPorExtension` sí se consulta cuando la central enruta.
  const pbx = new PbxService(
    {} as unknown as CasosService,
    { buscarPorExtension: async () => null } as unknown as UsuariosService,
    rls,
  );

  await ds.query(
    `INSERT INTO tenants (codigo, nombre) VALUES ('mebog','MEBOG') ON CONFLICT (codigo) DO NOTHING`);

  // Sin esto, el webhook es idempotente por callId y en la segunda corrida
  // devuelve la fila de la PRIMERA en vez de crear una nueva: la prueba pasa
  // sin llegar a ejecutar el código que dice estar probando. Lo descubrí
  // saboteando la normalización y viendo que las aserciones seguían en verde.
  await rls.conTenant('mebog', (m) => m.query(`DELETE FROM llamadas WHERE tenant = 'mebog'`));
  const tenant = { codigo: 'mebog' } as TenantEntity;
  const actor: ActorPbx = { username: 'operador1', supervisor: false };

  const casos: Array<{ origen: OrigenLlamada; numero: string; etiqueta: string }> = [
    { origen: 'telefono', numero: '3175882321', etiqueta: 'llamada telefónica' },
    { origen: 'whatsapp_chat', numero: '3001234567', etiqueta: 'chat de WhatsApp' },
    { origen: 'whatsapp_llamada', numero: '3109876543', etiqueta: 'llamada de WhatsApp' },
  ];

  console.log('\n1) El número sobrevive el camino completo, venga de donde venga');
  for (const c of casos) {
    const dto: WebhookLlamadaDto = {
      evento: 'entrante', callId: `call-${c.origen}`, numero: c.numero, origen: c.origen,
    };
    const entrante = await pbx.webhook(tenant, dto);
    afirmar(entrante.numero === c.numero,
      `${c.etiqueta}: el webhook guarda el número (guardó «${entrante.numero}»)`);

    const cola = await pbx.listar('mebog', actor);
    const enCola = cola.find((l) => l.id === entrante.id);
    afirmar(enCola?.numero === c.numero,
      `${c.etiqueta}: sale en la cola con su número (salió «${enCola?.numero}»)`);

    // Es lo que devuelve "Tomar llamada", y de ahí sale lo que Recepción
    // escribe en el campo Abonado: `this.form.controls.telefono.setValue(llamada.numero)`.
    const tomada = await pbx.reclamar('mebog', entrante.id, actor);
    afirmar(tomada.numero === c.numero,
      `${c.etiqueta}: «Tomar llamada» devuelve el número (devolvió «${tomada.numero}»)`);
  }

  console.log('\n2) Lo que una pasarela de WhatsApp manda de verdad: un JID, no un número');
  // Las pasarelas de WhatsApp no manejan "números": manejan JID del contacto.
  // Si la central reenvía eso tal cual, sin limpiarlo el operador vería un
  // identificador que no se puede marcar ni cruzar con los casos del número.
  const crudos: Array<[string, string, string]> = [
    ['573175882321@s.whatsapp.net', '573175882321', 'JID de WhatsApp'],
    ['573001234567@c.us',           '573001234567', 'JID estilo c.us'],
    ['+57 317 588 2321',            '+573175882321', 'número con espacios de la central'],
    ['(317) 588-2321',              '3175882321',   'número con paréntesis y guion'],
    ['3175882321',                  '3175882321',   'número ya limpio: no se toca'],
  ];
  for (const [llega, esperado, etiqueta] of crudos) {
    const l = await pbx.webhook(tenant, {
      evento: 'entrante', callId: `call-${esperado}-${etiqueta}`, numero: llega, origen: 'whatsapp_chat',
    });
    const tomada = await pbx.reclamar('mebog', l.id, actor);
    afirmar(tomada.numero === esperado,
      `${etiqueta}: llega «${llega}» → el campo Abonado queda «${tomada.numero}»`);
  }

  console.log('\n2b) Una "colgada" con el identificador crudo encuentra su llamada');
  // Si 'entrante' guarda limpio y 'colgada' busca crudo, la llamada se queda
  // timbrando en la cola para siempre.
  const viva = await pbx.webhook(tenant, {
    evento: 'entrante', numero: '573209998877@s.whatsapp.net', origen: 'whatsapp_chat',
  });
  // En try/catch: si no la encuentra, el webhook lanza NotFound y sin esto la
  // prueba se caería en vez de REPORTAR el fallo, que es lo que hace falta.
  let colgada: LlamadaEntity | null = null;
  try {
    colgada = await pbx.webhook(tenant, { evento: 'colgada', numero: '573209998877@s.whatsapp.net' });
  } catch (e) {
    console.log(`     el webhook de colgada respondió: ${(e as Error)?.message}`);
  }
  afirmar(colgada?.id === viva.id, 'la encuentra por el número, pese a venir con el sufijo del JID');
  afirmar(!!colgada && colgada.estado !== 'sonando', `y deja de timbrar (quedó «${colgada?.estado ?? 'sigue sonando'}»)`);

  console.log('\n3) Un "entrante" SIN número se rechaza, no se crea mudo');
  let rechazado = false;
  try {
    await pbx.webhook(tenant, { evento: 'entrante', callId: 'call-sin-numero', origen: 'whatsapp_chat' } as WebhookLlamadaDto);
  } catch { rechazado = true; }
  afirmar(rechazado, 'sin número la central recibe un error y la llamada NO entra a la cola');
  const cola = await pbx.listar('mebog', actor);
  afirmar(!cola.some((l) => l.callId === 'call-sin-numero'),
    'y en efecto no quedó ninguna llamada muda en la cola');

  await ds.destroy();
  console.log('\n────────────────────────────────────────');
  if (fallos.length) {
    console.log(`${fallos.length} comprobación(es) FALLARON:`);
    for (const f of fallos) console.log(`  ✗ ${f}`);
    return 1;
  }
  console.log('Todas las comprobaciones pasaron.');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
