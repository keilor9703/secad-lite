import { Injectable, Logger } from '@nestjs/common';

/**
 * Direcciones colombianas: del texto al punto y del punto al texto.
 *
 * Por qué existe este servicio en vez de preguntarle a Nominatim y ya:
 * la nomenclatura colombiana NO es una calle con número de casa, es un par de
 * vías que se cruzan. «Calle 53 # 52-35» significa «sobre la Calle 53, a 35
 * metros de la esquina con la Carrera 52». Nominatim no entiende el `#`: se
 * queda con «Calle 53», y como esa calle cruza la ciudad entera devuelve un
 * punto cualquiera de ella. Medido con este mismo ejemplo en Bogotá, el punto
 * que devolvía quedaba a 4,75 km del portal real — en un despacho de
 * emergencias eso es enviar la ambulancia a otro barrio.
 *
 * Aquí se resuelve como lo que es: se busca el NODO donde se cruzan las dos
 * vías (Overpass, sobre los mismos datos de OpenStreetMap) y se avanza por la
 * vía principal los metros que dice la placa. El número de la placa es
 * literalmente la distancia a la esquina, así que la cuenta cierra.
 */

/** Una dirección colombiana ya desarmada en sus partes. */
export interface DireccionColombiana {
  /** Calle, Carrera, Avenida, Diagonal, Transversal… */
  viaTipo: string;
  /** El número de la vía principal, con sus sufijos: «53», «53A», «7 Sur», «53 Bis». */
  viaNumero: string;
  /** El número de la vía que la cruza (la que va después del `#`). */
  cruceNumero?: string;
  /** Los metros desde la esquina (lo que va después del guion). */
  placa?: number;
}

/** Un municipio ubicado: su punto y, si se conoce, su extensión real. */
export interface Lugar {
  nombre: string;
  lat: number;
  lng: number;
  /** [sur, norte, oeste, este] tal como lo entrega Nominatim. */
  bbox?: [number, number, number, number];
}

export interface PuntoDireccion {
  lat: number;
  lng: number;
  /** Cómo se resolvió: importa para saber cuánto fiarse del punto. */
  precision: 'placa' | 'esquina' | 'aproximada';
  /** La dirección normalizada que corresponde al punto. */
  etiqueta: string;
}

/**
 * Qué tipo de vía cruza a cuál. En la retícula colombiana las calles corren en
 * un sentido y las carreras en el perpendicular; diagonales y transversales son
 * el par equivalente en las zonas que no siguen la retícula principal.
 */
const COMPLEMENTO: Record<string, string[]> = {
  calle: ['carrera', 'avenida carrera'],
  carrera: ['calle', 'avenida calle'],
  diagonal: ['transversal', 'carrera'],
  transversal: ['diagonal', 'calle'],
  avenida: ['carrera', 'calle'],
  'avenida calle': ['carrera', 'avenida carrera'],
  'avenida carrera': ['calle', 'avenida calle'],
};

/** Las formas en que la gente y los datos escriben cada tipo de vía. */
const SINONIMOS: Record<string, string> = {
  cl: 'calle', calle: 'calle', c: 'calle',
  kr: 'carrera', cra: 'carrera', cr: 'carrera', kra: 'carrera', carrera: 'carrera', k: 'carrera',
  dg: 'diagonal', diag: 'diagonal', diagonal: 'diagonal',
  tv: 'transversal', tr: 'transversal', transv: 'transversal', transversal: 'transversal',
  av: 'avenida', avda: 'avenida', avenida: 'avenida',
  ak: 'avenida carrera', ac: 'avenida calle',
  // Compuestos: «Av Calle 26», «Avenida Carrera 30». Van como claves propias
  // porque la lista se ordena de más larga a más corta al armar el patrón, y
  // así ganan sobre el «av» suelto — que si no, se comía el tipo de atrás.
  'av calle': 'avenida calle', 'avenida calle': 'avenida calle', 'av cl': 'avenida calle',
  'av carrera': 'avenida carrera', 'avenida carrera': 'avenida carrera',
  'av cra': 'avenida carrera', 'av kra': 'avenida carrera', 'av kr': 'avenida carrera',
};

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'FalconCAD/1.0 (despacho de emergencias)';

@Injectable()
export class DireccionesService {
  private readonly log = new Logger(DireccionesService.name);

  /**
   * Caché en memoria. Las direcciones se repiten muchísimo —un mismo barrio
   * genera llamadas todo el día— y tanto Overpass como Nominatim son servicios
   * públicos con límites de uso: sin caché, una sala ocupada los agota.
   */
  private readonly cache = new Map<string, { expira: number; valor: unknown }>();

  private recordar<T>(clave: string, calcular: () => Promise<T>, minutos = 60): Promise<T> {
    const ahora = Date.now();
    const hit = this.cache.get(clave);
    if (hit && hit.expira > ahora) return Promise.resolve(hit.valor as T);
    return calcular().then((valor) => {
      // Solo se cachea lo que sirvió: un fallo puntual de la red no debe dejar
      // "no encontrado" pegado durante una hora.
      if (valor) this.cache.set(clave, { expira: ahora + minutos * 60_000, valor });
      return valor;
    });
  }

  // --- Análisis del texto ---------------------------------------------------

  /**
   * Desarma «Calle 53 # 52-35», «Cra 7 No 45 12», «AK 68 # 24-30 Sur»…
   * Devuelve `null` si el texto no tiene forma de dirección colombiana, y
   * entonces quien llama cae a la búsqueda por texto libre.
   */
  parsear(texto: string): DireccionColombiana | null {
    if (!texto?.trim()) return null;
    // Se normaliza acentos y separadores para que el patrón sea uno solo.
    const limpio = texto
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\./g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tipos = Object.keys(SINONIMOS).sort((a, b) => b.length - a.length).join('|');
    // <tipo> <numero(+sufijos)> [# | No | Nro | -] <cruce(+sufijos)> [- <placa>]
    // El sufijo de letra va guardado con `(?![a-z])`: sin eso, la «N» de «No»
    // se colaba como letra de la vía («Cra 7 No 45-12» se leía como «Carrera 7 N»)
    // y el resto de la dirección —el cruce y la placa— se perdía.
    const letra = '(?:[a-z](?![a-z]))?';
    const sep = '(?:#|n[°º]|nro\\.?|no\\.?|n\\.|-)';
    const re = new RegExp(
      `^(${tipos})\\s*` +
      `(\\d+\\s*(?:bis)?\\s*${letra}\\s*(?:sur|norte|este|oeste)?)` +
      `(?:\\s*${sep}\\s*` +
      `(\\d+\\s*(?:bis)?\\s*${letra})` +
      `(?:\\s*[-\\s]\\s*(\\d+))?)?`,
      'i',
    );
    const m = limpio.match(re);
    if (!m) return null;

    const tipo = SINONIMOS[m[1].toLowerCase()];
    if (!tipo) return null;
    const norm = (s?: string) => s?.replace(/\s+/g, ' ').trim().toLowerCase();
    return {
      viaTipo: tipo,
      viaNumero: norm(m[2])!,
      cruceNumero: norm(m[3]),
      placa: m[4] ? Number(m[4]) : undefined,
    };
  }

  /** Cómo se escribe de vuelta, ya normalizada. */
  private etiquetaDe(d: DireccionColombiana): string {
    const may = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
    let t = `${may(d.viaTipo)} ${d.viaNumero.toUpperCase()}`;
    if (d.cruceNumero) t += ` # ${d.cruceNumero.toUpperCase()}`;
    if (d.placa != null) t += `-${d.placa}`;
    return t;
  }

  // --- Consultas a OpenStreetMap -------------------------------------------

  /**
   * Patrón de nombre para una vía. Los datos de OSM en Colombia escriben la
   * misma vía de varias formas («Calle 53», «Avenida Calle 53», «AC 53»), así
   * que se acepta el prefijo opcional y el número con sus sufijos.
   */
  private patronVia(tipo: string, numero: string): string {
    const base = tipo.split(' ').pop()!; // "avenida calle" -> "calle"
    const alias: Record<string, string> = {
      calle: '(Avenida )?(Calle|AC|Cl)',
      carrera: '(Avenida )?(Carrera|Kra|Cra|AK|Kr)',
      diagonal: '(Diagonal|Dg)',
      transversal: '(Transversal|Tv)',
      avenida: '(Avenida|Av)',
    };
    const n = numero.replace(/\s+/g, ' ?').toUpperCase();
    return `^${alias[base] ?? base} ${n}$`;
  }

  private async overpass<T = any>(consulta: string): Promise<T | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      const r = await fetch(OVERPASS, {
        method: 'POST',
        body: new URLSearchParams({ data: consulta }),
        headers: { 'User-Agent': UA },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch (e) {
      this.log.warn(`Overpass no respondió: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Caja de búsqueda del municipio. Se prefiere su extensión real; si no se
   * conoce, ~28 km alrededor del punto, que cubre cualquier casco urbano.
   */
  private caja(lugar: Lugar): string {
    if (lugar.bbox) {
      const [s, n, o, e] = lugar.bbox;
      return `${s.toFixed(4)},${o.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
    }
    const d = 0.25;
    return `${(lugar.lat - d).toFixed(4)},${(lugar.lng - d).toFixed(4)},${(lugar.lat + d).toFixed(4)},${(lugar.lng + d).toFixed(4)}`;
  }

  /** El nodo donde se cruzan dos vías, si existe. */
  private async cruce(
    caja: string,
    principal: string,
    cruceTipo: string,
    cruceNum: string,
  ): Promise<{ lat: number; lon: number } | null> {
    const q =
      `[out:json][timeout:22];` +
      `way(${caja})["highway"]["name"~"${principal}",i]->.a;` +
      `way(${caja})["highway"]["name"~"${this.patronVia(cruceTipo, cruceNum)}",i]->.b;` +
      `node(w.a)(w.b);out body 1;`;
    const d = await this.overpass<{ elements: Array<{ lat: number; lon: number }> }>(q);
    return d?.elements?.[0] ?? null;
  }

  /**
   * Ubica un municipio por su nombre.
   *
   * Hace falta porque el catálogo DIVIPOLA puede no estar sembrado (llega por
   * migración, y un entorno levantado con `synchronize` no lo tiene): sin
   * municipio no hay caja de búsqueda, la resolución por esquina se salta
   * entera y la búsqueda libre se va a otra ciudad —probado: «Calle 53 # 52-35»
   * sin municipio devolvía un punto en Medellín—. Con el nombre basta.
   */
  async municipioPorNombre(nombre: string): Promise<Lugar | null> {
    if (!nombre?.trim()) return null;
    return this.recordar(`m:${nombre}`, async () => {
      const q = encodeURIComponent(`${nombre.trim()}, Colombia`);
      try {
        const r = await fetch(`${NOMINATIM}/search?q=${q}&format=json&limit=1&countrycodes=co`, {
          headers: { 'Accept-Language': 'es', 'User-Agent': UA },
        });
        const d = (await r.json()) as Array<{ lat: string; lon: string; boundingbox?: string[] }>;
        const p = d?.[0];
        if (!p) return null;
        // El recuadro real importa: el centroide de «Bogotá D.C.» cae en zona
        // rural (el distrito incluye Sumapaz) y una caja fija a su alrededor
        // dejaba la ciudad entera FUERA de la búsqueda.
        const bb = p.boundingbox?.map(Number);
        return {
          nombre: nombre.trim(),
          lat: Number(p.lat),
          lng: Number(p.lon),
          bbox: bb?.length === 4 ? ([bb[0], bb[1], bb[2], bb[3]] as [number, number, number, number]) : undefined,
        };
      } catch {
        return null;
      }
    }, 24 * 60);
  }

  // --- Dirección → punto ----------------------------------------------------

  /**
   * Resuelve una dirección a coordenadas.
   *
   * Orden de intentos, de más preciso a menos:
   *   1. esquina de las dos vías + los metros de la placa → el portal
   *   2. solo la esquina, si no hay placa o no se pudo orientar
   *   3. Nominatim en texto libre, como último recurso (lo que había antes)
   */
  async geocodificar(
    texto: string,
    municipio: Lugar | null,
  ): Promise<PuntoDireccion | null> {
    const clave = `f:${texto}|${municipio?.nombre ?? ''}`;
    return this.recordar(clave, async () => {
      const d = this.parsear(texto);
      if (d?.cruceNumero && municipio) {
        const punto = await this.porInterseccion(d, municipio);
        if (punto) return punto;
      }
      return this.porTextoLibre(texto, municipio);
    });
  }

  private async porInterseccion(
    d: DireccionColombiana,
    municipio: Lugar,
  ): Promise<PuntoDireccion | null> {
    const caja = this.caja(municipio);
    const principal = this.patronVia(d.viaTipo, d.viaNumero);
    const tiposCruce = COMPLEMENTO[d.viaTipo] ?? ['carrera', 'calle'];

    let esquina: { lat: number; lon: number } | null = null;
    let tipoCruceUsado = '';
    for (const tc of tiposCruce) {
      esquina = await this.cruce(caja, principal, tc, d.cruceNumero!);
      if (esquina) { tipoCruceUsado = tc; break; }
    }
    if (!esquina) return null;

    const etiqueta = this.etiquetaDe(d);
    if (!d.placa) {
      return { lat: esquina.lat, lng: esquina.lon, precision: 'esquina', etiqueta };
    }

    // Para saber hacia dónde avanzar los metros de la placa se busca la esquina
    // SIGUIENTE (el cruce con la vía de número inmediatamente mayor): el vector
    // entre las dos esquinas es la dirección en que crece la numeración. Sin
    // esta referencia no se puede adivinar el sentido, y se deja la esquina.
    const siguienteNum = String(Number(d.cruceNumero!.replace(/\D.*$/, '')) + 1);
    const siguiente = await this.cruce(caja, principal, tipoCruceUsado, siguienteNum);
    if (!siguiente) {
      return { lat: esquina.lat, lng: esquina.lon, precision: 'esquina', etiqueta };
    }

    const destino = this.avanzar(esquina, siguiente, d.placa);
    return { lat: destino.lat, lng: destino.lng, precision: 'placa', etiqueta };
  }

  /** Avanza `metros` desde `a` en la dirección de `b`. */
  private avanzar(a: { lat: number; lon: number }, b: { lat: number; lon: number }, metros: number) {
    const dLat = b.lat - a.lat;
    const dLon = b.lon - a.lon;
    const mLat = 111_320;
    const mLon = 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const largo = Math.hypot(dLat * mLat, dLon * mLon);
    if (largo < 1) return { lat: a.lat, lng: a.lon };
    const f = metros / largo;
    return { lat: a.lat + dLat * f, lng: a.lon + dLon * f };
  }

  /** El camino de antes: texto libre a Nominatim, acotado al municipio. */
  private async porTextoLibre(
    texto: string,
    municipio: Lugar | null,
  ): Promise<PuntoDireccion | null> {
    const q = encodeURIComponent([texto, municipio?.nombre, 'Colombia'].filter(Boolean).join(', '));
    // `viewbox` + `bounded` mantienen el resultado dentro del municipio: sin
    // esto, una calle homónima de otra ciudad ganaba la búsqueda.
    const vb = municipio
      ? `&viewbox=${municipio.lng - 0.3},${municipio.lat + 0.3},${municipio.lng + 0.3},${municipio.lat - 0.3}&bounded=1`
      : '';
    try {
      const r = await fetch(`${NOMINATIM}/search?q=${q}&format=json&limit=1&countrycodes=co${vb}`, {
        headers: { 'Accept-Language': 'es', 'User-Agent': UA },
      });
      const d = (await r.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      const p = d?.[0];
      if (!p) return null;
      return {
        lat: Number(p.lat),
        lng: Number(p.lon),
        precision: 'aproximada',
        etiqueta: texto.trim(),
      };
    } catch (e) {
      this.log.warn(`Nominatim no respondió: ${(e as Error).message}`);
      return null;
    }
  }

  // --- Punto → dirección ----------------------------------------------------

  /**
   * Del punto a la dirección con numeración.
   *
   * Nominatim aquí devolvía solo el nombre de la vía («Calle 53»), porque en
   * Colombia OSM casi no tiene número de portal: una dirección así no le sirve
   * a una unidad que va en camino. Se arma como la arma un despachador: la vía
   * sobre la que cayó el punto, la esquina más cercana, y los metros que hay
   * entre las dos — que es exactamente el número de la placa.
   */
  async direccionDe(lat: number, lng: number): Promise<{ direccion: string; precision: string } | null> {
    // Se redondea la clave a ~11 m: dos clics contiguos son la misma esquina y
    // no tienen por qué pagar dos consultas.
    const clave = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    return this.recordar(clave, async () => {
      const q =
        `[out:json][timeout:22];` +
        `way(around:120,${lat},${lng})["highway"]["name"];out tags geom;`;
      const d = await this.overpass<{
        elements: Array<{ tags: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }>;
      }>(q);
      const vias = d?.elements?.filter((e) => e.geometry?.length) ?? [];
      if (!vias.length) return null;

      // La vía sobre la que cayó el punto: la más cercana.
      const conDist = vias.map((v) => ({
        nombre: v.tags.name,
        tipo: this.tipoDe(v.tags.name),
        distancia: Math.min(...v.geometry!.map((g) => this.metros(lat, lng, g.lat, g.lon))),
      }));
      conDist.sort((a, b) => a.distancia - b.distancia);
      const principal = conDist[0];

      // La esquina: la vía más cercana de tipo complementario (una carrera si
      // estamos sobre una calle). Comparar contra una paralela daría un número
      // sin sentido.
      const complementos = COMPLEMENTO[principal.tipo] ?? [];
      const cruces = conDist.filter(
        (v) => v.nombre !== principal.nombre && complementos.some((c) => v.tipo === c.split(' ').pop()),
      );
      // De las dos esquinas de la cuadra se toma la de número MENOR, no la más
      // cercana: la nomenclatura colombiana numera desde ahí. Un punto entre la
      // Carrera 52 y la 53 es «# 52-algo» aunque la 53 le quede más cerca;
      // escribirlo desde la 53 daría una dirección que no existe.
      const num = (n: string) => Number(n.replace(/\D+/g, '')) || Infinity;
      const cercanos = cruces.slice(0, 2).sort((a, b) => num(a.nombre) - num(b.nombre));
      const cruce = cercanos[0];

      if (!cruce) {
        return { direccion: principal.nombre, precision: 'via' };
      }
      // En la nomenclatura colombiana el número de la placa son los metros
      // desde la esquina, así que la distancia medida ES el número.
      const placa = Math.round(cruce.distancia);
      const numCruce = cruce.nombre.replace(/^\D+/, '').trim();
      return {
        direccion: `${principal.nombre} # ${numCruce}-${placa}`,
        precision: 'placa',
      };
    });
  }

  private tipoDe(nombre: string): string {
    const n = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/\bcarrera|\bcra|\bkra|^ak\b/.test(n)) return 'carrera';
    if (/\bcalle|^ac\b/.test(n)) return 'calle';
    if (/\bdiagonal|\bdg\b/.test(n)) return 'diagonal';
    if (/\btransversal|\btv\b/.test(n)) return 'transversal';
    if (/\bavenida|\bav\b/.test(n)) return 'avenida';
    return 'otra';
  }

  private metros(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
