import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Sesion } from './models';

/** Lo que devuelve el login cuando falta el segundo factor. */
export interface RetoMfa {
  requiereMfa: true;
  /** true = el usuario todavía no ha vinculado una aplicación. */
  inscripcion: boolean;
  /** Token efímero que acredita que usuario y contraseña ya se validaron. */
  reto: string;
  nombre: string;
}

export interface InicioInscripcion {
  otpauth: string;
  claveManual: string;
  inscripcion: string;
}

/** ¿Esta respuesta del login es un reto de doble factor o ya es la sesión? */
export function esRetoMfa(r: Sesion | RetoMfa): r is RetoMfa {
  return (r as RetoMfa)?.requiereMfa === true;
}

/**
 * Doble factor en el inicio de sesión.
 *
 * Nada de aquí guarda sesión: de eso se encarga AuthService cuando el código
 * se verifica y el servidor entrega por fin el token.
 */
@Injectable({ providedIn: 'root' })
export class MfaService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  iniciarInscripcion(reto: string): Promise<InicioInscripcion> {
    return firstValueFrom(
      this.http.post<InicioInscripcion>(`${this.base}/auth/mfa/inscripcion`, { reto }),
    );
  }

  confirmarInscripcion(reto: string, inscripcion: string, codigo: string): Promise<Sesion> {
    return firstValueFrom(
      this.http.post<Sesion>(`${this.base}/auth/mfa/confirmar`, { reto, inscripcion, codigo }),
    );
  }

  verificar(reto: string, codigo: string): Promise<Sesion> {
    return firstValueFrom(
      this.http.post<Sesion>(`${this.base}/auth/mfa/verificar`, { reto, codigo }),
    );
  }
}
