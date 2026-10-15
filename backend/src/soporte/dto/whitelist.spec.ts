import { ValidationPipe } from '@nestjs/common';
import { TicketDto } from './ticket.dto';

/**
 * Misma trampa que vigila `src/auth/dto/whitelist.spec.ts`: el ValidationPipe
 * global corre con `whitelist: true` y **borra toda propiedad sin decorador**,
 * sin error al compilar, sin error al arrancar y sin error en la petición.
 *
 * Aquí el daño sería un ticket que llega a la mesa con el relato vacío —el
 * campo que hace útil el reporte— o sin el contexto técnico, que es lo que
 * evita que la mesa empiece preguntando contra qué versión se trabaja.
 */
describe('TicketDto sobrevive al whitelist del ValidationPipe', () => {
  // El MISMO pipe que construye main.ts: van juntos a propósito.
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const cuerpo = {
    severidad: 'S2',
    relato: 'La videollamada no conecta con el ciudadano.',
    contexto: '── contexto ──\nVersión 2ee819c',
    pantalla: '/despacho',
  };

  it('no pierde ningún campo', async () => {
    const salida = await pipe.transform(cuerpo, { type: 'body', metatype: TicketDto });
    expect({ ...(salida as object) }).toEqual(cuerpo);
  });

  it('`pantalla` es opcional: un bundle viejo en caché sigue pudiendo reportar', async () => {
    const { pantalla, ...sinPantalla } = cuerpo;
    const salida = await pipe.transform(sinPantalla, { type: 'body', metatype: TicketDto });
    expect({ ...(salida as object) }).toEqual(sinPantalla);
  });

  it('y sigue descartando lo que nadie declaró', async () => {
    // La otra mitad del trato. Y una en concreto: el correo del acuse NO puede
    // venir en la petición —sale de la cuenta autenticada— o el endpoint sería
    // una forma de mandar correo con el membrete de FALCON CAD a donde se
    // quiera. Si alguien agrega el campo al DTO, esta prueba se cae.
    const salida = (await pipe.transform(
      { ...cuerpo, correo: 'otro@example.com', para: 'otro@example.com' },
      { type: 'body', metatype: TicketDto },
    )) as Record<string, unknown>;
    expect(salida.correo).toBeUndefined();
    expect(salida.para).toBeUndefined();
  });

  it('rechaza una severidad fuera de la escala y un relato de dos letras', async () => {
    await expect(pipe.transform({ ...cuerpo, severidad: 'S9' }, { type: 'body', metatype: TicketDto }))
      .rejects.toThrow();
    await expect(pipe.transform({ ...cuerpo, relato: 'no' }, { type: 'body', metatype: TicketDto }))
      .rejects.toThrow();
  });

  it('rechaza un contexto desmedido: el endpoint manda correos, no archivos', async () => {
    await expect(pipe.transform(
      { ...cuerpo, contexto: 'x'.repeat(20_001) },
      { type: 'body', metatype: TicketDto },
    )).rejects.toThrow();
  });
});
