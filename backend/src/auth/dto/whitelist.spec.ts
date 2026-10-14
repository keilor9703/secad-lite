import { ValidationPipe } from '@nestjs/common';
import {
  CambiarContrasenaDto,
  EstablecerContrasenaDto,
  LoginDto,
  RecuperarDto,
} from './login.dto';

/**
 * El ValidationPipe global de `main.ts` corre con `whitelist: true`, y eso
 * **borra del cuerpo toda propiedad que no tenga un decorador de
 * class-validator**. Un DTO sin decoradores no da error al compilar, no da
 * error al arrancar y no da error en la petición: simplemente llega vacío.
 *
 * Así se rompieron dos endpoints recién hechos. El de activación respondía
 * «la contraseña debe tener al menos 8 caracteres» a una contraseña de
 * diecisiete, y dejaba la cuenta sin forma de entrar. El de recuperación no
 * hacía nada en absoluto, y como responde 204 siempre —a propósito, para no
 * revelar qué usuarios existen— nadie se habría enterado nunca.
 *
 * Las pruebas de servicio no pueden ver esto: llaman al método directo y el
 * pipe no existe en ese camino. Hay que ejercitar el borde HTTP.
 */
describe('los DTO sobreviven al whitelist del ValidationPipe', () => {
  // El MISMO pipe que construye main.ts. Si allí cambian las opciones, esta
  // prueba deja de representar la realidad: van juntas a propósito.
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  const casos: Array<{ nombre: string; metatype: new () => object; cuerpo: Record<string, unknown> }> = [
    { nombre: 'LoginDto', metatype: LoginDto, cuerpo: { usuario: 'jperez', contrasena: 'MiClaveLarga1' } },
    { nombre: 'CambiarContrasenaDto', metatype: CambiarContrasenaDto, cuerpo: { actual: 'vieja123', nueva: 'MiClaveLarga1' } },
    { nombre: 'RecuperarDto', metatype: RecuperarDto, cuerpo: { usuario: 'jperez' } },
    { nombre: 'EstablecerContrasenaDto', metatype: EstablecerContrasenaDto, cuerpo: { contrasena: 'MiClaveLarga1' } },
  ];

  for (const c of casos) {
    it(`${c.nombre}: no pierde ningún campo`, async () => {
      const salida = await pipe.transform(c.cuerpo, { type: 'body', metatype: c.metatype });
      // Comparación del objeto entero: si falta un campo, el diff lo nombra —
      // y el campo que falte es, siempre, uno al que le falta el decorador.
      expect({ ...(salida as object) }).toEqual(c.cuerpo);
    });
  }

  it('y sigue descartando lo que nadie declaró', async () => {
    // La otra mitad del trato: el whitelist tiene que seguir haciendo su
    // trabajo, o esta prueba se estaría «pasando» aflojando la seguridad.
    const salida = await pipe.transform(
      { usuario: 'jperez', contrasena: 'MiClaveLarga1', rol: 'superadmin' },
      { type: 'body', metatype: LoginDto },
    );
    expect((salida as Record<string, unknown>).rol).toBeUndefined();
  });
});
