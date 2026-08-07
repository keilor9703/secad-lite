import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgenciaEntity } from './agencia.entity';
import { CodigoCasoEntity, PRIORIDADES, PrioridadCaso } from './codigo-caso.entity';
import { CatalogosService } from './catalogos.service';

/** Columnas de la plantilla, en orden. Son también las del archivo exportado. */
export const COLUMNAS_CODIGOS = ['codigo', 'descripcion', 'prioridad', 'agencia'] as const;

/** Una fila rechazada, con el número de línea del archivo para poder corregirla. */
export interface FilaRechazada {
  linea: number;
  codigo: string;
  motivo: string;
}

export interface ResultadoImportacion {
  /** Filas de datos leídas (sin contar el encabezado). */
  leidas: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  rechazos: FilaRechazada[];
  /** `true` si fue una simulación: nada se escribió en la base. */
  simulacion: boolean;
}

export interface OpcionesImportacion {
  /**
   * Qué hacer con un código que ya existe: `omitir` lo deja como está (por
   * defecto) y `actualizar` reescribe descripción, prioridad y agencia.
   */
  existentes?: 'omitir' | 'actualizar';
  /** Validar y reportar sin escribir nada. Sirve para revisar antes de cargar. */
  simulacion?: boolean;
}

/**
 * Carga y descarga del catálogo de códigos de caso en CSV.
 *
 * El formato de la plantilla y el del archivo exportado son el mismo a
 * propósito: exportar, corregir en una hoja de cálculo y volver a importar es
 * el camino real por el que un secad mantiene mil y pico de códigos.
 */
@Injectable()
export class ImportacionService {
  constructor(
    @InjectRepository(CodigoCasoEntity) private readonly codigos: Repository<CodigoCasoEntity>,
    @InjectRepository(AgenciaEntity) private readonly agencias: Repository<AgenciaEntity>,
    private readonly catalogos: CatalogosService,
  ) {}

  // --- Exportación ------------------------------------------------------------

  /** El catálogo del secad como CSV, con las mismas columnas de la plantilla. */
  async exportarCodigos(tenant: string): Promise<string> {
    const filas = await this.catalogos.listarCodigos(tenant);
    const agencias = await this.agencias.find({ where: { tenant } });
    const porId = new Map(agencias.map((a) => [a.id, a.codigo]));
    const lineas = filas.map((c) =>
      this.aLinea([c.codigo, c.descripcion, c.prioridad, porId.get(c.agenciaSugeridaId ?? '') ?? '']),
    );
    return [this.aLinea([...COLUMNAS_CODIGOS]), ...lineas].join('\r\n') + '\r\n';
  }

  /** Plantilla vacía con el encabezado y una fila de ejemplo. */
  plantillaCodigos(): string {
    return [
      this.aLinea([...COLUMNAS_CODIGOS]),
      this.aLinea(['105', 'Riña con arma blanca', 'alta', 'POLICIA']),
      this.aLinea(['204', 'Incendio forestal', 'media', 'BOMBEROS']),
    ].join('\r\n') + '\r\n';
  }

  // --- Importación ------------------------------------------------------------

  /**
   * Procesa el CSV. Valida TODO el archivo antes de escribir nada: si hay
   * filas malas, se informan todas juntas y se cargan solo las buenas, en vez
   * de dejar la carga a medias en la primera que falle.
   */
  async importarCodigos(
    tenant: string,
    csv: string,
    opciones: OpcionesImportacion = {},
  ): Promise<ResultadoImportacion> {
    const existentes = opciones.existentes ?? 'omitir';
    const simulacion = opciones.simulacion === true;

    const filas = this.leerCsv(csv);
    if (!filas.length) throw new BadRequestException('El archivo está vacío.');

    const encabezado = filas[0].map((c) => this.normalizarEncabezado(c));
    const indice = this.mapearColumnas(encabezado);
    const cuerpo = filas.slice(1).filter((f) => f.some((c) => c.trim()));

    await this.catalogos.asegurarSeed(tenant);
    const agencias = await this.agencias.find({ where: { tenant } });
    const porCodigoAgencia = new Map(agencias.map((a) => [a.codigo.toUpperCase(), a]));
    const porNombreAgencia = new Map(agencias.map((a) => [a.nombre.trim().toLowerCase(), a]));

    const yaEnBase = await this.codigos.find({ where: { tenant } });
    const porCodigo = new Map(yaEnBase.map((c) => [c.codigo.toUpperCase(), c]));
    // Clave descripción+agencia: es la regla de duplicados que pidió la
    // operación. Dos agencias pueden tipificar «Hurto» por separado, pero la
    // misma agencia no puede tener dos códigos que signifiquen lo mismo.
    const porDescripcion = new Map(
      yaEnBase.map((c) => [this.claveDescripcion(c.descripcion, c.agenciaSugeridaId), c.codigo]),
    );

    const rechazos: FilaRechazada[] = [];
    const aCrear: CodigoCasoEntity[] = [];
    const aActualizar: CodigoCasoEntity[] = [];
    let omitidos = 0;

    // Duplicados dentro del propio archivo, no solo contra la base.
    const vistosCodigo = new Map<string, number>();
    const vistosDescripcion = new Map<string, number>();

    cuerpo.forEach((fila, i) => {
      const linea = i + 2; // +1 por el encabezado, +1 porque las líneas cuentan desde 1
      const codigo = (fila[indice.codigo] ?? '').trim().toUpperCase().replace(/\s+/g, '-');
      const descripcion = (fila[indice.descripcion] ?? '').trim();
      const prioridadCruda = (fila[indice.prioridad] ?? '').trim().toLowerCase();
      const agenciaCruda = (fila[indice.agencia] ?? '').trim();

      if (!codigo) return void rechazos.push({ linea, codigo: '', motivo: 'Falta el código.' });
      if (!descripcion) return void rechazos.push({ linea, codigo, motivo: 'Falta la descripción.' });

      const prioridad = (prioridadCruda || 'media') as PrioridadCaso;
      if (!PRIORIDADES.includes(prioridad)) {
        return void rechazos.push({
          linea, codigo, motivo: `Prioridad «${prioridadCruda}» inválida (alta, media o baja).`,
        });
      }

      let agencia: AgenciaEntity | undefined;
      if (agenciaCruda) {
        agencia = porCodigoAgencia.get(agenciaCruda.toUpperCase())
          ?? porNombreAgencia.get(agenciaCruda.toLowerCase());
        if (!agencia) {
          return void rechazos.push({
            linea, codigo, motivo: `La agencia «${agenciaCruda}» no existe en este secad.`,
          });
        }
      }

      const antes = vistosCodigo.get(codigo);
      if (antes) {
        return void rechazos.push({ linea, codigo, motivo: `Código repetido en el archivo (línea ${antes}).` });
      }
      vistosCodigo.set(codigo, linea);

      const claveDesc = this.claveDescripcion(descripcion, agencia?.id ?? null);
      const antesDesc = vistosDescripcion.get(claveDesc);
      if (antesDesc) {
        return void rechazos.push({
          linea, codigo,
          motivo: `Esa descripción ya viene en el archivo para la misma agencia (línea ${antesDesc}).`,
        });
      }
      vistosDescripcion.set(claveDesc, linea);

      // Duplicado por descripción contra la base, bajo otro código: es el error
      // que llena el catálogo de sinónimos y el que pidió atajar la operación.
      const dueño = porDescripcion.get(claveDesc);
      if (dueño && dueño.toUpperCase() !== codigo) {
        return void rechazos.push({
          linea, codigo,
          motivo: `Esa descripción ya existe para la misma agencia con el código «${dueño}».`,
        });
      }

      const existente = porCodigo.get(codigo);
      if (existente) {
        if (existentes === 'omitir') return void omitidos++;
        existente.descripcion = descripcion;
        existente.prioridad = prioridad;
        existente.agenciaSugeridaId = agencia?.id ?? null;
        existente.activo = true;
        aActualizar.push(existente);
        return;
      }

      aCrear.push(this.codigos.create({
        tenant, codigo, descripcion, prioridad, agenciaSugeridaId: agencia?.id ?? null, activo: true,
      }));
    });

    if (!simulacion) {
      // En tandas: un catálogo de policía trae más de mil filas y un solo
      // INSERT gigante haría fallar la sentencia por número de parámetros.
      for (const tanda of this.enTandas(aCrear, 200)) await this.codigos.save(tanda);
      for (const tanda of this.enTandas(aActualizar, 200)) await this.codigos.save(tanda);
    }

    return {
      leidas: cuerpo.length,
      creados: aCrear.length,
      actualizados: aActualizar.length,
      omitidos,
      rechazos,
      simulacion,
    };
  }

  // --- Apoyo ------------------------------------------------------------------

  private claveDescripcion(descripcion: string, agenciaId: string | null | undefined): string {
    // Se compara sin tildes, sin mayúsculas y sin espacios de más: «Riña  en
    // via publica» y «riña en vía pública» son el mismo caso para la operación.
    const limpia = descripcion
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
    return `${agenciaId ?? 'sin-agencia'}::${limpia}`;
  }

  private normalizarEncabezado(celda: string): string {
    return celda
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^\ufeff/, '');
  }

  /** Ubica cada columna esperada; acepta que vengan en otro orden. */
  private mapearColumnas(encabezado: string[]): Record<(typeof COLUMNAS_CODIGOS)[number], number> {
    const alias: Record<string, (typeof COLUMNAS_CODIGOS)[number]> = {
      codigo: 'codigo', code: 'codigo',
      descripcion: 'descripcion', description: 'descripcion',
      prioridad: 'prioridad', priority: 'prioridad',
      agencia: 'agencia', entidad: 'agencia', 'agencia sugerida': 'agencia',
    };
    // -1 significa «esa columna no vino»: prioridad y agencia son opcionales.
    const indice: Record<(typeof COLUMNAS_CODIGOS)[number], number> = {
      codigo: -1, descripcion: -1, prioridad: -1, agencia: -1,
    };
    encabezado.forEach((col, i) => {
      const canonico = alias[col];
      if (canonico && indice[canonico] < 0) indice[canonico] = i;
    });
    for (const requerida of ['codigo', 'descripcion'] as const) {
      if (indice[requerida] < 0) {
        throw new BadRequestException(
          `Al archivo le falta la columna «${requerida}». Descargue la plantilla y respete el encabezado: ` +
            COLUMNAS_CODIGOS.join(', ') + '.',
        );
      }
    }
    return indice;
  }

  /**
   * Lector de CSV: respeta comillas dobles (y las escapadas ""), separador coma
   * o punto y coma —Excel en español usa punto y coma— y saltos CRLF o LF.
   */
  private leerCsv(texto: string): string[][] {
    const limpio = texto.replace(/^\ufeff/, '');
    const sep = this.detectarSeparador(limpio);
    const filas: string[][] = [];
    let fila: string[] = [];
    let celda = '';
    let enComillas = false;

    for (let i = 0; i < limpio.length; i++) {
      const ch = limpio[i];
      if (enComillas) {
        if (ch === '"') {
          if (limpio[i + 1] === '"') { celda += '"'; i++; } else enComillas = false;
        } else celda += ch;
        continue;
      }
      if (ch === '"') { enComillas = true; continue; }
      if (ch === sep) { fila.push(celda); celda = ''; continue; }
      if (ch === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; continue; }
      if (ch === '\r') continue;
      celda += ch;
    }
    if (celda || fila.length) { fila.push(celda); filas.push(fila); }
    return filas;
  }

  private detectarSeparador(texto: string): string {
    const primera = texto.split(/\r?\n/, 1)[0] ?? '';
    return (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  }

  /** Arma una línea CSV entrecomillando lo que lo necesite. */
  private aLinea(celdas: string[]): string {
    return celdas
      .map((c) => {
        const v = c ?? '';
        return /[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      })
      .join(',');
  }

  private *enTandas<T>(lista: T[], tamaño: number): Generator<T[]> {
    for (let i = 0; i < lista.length; i += tamaño) yield lista.slice(i, i + tamaño);
  }
}
