import { IsString, MaxLength } from 'class-validator';

export class AgregarNotaDto {
  @IsString() @MaxLength(1000)
  texto!: string;
}
