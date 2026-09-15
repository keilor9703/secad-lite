import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantEntity } from '../tenants/tenant.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { BitacoraAdminEntity } from '../auditoria/bitacora-admin.entity';
import { CtiEventoEntity } from '../cti/cti-evento.entity';

/** Días sin señales de vida tras los cuales una instancia se considera dormida. */
const DIAS_DORMIDA = 14;
/** Ventana con la que se mide el uso y la adopción. */
const DIAS_VENTANA = 30;
/** Cuánto antes de vencer se avisa de una renovación. */
const DIAS_AVISO_VENCIMIENTO = 30;

export interface ResumenCartera {
  total: number;
  porSuscripcion: Record<string, number>;
  porPlan: Record<string, number>;
  totalCuentas: number;
  porDepartamento: Array<{ departamento: string; instancias: number }>;
  /** Lo que hay que atender, ya ordenado por urgencia. */
  alertas: Array<{
    tipo: 'vencida' | 'por_vencer' | 'suspendida' | 'dormida';
    codigo: string;
    nombre: string;
    detalle: string;
  }>;
}

export interface Uso {
  dias: number;
  /** Casos por día en TODA la plataforma, para la gráfica. */
  serie: Array<{ dia: string; casos: number }>;
  totales: { casos: number; llamadas: number; mensajes: number; casosHoy: number };
  /** Las instancias que más mueven, de mayor a menor. */
  ranking: Array<{
    codigo: string;
    nombre: string;
    casos: number;
    llamadas: number;
    mensajes: number;
    cuentas: number;
  }>;
}

export interface Adopcion {
  dias: number;
  modulos: Array<{
    clave: string;
    nombre: string;
    contratado: number;
    enUso: number;
    /** Instancias que lo pagan y no lo tocan: o no lo supieron configurar, o no lo van a renovar. */
    ociosas: Array<{ codigo: string; nombre: string }>;
    /** Contratado pero sin credenciales cargadas: nunca llegó a arrancar. */
    sinConfigurar: Array<{ codigo: string; nombre: string }>;
  }>;
}

/** Lo que se recolecta de las tablas con RLS, una vez, para alimentar todo lo demás. */
interface DatosTenant {
  casosPorDia: Map<string, number>;
  casosPorCanal: Map<string, number>;
  casos: number;
  llamadas: number;
  mensajes: number;
  ultimoCaso: Date | null;
}

@Injectable()
export class PlataformaService {
  constructor(
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(BitacoraAdminEntity) private readonly bitacora: Repository<BitacoraAdminEntity>,
    @InjectRepository(CtiEventoEntity) private readonly ctiEventos: Repository<CtiEventoEntity>,
    private readonly rls: TenantRlsService,
  ) {}

  // --- Caché ---------------------------------------------------------------

  /**
   * El panorama recorre cada instancia por separado (lo exige el aislamiento
   * por RLS), así que no puede recalcularse en cada petición: la pantalla de
   * monitoreo se refresca sola y tres de sus secciones se alimentan del mismo
   * recorrido. Se calcula una vez por minuto y se reparte.
   */
  private cache: { expira: number; valor: Promise<Panorama> } | null = null;

  private panorama(): Promise<Panorama> {
    const ahora = Date.now();
    if (this.cache && this.cache.expira > ahora) return this.cache.valor;
    const valor = this.recolectar().catch((e) => {
      // Un fallo no debe quedar cacheado: la siguiente petición reintenta.
      this.cache = null;
      throw e;
    });
    this.cache = { expira: ahora + 60_000, valor };
    return valor;
  }

  // --- Recolección ---------------------------------------------------------

  private async recolectar(): Promise<Panorama> {
    const desde = new Date(Date.now() - DIAS_VENTANA * 86_400_000);
    const instancias = await this.tenants.find({ order: { nombre: 'ASC' } });
    const codigos = instancias.map((t) => t.codigo);

    const [cuentas, ultimaConfig, ctiPorTenant, porTenant] = await Promise.all([
      this.conteoPorTenant(this.usuarios, 'u'),
      this.ultimoMovimientoConfig(),
      this.conteoCtiPorTenant(desde),
      // Las seis tablas con RLS solo se dejan agregar visitando instancia por
      // instancia; las consultas de arriba son de tablas sin RLS y van de una
      // sola vez.
      this.rls.porCadaTenant(codigos, async (m, codigo) => this.datosDe(m, codigo, desde)),
    ]);

    const datos = new Map(porTenant.map((p) => [p.tenant, p.valor]));
    return { instancias, cuentas, ultimaConfig, ctiPorTenant, datos, desde };
  }

  /**
   * Todo lo que hace falta de las tablas protegidas, para UNA instancia.
   *
   * El filtro por `tenant` va EXPLÍCITO en cada consulta aunque la transacción
   * ya tenga fijado `app.tenant`, y no es redundancia decorativa: RLS no se
   * aplica a un superusuario de PostgreSQL ni a un rol con BYPASSRLS. En los
   * entornos de desarrollo donde la aplicación se conecta como `postgres`
   * —comprobado en este repositorio— las políticas no filtran nada, y confiar
   * solo en ellas haría que cada vuelta del bucle devolviera los casos de
   * TODAS las instancias: los totales saldrían multiplicados por el número de
   * inquilinos. Con el predicado explícito la cifra es la misma en desarrollo
   * y en producción, y RLS queda como segunda línea de defensa, que es el
   * papel que cumple en el resto del sistema (ver CasosService).
   */
  private async datosDe(
    m: { query: (sql: string, params?: any[]) => Promise<any[]> },
    tenant: string,
    desde: Date,
  ): Promise<DatosTenant> {
    // Una sola pasada por `casos` da la serie diaria y el reparto por canal:
    // agrupando por ambos y sumando después, se evita recorrer la tabla dos veces.
    const [filas, llamadas, mensajes, ultimo] = await Promise.all([
      m.query(
        `SELECT to_char(date_trunc('day', "creadoEn"), 'YYYY-MM-DD') AS dia, canal, count(*)::int AS n
           FROM casos WHERE tenant = $1 AND "creadoEn" >= $2 GROUP BY 1, 2`,
        [tenant, desde],
      ),
      m.query('SELECT count(*)::int AS n FROM llamadas WHERE tenant = $1 AND "creadoEn" >= $2', [tenant, desde]),
      m.query('SELECT count(*)::int AS n FROM casos_mensajes WHERE tenant = $1 AND "creadoEn" >= $2', [tenant, desde]),
      m.query('SELECT max("creadoEn") AS ultimo FROM casos WHERE tenant = $1', [tenant]),
    ]);

    const casosPorDia = new Map<string, number>();
    const casosPorCanal = new Map<string, number>();
    let casos = 0;
    for (const f of filas) {
      const n = Number(f.n);
      casos += n;
      casosPorDia.set(f.dia, (casosPorDia.get(f.dia) ?? 0) + n);
      casosPorCanal.set(f.canal, (casosPorCanal.get(f.canal) ?? 0) + n);
    }
    return {
      casosPorDia,
      casosPorCanal,
      casos,
      llamadas: Number(llamadas[0]?.n ?? 0),
      mensajes: Number(mensajes[0]?.n ?? 0),
      ultimoCaso: ultimo[0]?.ultimo ? new Date(ultimo[0].ultimo) : null,
    };
  }

  private async conteoPorTenant(repo: Repository<any>, alias: string): Promise<Map<string, number>> {
    const filas = await repo
      .createQueryBuilder(alias)
      .select(`${alias}.tenant`, 'tenant')
      .addSelect('COUNT(*)', 'total')
      .where(`${alias}.tenant IS NOT NULL`)
      .groupBy(`${alias}.tenant`)
      .getRawMany<{ tenant: string; total: string }>();
    return new Map(filas.map((f) => [f.tenant, Number(f.total)]));
  }

  /** Último cambio de configuración por instancia: la otra señal de que alguien la está usando. */
  private async ultimoMovimientoConfig(): Promise<Map<string, Date>> {
    const filas = await this.bitacora
      .createQueryBuilder('b')
      .select('b.tenant', 'tenant')
      .addSelect('MAX(b.creadoEn)', 'ultimo')
      .groupBy('b.tenant')
      .getRawMany<{ tenant: string; ultimo: string }>();
    return new Map(filas.map((f) => [f.tenant, new Date(f.ultimo)]));
  }

  /** `cti_eventos` no está bajo RLS, así que se agrega de una sola consulta. */
  private async conteoCtiPorTenant(desde: Date): Promise<Map<string, number>> {
    const filas = await this.ctiEventos
      .createQueryBuilder('e')
      .select('e.tenant', 'tenant')
      .addSelect('COUNT(*)', 'total')
      .where('e.creadoEn >= :desde', { desde })
      .groupBy('e.tenant')
      .getRawMany<{ tenant: string; total: string }>();
    return new Map(filas.map((f) => [f.tenant, Number(f.total)]));
  }

  // --- Cartera -------------------------------------------------------------

  async cartera(): Promise<ResumenCartera> {
    const p = await this.panorama();
    const hoy = new Date();
    const limiteAviso = new Date(hoy.getTime() + DIAS_AVISO_VENCIMIENTO * 86_400_000);
    const limiteDormida = new Date(hoy.getTime() - DIAS_DORMIDA * 86_400_000);

    const porSuscripcion: Record<string, number> = {};
    const porPlan: Record<string, number> = {};
    const porDepto = new Map<string, number>();
    const alertas: ResumenCartera['alertas'] = [];

    for (const t of p.instancias) {
      porSuscripcion[t.suscripcion] = (porSuscripcion[t.suscripcion] ?? 0) + 1;
      porPlan[t.plan] = (porPlan[t.plan] ?? 0) + 1;
      const depto = t.departamento ?? 'Sin departamento';
      porDepto.set(depto, (porDepto.get(depto) ?? 0) + 1);

      if (t.vence) {
        const vence = new Date(`${t.vence}T23:59:59`);
        if (vence < hoy) {
          alertas.push({ tipo: 'vencida', codigo: t.codigo, nombre: t.nombre, detalle: `Venció el ${t.vence}.` });
        } else if (vence <= limiteAviso) {
          const dias = Math.ceil((vence.getTime() - hoy.getTime()) / 86_400_000);
          alertas.push({ tipo: 'por_vencer', codigo: t.codigo, nombre: t.nombre, detalle: `Vence en ${dias} día${dias === 1 ? '' : 's'} (${t.vence}).` });
        }
      }

      if (t.suscripcion === 'suspendida' || !t.activo) {
        alertas.push({
          tipo: 'suspendida',
          codigo: t.codigo,
          nombre: t.nombre,
          detalle: t.motivoBloqueo?.trim() || 'Sin motivo registrado.',
        });
      }

      // Señales de vida: el último caso creado y el último cambio de
      // configuración. Ojo con lo que NO mide — ver el comentario de abajo.
      const señales = [p.datos.get(t.codigo)?.ultimoCaso, p.ultimaConfig.get(t.codigo)].filter(
        (d): d is Date => !!d,
      );
      const ultima = señales.length ? new Date(Math.max(...señales.map((d) => d.getTime()))) : null;
      if (t.activo && t.suscripcion !== 'suspendida' && (!ultima || ultima < limiteDormida)) {
        alertas.push({
          tipo: 'dormida',
          codigo: t.codigo,
          nombre: t.nombre,
          detalle: ultima
            ? `Sin casos nuevos ni cambios de configuración desde el ${ultima.toISOString().slice(0, 10)}.`
            : 'Nunca ha registrado un caso ni un cambio de configuración.',
        });
      }
    }

    const orden = { vencida: 0, suspendida: 1, por_vencer: 2, dormida: 3 };
    alertas.sort((a, b) => orden[a.tipo] - orden[b.tipo] || a.nombre.localeCompare(b.nombre));

    return {
      total: p.instancias.length,
      porSuscripcion,
      porPlan,
      totalCuentas: [...p.cuentas.values()].reduce((s, n) => s + n, 0),
      porDepartamento: [...porDepto.entries()]
        .map(([departamento, instancias]) => ({ departamento, instancias }))
        .sort((a, b) => b.instancias - a.instancias),
      alertas,
    };
  }

  // --- Uso -----------------------------------------------------------------

  async uso(): Promise<Uso> {
    const p = await this.panorama();

    // La serie se arma sobre TODOS los días de la ventana, no solo los que
    // tuvieron casos: una gráfica que omite los días en cero miente sobre la
    // forma de la demanda.
    const serie: Array<{ dia: string; casos: number }> = [];
    const hoy = new Date();
    for (let i = DIAS_VENTANA - 1; i >= 0; i--) {
      const dia = new Date(hoy.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      let casos = 0;
      for (const d of p.datos.values()) casos += d.casosPorDia.get(dia) ?? 0;
      serie.push({ dia, casos });
    }

    const ranking = p.instancias
      .map((t) => {
        const d = p.datos.get(t.codigo);
        return {
          codigo: t.codigo,
          nombre: t.nombre,
          casos: d?.casos ?? 0,
          llamadas: d?.llamadas ?? 0,
          mensajes: d?.mensajes ?? 0,
          cuentas: p.cuentas.get(t.codigo) ?? 0,
        };
      })
      .sort((a, b) => b.casos - a.casos || b.llamadas - a.llamadas);

    const suma = (f: (d: DatosTenant) => number) => [...p.datos.values()].reduce((s, d) => s + f(d), 0);
    return {
      dias: DIAS_VENTANA,
      serie,
      totales: {
        casos: suma((d) => d.casos),
        llamadas: suma((d) => d.llamadas),
        mensajes: suma((d) => d.mensajes),
        casosHoy: serie[serie.length - 1]?.casos ?? 0,
      },
      ranking,
    };
  }

  // --- Adopción ------------------------------------------------------------

  /**
   * Qué módulos se pagan y cuáles se usan de verdad. La diferencia es la
   * columna que importa: una integración contratada y ociosa es o una venta a
   * punto de perderse, o un cliente que nunca supo encenderla. Se distingue
   * además el caso "ni siquiera tiene credenciales cargadas", que es un
   * problema de puesta en marcha y no de uso.
   */
  async adopcion(): Promise<Adopcion> {
    const p = await this.panorama();

    const definicion: Array<{
      clave: string;
      nombre: string;
      configurado: (t: TenantEntity) => boolean;
      usos: (codigo: string) => number;
    }> = [
      {
        clave: 'pbx',
        nombre: 'Planta telefónica (PBX)',
        configurado: (t) => !!t.apiKey,
        usos: (c) => p.datos.get(c)?.llamadas ?? 0,
      },
      {
        clave: 'whatsapp',
        nombre: 'WhatsApp',
        configurado: (t) => !!t.waPhoneNumberId && !!t.waAccessToken,
        usos: (c) => p.datos.get(c)?.casosPorCanal.get('whatsapp') ?? 0,
      },
      {
        clave: 'api',
        nombre: 'API de integración',
        configurado: (t) => !!t.apiKey,
        usos: (c) => p.datos.get(c)?.casosPorCanal.get('integracion') ?? 0,
      },
      {
        clave: 'cti',
        nombre: 'Barra CTI',
        configurado: (t) => !!t.ctiApiKey,
        usos: (c) => p.ctiPorTenant.get(c) ?? 0,
      },
    ];

    return {
      dias: DIAS_VENTANA,
      modulos: definicion.map((d) => {
        const contratadas = p.instancias.filter((t) => (t.integraciones ?? []).includes(d.clave));
        const ociosas = contratadas.filter((t) => d.configurado(t) && d.usos(t.codigo) === 0);
        const sinConfigurar = contratadas.filter((t) => !d.configurado(t));
        return {
          clave: d.clave,
          nombre: d.nombre,
          contratado: contratadas.length,
          enUso: contratadas.filter((t) => d.usos(t.codigo) > 0).length,
          ociosas: ociosas.map((t) => ({ codigo: t.codigo, nombre: t.nombre })),
          sinConfigurar: sinConfigurar.map((t) => ({ codigo: t.codigo, nombre: t.nombre })),
        };
      }),
    };
  }

  // --- Bitácora global -----------------------------------------------------

  /**
   * La bitácora de TODAS las instancias en un solo lugar. El endpoint que ya
   * existe (`/api/admin/bitacora`) la acota a un tenant, que es lo correcto
   * para el administrador de un municipio; el dueño de la plataforma necesita
   * justo lo contrario.
   */
  async bitacoraGlobal(limite = 50): Promise<Array<BitacoraAdminEntity & { nombreTenant: string }>> {
    const [entradas, instancias] = await Promise.all([
      this.bitacora.find({ order: { creadoEn: 'DESC' }, take: Math.min(Math.max(limite, 1), 200) }),
      this.tenants.find(),
    ]);
    const nombres = new Map(instancias.map((t) => [t.codigo, t.nombre]));
    return entradas.map((e) => ({ ...e, nombreTenant: nombres.get(e.tenant) ?? e.tenant }));
  }
}

/** Fotografía de la plataforma tomada de una sola vez; ver `panorama()`. */
interface Panorama {
  instancias: TenantEntity[];
  cuentas: Map<string, number>;
  ultimaConfig: Map<string, Date>;
  ctiPorTenant: Map<string, number>;
  datos: Map<string, DatosTenant>;
  desde: Date;
}
