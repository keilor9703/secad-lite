import 'reflect-metadata';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { DataSource, In } from 'typeorm';
import { AgenciaEntity } from '../catalogos/agencia.entity';
import { CanalEntity } from '../catalogos/canal.entity';
import { CodigoCasoEntity, PrioridadCaso, PRIORIDADES } from '../catalogos/codigo-caso.entity';

/**
 * Carga del catálogo de códigos de caso desde un CSV.
 *
 *   node dist/scripts/importar-codigos.js <archivo.csv> --tenant demo \
 *        [--agencia POLICIA] [--actualizar] [--desactivar-faltantes] [--dry-run]
 *
 * Pensado para el listado oficial de una entidad (cientos o miles de códigos).
 * Es repetible: por defecto crea los que faltan y respeta los que ya están; con
 * --actualizar además corrige descripción, prioridad y agencia de los
 * existentes, de modo que se puede volver a correr cuando cambie el listado.
 */

config();

// ── Lectura de CSV (RFC 4180: comillas, comas y saltos dentro del campo) ─────

function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto; // BOM de Excel

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else entreComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { entreComillas = true; continue; }
    if (c === ',' || c === ';' || c === '\t') { fila.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    campo += c;
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

function normalizar(s: string): string {
  return (s ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Nombres aceptados de columna, incluidos los del SECAD completo. */
const COLUMNAS: Record<string, string[]> = {
  codigo:      ['codigo', 'cod', 'codigocaso', 'codicaso', 'codipedido', 'tipopedido'],
  descripcion: ['descripcion', 'descripcioncaso', 'descpedido', 'nombre', 'detalle', 'motivo'],
  prioridad:   ['prioridad', 'importancia', 'nivel'],
  agencia:     ['agencia', 'entidad', 'fuerza', 'responsable', 'especialidad'],
};

/**
 * Prioridad tolerante: acepta las palabras, la escala numérica (1 = más alta)
 * y las iniciales, que es como suelen venir estos listados.
 */
function aPrioridad(txt: string): PrioridadCaso | null {
  const v = normalizar(txt);
  if (!v) return null;
  if (PRIORIDADES.includes(v as PrioridadCaso)) return v as PrioridadCaso;
  const equivalencias: Record<string, PrioridadCaso> = {
    '1': 'alta', '2': 'media', '3': 'baja',
    a: 'alta', m: 'media', b: 'baja',
    urgente: 'alta', critica: 'alta', inmediata: 'alta',
    normal: 'media', moderada: 'media',
    leve: 'baja', informativa: 'baja',
  };
  return equivalencias[v] ?? null;
}

interface Opciones {
  archivo: string;
  tenant: string;
  agencia?: string;
  actualizar: boolean;
  desactivarFaltantes: boolean;
  ensayo: boolean;
}

function leerOpciones(argv: string[]): Opciones {
  const pos = argv.filter((a) => !a.startsWith('--'));
  const dato = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    archivo: pos[0],
    tenant: dato('tenant') ?? 'demo',
    agencia: dato('agencia'),
    actualizar: argv.includes('--actualizar'),
    desactivarFaltantes: argv.includes('--desactivar-faltantes'),
    ensayo: argv.includes('--dry-run') || argv.includes('--ensayo'),
  };
}

const fuente = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [AgenciaEntity, CanalEntity, CodigoCasoEntity],
  migrations: [],
});

async function principal(): Promise<void> {
  const op = leerOpciones(process.argv.slice(2));
  if (!op.archivo) {
    console.error('Uso: importar-codigos <archivo.csv> --tenant <codigo> [--agencia POLICIA] [--actualizar] [--desactivar-faltantes] [--dry-run]');
    process.exit(1);
  }

  const filas = leerCsv(readFileSync(op.archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene datos.');

  const encabezado = filas[0].map(normalizar);
  const indice: Record<string, number> = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const i = encabezado.findIndex((h) => alias.includes(h));
    if (i >= 0) indice[campo] = i;
  }
  if (indice['codigo'] === undefined || indice['descripcion'] === undefined) {
    throw new Error(`El archivo debe traer al menos las columnas de código y descripción. Encabezado leído: ${filas[0].join(' | ')}`);
  }
  const valor = (f: string[], campo: string): string =>
    indice[campo] === undefined ? '' : (f[indice[campo]] ?? '').trim();

  await fuente.initialize();
  const repo = fuente.getRepository(CodigoCasoEntity);
  const agencias = await fuente.getRepository(AgenciaEntity).find({ where: { tenant: op.tenant } });
  if (!agencias.length) throw new Error(`El secad "${op.tenant}" no tiene agencias; créelas antes de cargar los códigos.`);

  const buscarAgencia = (txt: string) => {
    const t = normalizar(txt);
    return agencias.find((a) => normalizar(a.codigo) === t || normalizar(a.nombre) === t) ?? null;
  };
  const agenciaFija = op.agencia ? buscarAgencia(op.agencia) : null;
  if (op.agencia && !agenciaFija) throw new Error(`No existe la agencia "${op.agencia}" en el secad ${op.tenant}.`);

  const existentes = new Map(
    (await repo.find({ where: { tenant: op.tenant } })).map((c) => [c.codigo.toUpperCase(), c]),
  );

  const nuevos: CodigoCasoEntity[] = [];
  const cambiados: CodigoCasoEntity[] = [];
  const problemas: string[] = [];
  const vistos = new Set<string>();
  let sinCambio = 0;

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    const linea = f + 1;
    const codigo = valor(fila, 'codigo').toUpperCase().replace(/\s+/g, '');
    const descripcion = valor(fila, 'descripcion');

    if (!codigo) { problemas.push(`Línea ${linea}: sin código.`); continue; }
    if (!descripcion) { problemas.push(`Línea ${linea}: el código ${codigo} no trae descripción.`); continue; }
    if (codigo.length > 16) { problemas.push(`Línea ${linea}: el código "${codigo}" supera 16 caracteres.`); continue; }
    if (vistos.has(codigo)) { problemas.push(`Línea ${linea}: el código ${codigo} está repetido en el archivo.`); continue; }
    vistos.add(codigo);

    const textoAgencia = valor(fila, 'agencia');
    const agencia = (textoAgencia ? buscarAgencia(textoAgencia) : null) ?? agenciaFija;
    if (textoAgencia && !agencia) problemas.push(`Línea ${linea}: agencia "${textoAgencia}" desconocida; el código queda sin sugerencia.`);

    const prioridad = aPrioridad(valor(fila, 'prioridad')) ?? 'media';
    const previo = existentes.get(codigo);

    if (!previo) {
      nuevos.push(repo.create({
        tenant: op.tenant, codigo, descripcion: descripcion.slice(0, 160),
        prioridad, agenciaSugeridaId: agencia?.id ?? null, activo: true,
      }));
      continue;
    }
    if (!op.actualizar) { sinCambio++; continue; }

    const distinto = previo.descripcion !== descripcion.slice(0, 160)
      || previo.prioridad !== prioridad
      || (previo.agenciaSugeridaId ?? null) !== (agencia?.id ?? null)
      || !previo.activo;
    if (!distinto) { sinCambio++; continue; }
    previo.descripcion = descripcion.slice(0, 160);
    previo.prioridad = prioridad;
    previo.agenciaSugeridaId = agencia?.id ?? null;
    previo.activo = true;
    cambiados.push(previo);
  }

  // Códigos que están en la base pero ya no en el listado oficial.
  const sobrantes = [...existentes.values()].filter((c) => c.activo && !vistos.has(c.codigo.toUpperCase()));

  console.log(`\nArchivo:      ${op.archivo}`);
  console.log(`Secad:        ${op.tenant}${agenciaFija ? ` · agencia por defecto ${agenciaFija.nombre}` : ''}`);
  console.log(`Filas leídas: ${filas.length - 1}`);
  console.log(`Nuevos:       ${nuevos.length}`);
  console.log(`Actualizados: ${cambiados.length}${op.actualizar ? '' : ' (use --actualizar para corregir los existentes)'}`);
  console.log(`Sin cambio:   ${sinCambio}`);
  console.log(`Con problema: ${problemas.length}`);
  for (const p of problemas.slice(0, 20)) console.log(`   · ${p}`);
  if (problemas.length > 20) console.log(`   · … y ${problemas.length - 20} más`);
  if (sobrantes.length) {
    console.log(`Ya no vienen en el archivo: ${sobrantes.length}` +
      (op.desactivarFaltantes ? ' (se desactivarán)' : ' (se dejan como están; use --desactivar-faltantes para retirarlos)'));
  }

  if (op.ensayo) {
    console.log('\n--dry-run: no se escribió nada.\n');
    await fuente.destroy();
    return;
  }

  await fuente.transaction(async (mgr) => {
    // Por lotes: un INSERT de miles de filas de una vez satura los parámetros.
    for (let i = 0; i < nuevos.length; i += 500) await mgr.save(nuevos.slice(i, i + 500));
    for (let i = 0; i < cambiados.length; i += 500) await mgr.save(cambiados.slice(i, i + 500));
    if (op.desactivarFaltantes && sobrantes.length) {
      await mgr.update(CodigoCasoEntity, { id: In(sobrantes.map((c) => c.id)) }, { activo: false });
    }
  });

  console.log(`\nListo: ${nuevos.length} códigos creados` +
    `${cambiados.length ? `, ${cambiados.length} actualizados` : ''}` +
    `${op.desactivarFaltantes && sobrantes.length ? `, ${sobrantes.length} desactivados` : ''}` +
    ` en el secad ${op.tenant}.\n`);
  await fuente.destroy();
}

principal().catch(async (e) => {
  console.error(`\nLa carga se detuvo: ${(e as Error).message}\n`);
  if (fuente.isInitialized) await fuente.destroy();
  process.exit(1);
});
