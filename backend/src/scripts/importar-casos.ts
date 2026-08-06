import 'reflect-metadata';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { EventoCasoEntity } from '../casos/evento.entity';
import { AgenciaEntity } from '../catalogos/agencia.entity';
import { CanalEntity } from '../catalogos/canal.entity';
import { CodigoCasoEntity } from '../catalogos/codigo-caso.entity';
import { EstadoCaso, ESTADOS, PrioridadCaso, PRIORIDADES } from '../casos/caso.model';

config();

/**
 * Conexión propia del script. No se reutiliza la del CLI de migraciones porque
 * aquella apunta a los archivos .ts, que no existen al correr el compilado.
 */
const fuente = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [CasoEntity, EventoCasoEntity, AgenciaEntity, CanalEntity, CodigoCasoEntity],
  migrations: [],
});

/**
 * Carga masiva de casos históricos desde un CSV.
 *
 *   node dist/scripts/importar-casos.js <archivo.csv> --tenant demo \
 *        --agencia POLICIA [--canal C1] [--estado cerrado] [--dry-run]
 *
 * Pensado para migrar el histórico de una entidad (miles de registros) sin
 * ensuciar los datos: preserva la fecha original de cada caso, es repetible
 * (la referencia del sistema de origen impide duplicar) y valida todo el
 * archivo antes de escribir cuando se corre con --dry-run.
 */

// ── Lectura de CSV (RFC 4180: comillas, comas y saltos dentro del campo) ─────

function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;

  // Se quita la marca BOM que agregan Excel y varios exportadores.
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }  // comilla escapada
        else entreComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { entreComillas = true; continue; }
    if (c === ',' || c === ';') { fila.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    campo += c;
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

/** Normaliza un encabezado: sin acentos, sin signos, en minúsculas. */
function normalizar(s: string): string {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Nombres aceptados para cada campo. Incluye los del SECAD completo, para poder
 * volcar directamente una consulta sobre cad_pedidos sin renombrar columnas.
 */
const COLUMNAS: Record<string, string[]> = {
  referencia:  ['referencia', 'referenciaexterna', 'numellamada', 'idllamada', 'radicado', 'id'],
  fecha:       ['fecha', 'fechacaso', 'horacaso', 'fechahora', 'creadoen'],
  codigo:      ['codigo', 'codigocaso', 'codipedido', 'tipo'],
  titulo:      ['titulo', 'descripcioncaso', 'descripcion', 'motivo', 'asunto'],
  comentario:  ['comentario', 'relato', 'observacion', 'observaciones', 'detalle'],
  ciudadano:   ['ciudadano', 'llamante', 'nombllamante', 'nombrellamante', 'reportante'],
  telefono:    ['telefono', 'numetelefono', 'abonado', 'celular'],
  dirLlamante: ['direccionllamante', 'direllamante'],
  ciudad:      ['ciudad', 'municipio', 'ciudadcaso'],
  barrio:      ['barrio', 'barriocaso'],
  direccion:   ['direccion', 'direccioncaso', 'direcaso'],
  lat:         ['lat', 'latitud', 'latitudcaso', 'cordy'],
  lng:         ['lng', 'lon', 'longitud', 'longitudcaso', 'cordx'],
  prioridad:   ['prioridad', 'importancia'],
  estado:      ['estado'],
  agencia:     ['agencia', 'entidad', 'fuerza'],
  canales:     ['canales', 'canal', 'canalatencion'],
  medio:       ['medio', 'canalentrada', 'mediocomunicacion', 'origen'],
};

/** Fecha tolerante: ISO, dd/MM/yyyy y dd-MM-yyyy, con hora opcional. */
function aFecha(valor: string): Date | null {
  const v = valor?.trim();
  if (!v) return null;
  const latino = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (latino) {
    const [, d, m, a, h = '0', mi = '0', s = '0'] = latino;
    return new Date(+a, +m - 1, +d, +h, +mi, +s);
  }
  const f = new Date(v);
  return isNaN(f.getTime()) ? null : f;
}

function aNumero(valor: string): number | null {
  const v = valor?.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  // Muchos exportadores ponen 0 donde no hubo georreferenciación.
  return isNaN(n) || n === 0 ? null : n;
}

interface Opciones {
  archivo: string;
  tenant: string;
  agencia?: string;
  canal?: string;
  estado: EstadoCaso;
  ensayo: boolean;
  lote: number;
  usuario: string;
}

function leerOpciones(argv: string[]): Opciones {
  const pos = argv.filter((a) => !a.startsWith('--'));
  const dato = (nombre: string): string | undefined => {
    const i = argv.indexOf(`--${nombre}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const estado = (dato('estado') ?? 'cerrado') as EstadoCaso;
  if (!ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  return {
    archivo: pos[0],
    tenant: dato('tenant') ?? 'demo',
    agencia: dato('agencia'),
    canal: dato('canal'),
    estado,
    ensayo: argv.includes('--dry-run') || argv.includes('--ensayo'),
    lote: Number(dato('lote') ?? 500),
    usuario: dato('usuario') ?? 'importacion',
  };
}

async function principal(): Promise<void> {
  const op = leerOpciones(process.argv.slice(2));
  if (!op.archivo) {
    console.error('Uso: importar-casos <archivo.csv> --tenant <codigo> [--agencia POLICIA] [--canal C1] [--estado cerrado] [--dry-run]');
    process.exit(1);
  }

  const filas = leerCsv(readFileSync(op.archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene datos.');

  // Encabezado → posición de cada campo conocido.
  const encabezado = filas[0].map(normalizar);
  const indice: Record<string, number> = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const i = encabezado.findIndex((h) => alias.includes(h));
    if (i >= 0) indice[campo] = i;
  }
  const valor = (fila: string[], campo: string): string =>
    indice[campo] === undefined ? '' : (fila[indice[campo]] ?? '').trim();

  await fuente.initialize();
  const casos = fuente.getRepository(CasoEntity);
  const eventos = fuente.getRepository(EventoCasoEntity);

  // Catálogos del secad, en memoria: son decenas de filas y se consultan por cada caso.
  const agencias = await fuente.getRepository(AgenciaEntity).find({ where: { tenant: op.tenant } });
  const canales = await fuente.getRepository(CanalEntity).find({ where: { tenant: op.tenant } });
  const codigos = await fuente.getRepository(CodigoCasoEntity).find({ where: { tenant: op.tenant } });
  if (!agencias.length) throw new Error(`El secad "${op.tenant}" no tiene catálogo de agencias.`);

  const buscarAgencia = (txt: string) => {
    const t = normalizar(txt);
    return agencias.find((a) => normalizar(a.codigo) === t || normalizar(a.nombre) === t) ?? null;
  };
  const buscarCanal = (txt: string, agenciaId?: string) => {
    const t = normalizar(txt);
    return canales.find((c) => normalizar(c.codigo) === t && (!agenciaId || c.agenciaId === agenciaId)) ?? null;
  };

  const agenciaFija = op.agencia ? buscarAgencia(op.agencia) : null;
  if (op.agencia && !agenciaFija) throw new Error(`No existe la agencia "${op.agencia}" en el secad ${op.tenant}.`);
  const canalFijo = op.canal ? buscarCanal(op.canal, agenciaFija?.id) : null;
  if (op.canal && !canalFijo) throw new Error(`No existe el canal "${op.canal}" en esa agencia.`);

  // Referencias ya cargadas: hacen repetible la importación.
  const yaCargadas = new Set(
    (await casos.find({ where: { tenant: op.tenant }, select: { referenciaExterna: true } }))
      .map((c) => c.referenciaExterna).filter(Boolean) as string[],
  );

  const problemas: string[] = [];
  const pendientes: Array<{ caso: CasoEntity; fecha: Date | null }> = [];
  let omitidos = 0;
  const vistasEnArchivo = new Set<string>();

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    const linea = f + 1;

    const referencia = valor(fila, 'referencia') || null;
    if (referencia && (yaCargadas.has(referencia) || vistasEnArchivo.has(referencia))) { omitidos++; continue; }
    if (referencia) vistasEnArchivo.add(referencia);

    const ciudadano = valor(fila, 'ciudadano');
    if (!ciudadano) { problemas.push(`Línea ${linea}: sin nombre de quien reporta.`); continue; }

    const codigo = valor(fila, 'codigo');
    const def = codigo ? codigos.find((c) => normalizar(c.codigo) === normalizar(codigo)) : undefined;
    const titulo = valor(fila, 'titulo') || def?.descripcion || '';
    if (!titulo) { problemas.push(`Línea ${linea}: sin descripción y con código "${codigo}" desconocido.`); continue; }

    const agencia = (valor(fila, 'agencia') ? buscarAgencia(valor(fila, 'agencia')) : null) ?? agenciaFija;
    if (valor(fila, 'agencia') && !agencia) {
      problemas.push(`Línea ${linea}: agencia "${valor(fila, 'agencia')}" desconocida.`);
      continue;
    }

    // Canales: los de la fila (separados por |) o el indicado en la línea de comandos.
    const idsCanal: string[] = [];
    const enFila = valor(fila, 'canales');
    if (enFila) {
      for (const parte of enFila.split(/[|;]/).map((x) => x.trim()).filter(Boolean)) {
        const c = buscarCanal(parte, agencia?.id);
        if (c) idsCanal.push(c.id);
        else problemas.push(`Línea ${linea}: canal "${parte}" desconocido en esa agencia.`);
      }
    } else if (canalFijo && (!agencia || canalFijo.agenciaId === agencia.id)) {
      idsCanal.push(canalFijo.id);
    }

    const prioridadTxt = normalizar(valor(fila, 'prioridad')) as PrioridadCaso;
    const estadoTxt = normalizar(valor(fila, 'estado')) as EstadoCaso;

    const caso = casos.create({
      tenant: op.tenant,
      canal: 'llamada',
      referenciaExterna: referencia,
      titulo: titulo.slice(0, 160),
      descripcion: valor(fila, 'comentario'),
      ciudadano: ciudadano.slice(0, 120),
      telefono: valor(fila, 'telefono') || null,
      direccionLlamante: valor(fila, 'dirLlamante') || null,
      codigoCaso: codigo || null,
      prioridad: PRIORIDADES.includes(prioridadTxt) ? prioridadTxt : def?.prioridad ?? 'media',
      ciudad: valor(fila, 'ciudad') || null,
      barrio: valor(fila, 'barrio') || null,
      direccion: valor(fila, 'direccion') || null,
      lat: aNumero(valor(fila, 'lat')),
      lng: aNumero(valor(fila, 'lng')),
      agencia: agencia?.nombre ?? 'Central',
      agenciaOrigenId: agencia?.id ?? null,
      agenciaResponsableId: agencia?.id ?? null,
      canales: idsCanal,
      estado: ESTADOS.includes(estadoTxt) ? estadoTxt : op.estado,
      creadoPor: op.usuario,
    });
    pendientes.push({ caso, fecha: aFecha(valor(fila, 'fecha')) });
  }

  console.log(`\nArchivo:      ${op.archivo}`);
  console.log(`Secad:        ${op.tenant}${agenciaFija ? ` · agencia ${agenciaFija.nombre}` : ''}${canalFijo ? ` · canal ${canalFijo.codigo}` : ''}`);
  console.log(`Filas leídas: ${filas.length - 1}`);
  console.log(`Por importar: ${pendientes.length}`);
  console.log(`Omitidos:     ${omitidos} (ya estaban cargados o repetidos en el archivo)`);
  console.log(`Con problema: ${problemas.length}`);
  for (const p of problemas.slice(0, 20)) console.log(`   · ${p}`);
  if (problemas.length > 20) console.log(`   · … y ${problemas.length - 20} más`);
  const sinFecha = pendientes.filter((p) => !p.fecha).length;
  if (sinFecha) console.log(`Aviso:        ${sinFecha} casos sin fecha legible; quedarán con la de hoy.`);

  if (op.ensayo) {
    console.log('\n--dry-run: no se escribió nada.\n');
    await fuente.destroy();
    return;
  }

  // Escritura por lotes, cada uno en su transacción: si algo falla, no queda a medias.
  let creados = 0;
  for (let i = 0; i < pendientes.length; i += op.lote) {
    const lote = pendientes.slice(i, i + op.lote);
    await fuente.transaction(async (mgr) => {
      const guardados = await mgr.save(lote.map((p) => p.caso));
      // La fecha original se fija después: @CreateDateColumn la sobrescribe al insertar.
      for (let k = 0; k < guardados.length; k++) {
        const fecha = lote[k].fecha;
        if (fecha) {
          await mgr.query('UPDATE casos SET "creadoEn" = $1, "actualizadoEn" = $1 WHERE id = $2', [fecha, guardados[k].id]);
        }
      }
      await mgr.save(guardados.map((c) => mgr.create(EventoCasoEntity, {
        tenant: op.tenant,
        casoId: c.id,
        tipo: 'creacion' as const,
        descripcion: `Caso importado del sistema anterior${c.referenciaExterna ? ` (referencia ${c.referenciaExterna})` : ''}.`,
        autor: op.usuario,
      })));
      creados += guardados.length;
    });
    console.log(`   … ${Math.min(i + op.lote, pendientes.length)} / ${pendientes.length}`);
  }

  console.log(`\nListo: ${creados} casos importados en el secad ${op.tenant}.\n`);
  await fuente.destroy();
}

principal().catch(async (e) => {
  console.error(`\nLa importación se detuvo: ${(e as Error).message}\n`);
  if (fuente.isInitialized) await fuente.destroy();
  process.exit(1);
});
