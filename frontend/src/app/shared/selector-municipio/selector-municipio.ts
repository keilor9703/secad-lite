import { ChangeDetectionStrategy, Component, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Departamento, GeografiaService, Municipio } from '../../core/geografia.service';

/**
 * Departamento -> municipio de Colombia, como un solo control de formulario
 * reactivo (`formControlName`): el valor que entra/sale es el código DANE
 * del MUNICIPIO (5 dígitos) — el departamento es un paso intermedio para
 * llegar a él, no algo que el formulario dueño necesite guardar aparte (el
 * backend lo deriva del código de municipio).
 *
 * Al recibir un valor inicial (`writeValue`, p. ej. el municipio ya guardado
 * de un tenant) deriva el departamento de los primeros 2 dígitos del código
 * y precarga su lista de municipios, para que ambos selects arranquen ya
 * posicionados.
 */
@Component({
  selector: 'app-selector-municipio',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './selector-municipio.html',
  styleUrl: './selector-municipio.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectorMunicipioComponent), multi: true },
  ],
})
export class SelectorMunicipioComponent implements ControlValueAccessor {
  private geografia = inject(GeografiaService);

  readonly departamentos = signal<Departamento[]>([]);
  readonly municipios = signal<Municipio[]>([]);
  readonly departamentoSel = signal<string>('');
  readonly municipioSel = signal<string>('');
  readonly deshabilitado = signal(false);

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.geografia.departamentos().subscribe((d) => this.departamentos.set(d));
  }

  writeValue(codigoDane: string | null): void {
    if (!codigoDane) {
      this.departamentoSel.set('');
      this.municipioSel.set('');
      this.municipios.set([]);
      return;
    }
    const depto = codigoDane.slice(0, 2);
    this.departamentoSel.set(depto);
    this.cargarMunicipios(depto, codigoDane);
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }

  private cargarMunicipios(departamentoCodigo: string, seleccionar: string | null): void {
    this.geografia.municipios(departamentoCodigo).subscribe((m) => {
      this.municipios.set(m);
      if (seleccionar && m.some((x) => x.codigoDane === seleccionar)) {
        this.municipioSel.set(seleccionar);
      }
    });
  }

  cambiarDepartamento(codigo: string): void {
    this.departamentoSel.set(codigo);
    this.municipioSel.set('');
    this.municipios.set([]);
    this.onChange(null);
    this.onTouched();
    if (codigo) this.cargarMunicipios(codigo, null);
  }

  cambiarMunicipio(codigo: string): void {
    this.municipioSel.set(codigo);
    this.onChange(codigo || null);
    this.onTouched();
  }

  /** Subregión del municipio elegido, si el catálogo la trae (solo Antioquia por ahora) — solo para mostrarla, de lectura. */
  subregionSel(): string | null {
    return this.municipios().find((m) => m.codigoDane === this.municipioSel())?.subregion ?? null;
  }
}
