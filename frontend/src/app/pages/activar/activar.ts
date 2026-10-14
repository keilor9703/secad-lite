import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { LogoComponent } from '../../shared/logo/logo';

/**
 * Elegir la contraseña propia con un enlace de un solo uso.
 *
 * Es la única página de FALCON a la que se llega sin sesión y sin que nadie
 * la enlace desde la aplicación: se abre desde el correo. Por eso vive fuera
 * del layout autenticado, igual que la página del ciudadano.
 *
 * El enlace acredita a quien lo trae: solo pudo llegar al buzón de esa
 * persona. Al usarlo, la dirección queda verificada — que es lo que la
 * convierte después en su identidad en la mesa de ayuda.
 */
interface DatosEnlace {
  usuario: string;
  nombre: string;
  tipo: 'invitacion' | 'recuperacion';
}

@Component({
  selector: 'app-activar',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  templateUrl: './activar.html',
  styleUrl: './activar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivarComponent implements OnInit {
  private http = inject(HttpClient);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly base = environment.apiBaseUrl;

  readonly cargando = signal(true);
  /** Null mientras carga; false cuando el enlace no sirve. */
  readonly datos = signal<DatosEnlace | null>(null);
  readonly enlaceMuerto = signal(false);
  readonly guardando = signal(false);
  readonly listo = signal(false);

  readonly clave = signal('');
  readonly confirma = signal('');
  readonly verClave = signal(false);
  readonly error = signal('');

  /** Mínimo del backend. Se valida aquí para no gastarle un viaje a la persona. */
  readonly corta = computed(() => this.clave().length > 0 && this.clave().length < 8);
  readonly noCoincide = computed(() => this.confirma().length > 0 && this.clave() !== this.confirma());
  readonly puedeGuardar = computed(
    () => this.clave().length >= 8 && this.clave() === this.confirma() && !this.guardando(),
  );

  readonly titulo = computed(() =>
    this.datos()?.tipo === 'recuperacion' ? 'Elija una contraseña nueva' : 'Bienvenido a FALCON CAD',
  );

  private get token(): string {
    return this.ruta.snapshot.paramMap.get('token') ?? '';
  }

  ngOnInit(): void {
    // Se valida ANTES de pedir nada: hacer que alguien escriba una contraseña
    // dos veces para después decirle que el enlace venció es maltrato.
    this.http.get<DatosEnlace>(`${this.base}/auth/activacion/${this.token}`).subscribe({
      next: (d) => { this.datos.set(d); this.cargando.set(false); },
      error: () => { this.enlaceMuerto.set(true); this.cargando.set(false); },
    });
  }

  guardar(ev?: Event): void {
    // El formulario se envía por el evento nativo: hay que impedir que el
    // navegador recargue la página antes de que la petición salga.
    ev?.preventDefault();
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    this.error.set('');
    this.http.post<{ ok: boolean }>(`${this.base}/auth/activacion/${this.token}`, { contrasena: this.clave() })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.listo.set(true);
          // No se inicia sesión sola: que la persona entre con su contraseña
          // recién puesta confirma que la recuerda, y si tiene doble factor
          // el camino es el mismo de siempre.
          setTimeout(() => this.router.navigate(['/login']), 2500);
        },
        error: (e) => {
          this.guardando.set(false);
          const msg = e?.error?.message;
          this.error.set(typeof msg === 'string' && msg ? msg : 'No se pudo guardar la contraseña.');
          // Un enlace consumido entre la carga y el envío deja de servir.
          if (e?.status === 404) this.enlaceMuerto.set(true);
        },
      });
  }
}
