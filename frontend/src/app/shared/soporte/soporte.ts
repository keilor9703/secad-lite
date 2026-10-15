import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DiagnosticoService, InformeDiagnostico } from '../../core/diagnostico.service';
import { RespuestaTicket, SoporteService } from '../../core/soporte.service';
import { ToastService } from '../toast/toast.service';

/**
 * Reportar un problema a la mesa de ayuda desde dentro del sistema.
 *
 * Por qué desde dentro y no con un correo: el reporte que escribe una persona
 * en medio de un turno dice "no me funciona". El que sale de aquí dice además
 * quién, en qué instancia, con qué versión, en qué pantalla y qué se rompió
 * hace un minuto — y eso es la diferencia entre atender el caso y empezar
 * averiguando contra qué se está trabajando.
 *
 * Dos decisiones que no son de forma:
 *
 *  1. El contexto técnico se muestra COMPLETO antes de enviarlo. Lleva el
 *     nombre del usuario y la pantalla en que estaba: eso lo autoriza quien
 *     reporta, viéndolo, no una casilla que nadie leyó.
 *
 *  2. La severidad la propone quien reporta y la confirma la mesa. Por eso
 *     cada opción muestra el compromiso de respuesta que implica: elegir
 *     "la operación está detenida" para un reporte mal exportado deja de ser
 *     gratis cuando al lado dice "respuesta en 15 minutos, 24/7".
 *
 *  3. El reporte se MANDA, y si no se puede mandar se dice. Lo recibe
 *     `POST /api/soporte/ticket`, que lo reparte por correo a la mesa y al
 *     buzón de quien reportó, con un número para nombrarlo por teléfono.
 *     Cuando el envío falla —el proveedor de correo caído, la red del puesto—
 *     no se finge: se explica, y siguen ahí copiar y descargar, que es como
 *     se hacía antes de que existiera el envío.
 */

export type Severidad = 'S1' | 'S2' | 'S3' | 'S4';

interface OpcionSeveridad {
  id: Severidad;
  titulo: string;
  ejemplo: string;
  respuesta: string;
}

@Component({
  selector: 'app-soporte',
  standalone: true,
  templateUrl: './soporte.html',
  styleUrl: './soporte.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SoporteComponent implements OnInit {
  private diag = inject(DiagnosticoService);
  private api = inject(SoporteService);
  private toast = inject(ToastService);

  readonly cerrar = output<void>();

  readonly severidades: OpcionSeveridad[] = [
    {
      id: 'S1',
      titulo: 'La operación está detenida',
      ejemplo: 'No se puede crear un caso · el despacho no responde · no entra ninguna llamada.',
      respuesta: 'Respuesta en 15 minutos, a cualquier hora',
    },
    {
      id: 'S2',
      titulo: 'Funciona, pero mal',
      ejemplo: 'La videollamada no conecta · el mapa no carga · un canal caído · lentitud general.',
      respuesta: 'Respuesta en 1 hora dentro del horario',
    },
    {
      id: 'S3',
      titulo: 'Falla algo que no frena la operación',
      ejemplo: 'Un reporte sale con datos malos · un catálogo no guarda · un permiso mal asignado.',
      respuesta: 'Respuesta el siguiente día hábil',
    },
    {
      id: 'S4',
      titulo: 'Petición, duda o mejora',
      ejemplo: 'Cómo se hace algo · crear un usuario · agregar un tipo de caso.',
      respuesta: 'Respuesta en 2 días hábiles',
    },
  ];

  readonly severidad = signal<Severidad>('S3');
  readonly relato = signal('');
  readonly contextoVisible = signal(false);
  /** El informe se arma al abrir: así refleja el momento del problema, no el del clic. */
  readonly informe = signal<InformeDiagnostico | null>(null);
  readonly contexto = signal('');

  /** En curso el envío: bloquea el botón para no abrir dos reportes del mismo problema. */
  readonly enviando = signal(false);
  /** Lo que respondió el servidor. Con esto en mano, el diálogo muestra el número. */
  readonly ticket = signal<RespuestaTicket | null>(null);
  /** Por qué no salió. Mientras tenga texto, se ofrecen copiar y descargar. */
  readonly fallo = signal('');

  readonly esCritico = computed(() => this.severidad() === 'S1');
  readonly listo = computed(() => this.relato().trim().length >= 10 && !!this.contexto());
  /** El compromiso de la severidad elegida, para repetirlo al confirmar. */
  readonly compromiso = computed(
    () => this.severidades.find((s) => s.id === this.severidad())?.respuesta ?? '',
  );

  ngOnInit(): void {
    // Se arma UNA vez, al abrir. Hacerlo al pulsar "copiar" obligaría a
    // esperar una petición dentro del gesto del usuario, y el portapapeles del
    // navegador deja de concederse cuando el gesto ya pasó.
    this.diag.armar().then((i) => {
      this.informe.set(i);
      this.contexto.set(this.diag.comoTexto(i));
    });
  }

  /** El reporte entero: lo que escribió la persona, y debajo el contexto. */
  reporte(): string {
    const s = this.severidades.find((x) => x.id === this.severidad());
    return [
      `FALCON CAD · reporte de soporte`,
      `Severidad: ${s?.id} — ${s?.titulo}`,
      '',
      this.relato().trim(),
      '',
      this.contexto(),
    ].join('\n');
  }

  /**
   * Manda el reporte. No lanza: cualquier fallo termina en `fallo()` con una
   * frase que dice qué hacer, porque quien está aquí ya tiene un problema y el
   * segundo no puede ser que el botón no explique nada.
   */
  async enviar(): Promise<void> {
    if (!this.listo() || this.enviando()) return;
    this.enviando.set(true);
    this.fallo.set('');
    try {
      const r = await this.api.abrirTicket({
        severidad: this.severidad(),
        relato: this.relato().trim(),
        contexto: this.contexto(),
        pantalla: this.informe()?.donde.ruta ?? '',
      });
      if (!r.enviado) {
        // El servidor contestó, pero el correo no salió: el reporte NO está en
        // la mesa. Decirlo es lo único honesto, y el respaldo queda a la vista.
        this.fallo.set(
          'El servidor no pudo enviar el correo a la mesa de ayuda'
          + (r.error ? ` (${r.error})` : '')
          + '. Copie o descargue el reporte y mándelo por otro medio.',
        );
        return;
      }
      this.ticket.set(r);
    } catch (e) {
      this.fallo.set(this.porQue(e));
    } finally {
      this.enviando.set(false);
    }
  }

  /** El número, al portapapeles: se dicta por teléfono y se pega en un mensaje. */
  async copiarId(): Promise<void> {
    const id = this.ticket()?.id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.toast.exito(`Número ${id} copiado.`);
    } catch {
      this.toast.advertencia('El navegador no permitió copiar. Anote el número que aparece en pantalla.');
    }
  }

  /**
   * Qué decirle a la persona según lo que respondió —o no respondió— el
   * servidor. El interceptor global no muestra toast para esta ruta
   * (`SILENCIOSAS` en error-toast.interceptor.ts) justamente para que el
   * mensaje sea este y no un «ocurrió un error» encima del respaldo.
   */
  private porQue(e: unknown): string {
    const err = e as HttpErrorResponse;
    const fin = ' Copie o descargue el reporte y mándelo por otro medio.';
    switch (err?.status) {
      case 0:
        return 'No hubo conexión con el servidor, así que el reporte no salió.' + fin;
      case 429:
        return 'Ya salieron varios reportes desde este punto en los últimos minutos. '
          + 'Espere unos minutos antes de mandar otro.' + fin;
      case 401:
        // Para esta ruta el interceptor tampoco cierra la sesión ni navega al
        // login, y aquí eso es lo que conviene: botar la pantalla se llevaría
        // el relato que la persona acaba de escribir. Se avisa y se le da la
        // oportunidad de salvarlo antes de volver a entrar.
        return 'La sesión expiró y el reporte no salió. Copie o descargue el reporte ahora: '
          + 'al volver a iniciar sesión, este texto se pierde.';
      default:
        return 'El servidor no aceptó el reporte'
          + (err?.status ? ` (HTTP ${err.status})` : '') + '.' + fin;
    }
  }

  async copiar(): Promise<void> {
    const texto = this.reporte();
    try {
      await navigator.clipboard.writeText(texto);
      this.toast.exito('Reporte copiado. Péguelo en el correo o el mensaje a la mesa de ayuda.');
      this.cerrar.emit();
    } catch {
      // Sin permiso de portapapeles (o navegador viejo) el reporte no se
      // pierde: se deja a la vista y seleccionado para copiarlo a mano.
      this.contextoVisible.set(true);
      this.toast.advertencia('El navegador no permitió copiar. Seleccione el texto de abajo y cópielo.');
    }
  }

  descargar(): void {
    const nombre = `falcon-soporte-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    const url = URL.createObjectURL(new Blob([this.reporte()], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.exito('Reporte descargado. Adjúntelo al correo a la mesa de ayuda.');
    this.cerrar.emit();
  }
}
