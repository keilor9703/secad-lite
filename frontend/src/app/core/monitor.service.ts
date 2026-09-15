import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { EntradaBitacora } from './admin.service';

/**
 * Una medida que puede no existir. El backend nunca inventa un número que no
 * pudo leer (memoria de un contenedor sin cgroup, conexiones tras un pooler,
 * Redis no configurado): dice que no pudo y por qué, y la pantalla lo muestra
 * así en vez de pintar un cero que se leería como "todo bien".
 */
export type Medida<T> = { disponible: true; valor: T } | { disponible: false; motivo: string };

/** De dónde salió el número: dentro de un contenedor, el sistema operativo describe otra máquina. */
export type FuenteMedida = 'cgroup-v2' | 'cgroup-v1' | 'sistema';

export interface Consumo {
  usadoBytes: number;
  totalBytes: number;
  porcentaje: number;
  fuente: FuenteMedida;
}

export interface Salud {
  api: { ok: true; uptimeSegundos: number; entorno: string };
  base: Medida<{
    latenciaMs: number;
    tamanoBytes: Medida<number>;
    conexiones: Medida<{ enUso: number; maximo: number }>;
    version: Medida<string>;
  }>;
  redis: Medida<{ memoriaBytes: number; clientes: number; version: string }>;
}

export interface Infraestructura {
  cpu: Medida<{ porcentaje: number; nucleos: number; fuente: FuenteMedida }>;
  memoria: Medida<Consumo>;
  disco: Medida<{ usadoBytes: number; totalBytes: number; porcentaje: number; ruta: string }>;
  proceso: {
    uptimeSegundos: number;
    rssBytes: number;
    heapUsadoBytes: number;
    heapTotalBytes: number;
    versionNode: string;
    plataforma: string;
  };
  contenedor: boolean;
}

export type TipoAlerta = 'vencida' | 'por_vencer' | 'suspendida' | 'dormida';

export interface Cartera {
  total: number;
  porSuscripcion: Record<string, number>;
  porPlan: Record<string, number>;
  totalCuentas: number;
  porDepartamento: Array<{ departamento: string; instancias: number }>;
  alertas: Array<{ tipo: TipoAlerta; codigo: string; nombre: string; detalle: string }>;
}

export interface Uso {
  dias: number;
  serie: Array<{ dia: string; casos: number }>;
  totales: { casos: number; llamadas: number; mensajes: number; casosHoy: number };
  ranking: Array<{
    codigo: string; nombre: string;
    casos: number; llamadas: number; mensajes: number; cuentas: number;
  }>;
}

export interface Adopcion {
  dias: number;
  modulos: Array<{
    clave: string;
    nombre: string;
    contratado: number;
    enUso: number;
    ociosas: Array<{ codigo: string; nombre: string }>;
    sinConfigurar: Array<{ codigo: string; nombre: string }>;
  }>;
}

export type EntradaBitacoraGlobal = EntradaBitacora & { nombreTenant: string };

/** Consultas del monitor de plataforma; todas exigen superadmin en el backend. */
@Injectable({ providedIn: 'root' })
export class MonitorService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/plataforma`;

  salud(): Observable<Salud> {
    return this.http.get<Salud>(`${this.base}/salud`);
  }

  infraestructura(): Observable<Infraestructura> {
    return this.http.get<Infraestructura>(`${this.base}/infraestructura`);
  }

  cartera(): Observable<Cartera> {
    return this.http.get<Cartera>(`${this.base}/cartera`);
  }

  uso(): Observable<Uso> {
    return this.http.get<Uso>(`${this.base}/uso`);
  }

  adopcion(): Observable<Adopcion> {
    return this.http.get<Adopcion>(`${this.base}/adopcion`);
  }

  bitacora(limite = 50): Observable<EntradaBitacoraGlobal[]> {
    return this.http.get<EntradaBitacoraGlobal[]>(`${this.base}/bitacora`, { params: { limite } });
  }
}
