import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * NUESTRAS CENTRALITAS — el cliente de la API de provisionamiento.
 *
 * Es la contraparte de `plataforma/planta` del backend. Nada de telefonía se
 * decide aquí: la pantalla pide, muestra lo que el servidor dice que falta y
 * enseña los archivos que el servidor generó. Toda la lógica —qué puertos,
 * qué archivos, qué le falta— vive en un solo sitio, y ese sitio es el
 * servidor, porque es el que puede garantizar que dos municipios no se pisen.
 */

export type EstadoPlanta = 'borrador' | 'provisionada' | 'activa' | 'suspendida';
export type AutenticacionTroncal = 'ip' | 'registro' | 'digest';
export type TipoNumero = 'did' | 'corto';

export interface TroncalVisible {
  id: string;
  nombre: string;
  proveedor: string;
  servidor: string;
  puerto: number;
  autenticacion: AutenticacionTroncal;
  usuario: string | null;
  /** Un sí o un no. La clave nunca viaja al navegador, ni truncada. */
  clavePuesta: boolean;
  redes: string[];
  canales: number;
  prioridad: number;
  activa: boolean;
}

export interface NumeroVisible {
  id: string;
  numero: string;
  tipo: TipoNumero;
  troncalId: string | null;
  destino: string;
  descripcion: string | null;
  activo: boolean;
}

/** Qué se encontró mal en una revisión. Vacío = todo bien. */
export type FallaPlanta =
  | 'asterisk'
  | 'troncal'
  /** No se puede sondear: no es lo mismo que estar caída. */
  | 'troncal-sin-sondeo'
  | 'certificado'
  | 'certificado-vencido';

/** Lo que devuelve una revisión forzada desde la pantalla. */
export interface RevisionPlanta {
  tenant: string;
  bien: boolean;
  fallas: FallaPlanta[];
  version: string | null;
  operadores: number;
  certificadoVence: string | null;
  detalle: string;
}

/** La última revisión guardada, con desde cuándo falla. */
export interface SaludPlanta extends RevisionPlanta {
  /** Desde cuándo falla sin interrupción. Lo que distingue dos minutos de dos días. */
  fallaDesde: string | null;
  revisadoEn: string;
}

export interface PlantaVisible {
  tenant: string;
  servidor: string;
  ipPublica: string;
  /** Por dónde alcanza nginx a esta planta; `127.0.0.1` si no se fijó otra. */
  ipInterna: string;
  /** La IP de la interfaz real del servidor; vacía si no se declaró. */
  ipPrivada: string;
  /** A dónde va la llamada si nadie contesta. Vacío = se cae. */
  numeroDesborde: string;
  /** Segundos que timbra en la sala antes de desbordar. */
  segundosEnCola: number;
  dominioSip: string;
  contenedor: string;
  puertoSip: number;
  rtpDesde: number;
  rtpHasta: number;
  puertoHttp: number;
  estado: EstadoPlanta;
  notas: string | null;
  wss: string;
  ari: string;
  troncales: TroncalVisible[];
  numeros: NumeroVisible[];
  operadores: number;
  operadoresConClave: number;
  /** Lo que le falta para atender una llamada, en orden de resolución. */
  faltan: string[];
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

export interface ArchivoPlanta {
  ruta: string;
  contenido: string;
  modo: string;
  secreto: boolean;
}

export interface ConfiguracionPlanta {
  tenant: string;
  carpeta: string;
  archivos: ArchivoPlanta[];
  advertencias: string[];
  previa: boolean;
}

export interface CrearPlanta {
  tenant: string;
  servidor: string;
  ipPublica?: string | null;
  ipInterna?: string | null;
  ipPrivada?: string | null;
  numeroDesborde?: string | null;
  segundosEnCola?: number | null;
  dominioSip?: string | null;
  notas?: string | null;
}

export interface ActualizarPlanta {
  servidor?: string;
  ipPublica?: string | null;
  ipInterna?: string | null;
  ipPrivada?: string | null;
  numeroDesborde?: string | null;
  segundosEnCola?: number | null;
  dominioSip?: string | null;
  notas?: string | null;
  estado?: EstadoPlanta;
  puertoSip?: number;
  rtpDesde?: number;
  rtpHasta?: number;
  puertoHttp?: number;
}

export interface GuardarTroncal {
  id?: string;
  nombre?: string;
  proveedor?: string;
  servidor?: string;
  puerto?: number;
  autenticacion?: AutenticacionTroncal;
  usuario?: string | null;
  /** Solo de escritura: si no se manda, el servidor conserva la guardada. */
  clave?: string | null;
  redes?: string | null;
  canales?: number;
  prioridad?: number;
  activa?: boolean;
}

export interface GuardarNumero {
  id?: string;
  numero?: string;
  tipo?: TipoNumero;
  troncalId?: string | null;
  destino?: string | null;
  descripcion?: string | null;
  activo?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PlantaService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/plataforma/planta`;

  listar(): Observable<PlantaVisible[]> {
    return this.http.get<PlantaVisible[]>(this.base);
  }

  crear(dto: CrearPlanta): Observable<PlantaVisible> {
    return this.http.post<PlantaVisible>(this.base, dto);
  }

  actualizar(tenant: string, dto: ActualizarPlanta): Observable<PlantaVisible> {
    return this.http.post<PlantaVisible>(`${this.base}/${tenant}`, dto);
  }

  eliminar(tenant: string): Observable<{ tenant: string }> {
    return this.http.delete<{ tenant: string }>(`${this.base}/${tenant}`);
  }

  /** Los archivos como van a quedar, con los secretos sustituidos. No rota nada. */
  /** La última revisión automática. Puede no haber ninguna todavía. */
  salud(tenant: string): Observable<SaludPlanta | null> {
    return this.http.get<SaludPlanta | null>(`${this.base}/${tenant}/salud`);
  }

  /**
   * Revisa la planta AHORA.
   *
   * Es lo que evita el «entre por SSH y mire»: después de tocar algo en el
   * servidor, dice en dos segundos si quedó bien. No cambia nada en la planta.
   */
  revisar(tenant: string): Observable<RevisionPlanta> {
    return this.http.post<RevisionPlanta>(`${this.base}/${tenant}/revisar`, {});
  }

  previa(tenant: string): Observable<ConfiguracionPlanta> {
    return this.http.get<ConfiguracionPlanta>(`${this.base}/${tenant}/previa`);
  }

  /**
   * Los archivos de verdad. OJO: renueva la API key de la instancia, así que
   * la central vieja deja de poder avisar hasta que queden instalados. La
   * pantalla lo confirma antes de llamar aquí.
   */
  aplicar(tenant: string): Observable<ConfiguracionPlanta> {
    return this.http.post<ConfiguracionPlanta>(`${this.base}/${tenant}/aplicar`, {});
  }

  guardarTroncal(tenant: string, dto: GuardarTroncal): Observable<TroncalVisible> {
    return this.http.post<TroncalVisible>(`${this.base}/${tenant}/troncal`, dto);
  }

  eliminarTroncal(tenant: string, id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`${this.base}/${tenant}/troncal/${id}`);
  }

  guardarNumero(tenant: string, dto: GuardarNumero): Observable<NumeroVisible> {
    return this.http.post<NumeroVisible>(`${this.base}/${tenant}/numero`, dto);
  }

  eliminarNumero(tenant: string, id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`${this.base}/${tenant}/numero/${id}`);
  }
}
