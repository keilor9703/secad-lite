import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Remisión de un caso a OTRA jurisdicción (otro tenant): la llamada llegó a
 * un municipio que no le corresponde. A diferencia de RemitirDto (canales
 * dentro del mismo tenant), acá el motivo es obligatorio: es la única
 * constancia legible de por qué un caso cruzó de instancia.
 */
export class RemitirTenantDto {
  /** Código del tenant destino (tenants.codigo). */
  @IsString() @MaxLength(64)
  tenantDestino!: string;

  @IsString() @MinLength(3) @MaxLength(1000)
  observacion!: string;
}
