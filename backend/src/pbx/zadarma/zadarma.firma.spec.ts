import { createHmac } from 'node:crypto';
import { cadenaFirmada, firmar, verificarFirma } from './zadarma.firma';

/**
 * La firma de Zadarma.
 *
 * Esto es lo único que autentica el webhook —la llave de la URL solo elige
 * instancia—, así que aquí no se prueba «que funcione»: se prueba que RECHACE.
 * Un verificador que acepta de más deja que cualquiera meta llamadas en la
 * cola del 123 con una petición HTTP.
 */
describe('firma de los webhooks de Zadarma', () => {
  const SECRETO = 'de4b346b835b86158233';
  const INICIO = {
    event: 'NOTIFY_START',
    caller_id: '573001234567',
    called_did: '576012345678',
    call_start: '2026-10-15 09:12:33',
    pbx_call_id: 'abc123',
  };

  it('es base64 del HEX del HMAC, no del binario', () => {
    // El error que cuesta una tarde: `base64_encode(hash_hmac(...))` en PHP
    // codifica el TEXTO hexadecimal, porque hash_hmac devuelve hex. Con el
    // digest binario no coincide nunca, y el síntoma —«Zadarma manda y FALCON
    // rechaza todo»— no se parece en nada a la causa.
    const cadena = 'hola';
    const hex = createHmac('sha1', SECRETO).update(cadena).digest('hex');
    const binario = createHmac('sha1', SECRETO).update(cadena).digest('base64');

    expect(firmar(cadena, SECRETO)).toBe(Buffer.from(hex, 'utf8').toString('base64'));
    expect(firmar(cadena, SECRETO)).not.toBe(binario);
  });

  it('acepta una firma correcta', () => {
    const firma = firmar('573001234567576012345678' + '2026-10-15 09:12:33', SECRETO);
    expect(verificarFirma(INICIO, firma, SECRETO)).toEqual({ ok: true });
  });

  describe('cada evento firma SU propia cadena', () => {
    const casos: Array<{ evento: string; cuerpo: Record<string, string>; cadena: string }> = [
      {
        evento: 'NOTIFY_START',
        cuerpo: { event: 'NOTIFY_START', caller_id: 'A', called_did: 'B', call_start: 'C' },
        cadena: 'ABC',
      },
      {
        evento: 'NOTIFY_INTERNAL',
        cuerpo: { event: 'NOTIFY_INTERNAL', caller_id: 'A', called_did: 'B', call_start: 'C', internal: '101' },
        cadena: 'ABC',
      },
      {
        // Ojo: ANSWER firma `destination`, no `called_did`. Si se copia la
        // fila de arriba, ese evento —y solo ese— se rechaza siempre, y la
        // llamada se queda sin saber quién contestó.
        evento: 'NOTIFY_ANSWER',
        cuerpo: { event: 'NOTIFY_ANSWER', caller_id: 'A', destination: 'D', call_start: 'C', called_did: 'B' },
        cadena: 'ADC',
      },
      {
        evento: 'NOTIFY_END',
        cuerpo: { event: 'NOTIFY_END', caller_id: 'A', called_did: 'B', call_start: 'C' },
        cadena: 'ABC',
      },
      {
        evento: 'NOTIFY_OUT_START',
        cuerpo: { event: 'NOTIFY_OUT_START', internal: '101', destination: 'D', call_start: 'C' },
        cadena: '101DC',
      },
      {
        evento: 'NOTIFY_RECORD',
        cuerpo: { event: 'NOTIFY_RECORD', pbx_call_id: 'P', call_id_with_rec: 'R' },
        cadena: 'PR',
      },
    ];

    for (const c of casos) {
      it(`${c.evento}`, () => {
        expect(cadenaFirmada(c.cuerpo)).toBe(c.cadena);
        expect(verificarFirma(c.cuerpo, firmar(c.cadena, SECRETO), SECRETO)).toEqual({ ok: true });
      });
    }
  });

  describe('rechaza', () => {
    const firmaBuena = firmar('573001234567576012345678' + '2026-10-15 09:12:33', SECRETO);

    it('una firma de otro secreto', () => {
      expect(verificarFirma(INICIO, firmar('x', 'otro-secreto'), SECRETO).ok).toBe(false);
    });

    it('un cuerpo alterado con la firma original', () => {
      // El ataque que importa: cambiar el número del llamante dejando la firma
      // de una llamada legítima que se vio pasar.
      const manipulado = { ...INICIO, caller_id: '573009999999' };
      expect(verificarFirma(manipulado, firmaBuena, SECRETO).ok).toBe(false);
    });

    it('una petición sin encabezado Signature', () => {
      expect(verificarFirma(INICIO, undefined, SECRETO).ok).toBe(false);
    });

    it('cuando la instancia no tiene secreto configurado', () => {
      // Sin secreto no se puede verificar nada, y «no puedo verificar» tiene
      // que significar «no paso», nunca «paso igual».
      expect(verificarFirma(INICIO, firmaBuena, '').ok).toBe(false);
    });

    it('un evento que no está en la tabla', () => {
      const r = verificarFirma({ event: 'NOTIFY_INVENTADO', caller_id: 'A' }, firmaBuena, SECRETO);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toContain('no reconocido');
    });

    it('una firma más corta, que es con lo que se tantea el largo', () => {
      expect(verificarFirma(INICIO, firmaBuena.slice(0, 10), SECRETO).ok).toBe(false);
    });

    it('un campo movido de lugar (A+B ≠ AB partido distinto)', () => {
      // Sin separador, «12»+«3» y «1»+«23» dan la misma cadena. Es una
      // debilidad del esquema de Zadarma, no nuestra, pero conviene tenerla
      // escrita: la firma NO prueba dónde empieza cada campo.
      const uno = { event: 'NOTIFY_START', caller_id: '12', called_did: '3', call_start: 'C' };
      const otro = { event: 'NOTIFY_START', caller_id: '1', called_did: '23', call_start: 'C' };
      expect(cadenaFirmada(uno)).toBe(cadenaFirmada(otro));
    });
  });

  it('un campo ausente cuenta como vacío, no revienta', () => {
    expect(cadenaFirmada({ event: 'NOTIFY_START', caller_id: 'A' })).toBe('A');
  });
});
