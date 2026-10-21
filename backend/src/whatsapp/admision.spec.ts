import {
  esRuido, menuDeTipos, opcionElegida, palabras, textoDelMenu, ubicacionDe, MAX_OPCIONES,
} from './admision';

/**
 * EL FILTRO DE UNA LÍNEA 123.
 *
 * Un falso positivo es un caso de más: molesto, se cierra en diez segundos.
 * Un falso negativo es una emergencia descartada en silencio. No son
 * comparables, y estas pruebas están escritas con ese peso: la mayoría
 * comprueba que algo NO se descarta.
 */
describe('Admisión de WhatsApp · qué es ruido y qué no', () => {
  describe('ruido de verdad', () => {
    // Mensajes reales recibidos en la línea el 21/10/2026, antes de que
    // existiera el filtro. Los cuatro abrieron caso.
    const saludos = [
      'Holaaa', 'Holaaaaa', 'Hola buenas', 'Hola buenas noches',
      'buenas noches', 'Buenos días', 'ola', 'alo', 'hey', 'Saludos',
      'ok', 'Listo', 'Gracias', 'muchas gracias', 'si', 'No',
      'prueba', 'test',
    ];

    for (const s of saludos) {
      it(`«${s}» no abre caso`, () => {
        expect(esRuido(s)).toBe(true);
      });
    }

    it('un sticker o un emoji suelto tampoco', () => {
      expect(esRuido('👍')).toBe(true);
      expect(esRuido('😀😀😀')).toBe(true);
    });

    it('signos sueltos tampoco', () => {
      expect(esRuido('?')).toBe(true);
      expect(esRuido('...')).toBe(true);
      expect(esRuido('')).toBe(true);
    });
  });

  describe('lo que SÍ abre caso, que es lo que importa', () => {
    const emergencias = [
      'se está incendiando una casa en la 50 con 70',
      'fuego',
      'auxilio',
      'ayuda',
      'socorro',
      'me están robando',
      'hay un herido',
      'accidente',
      // Cortesía + petición: el «porfavor» es la petición.
      'Buenas noches porfavor',
      'hola necesito ayuda',
      'buenas, me están golpeando',
      // Mal escrito, con prisa, sin tildes: sigue siendo una emergencia.
      'aiuda mi papa se desmayo',
      'ay un incendio',
      // Una dirección suelta puede ser todo lo que alcanzó a escribir.
      'calle 50 numero 70-20',
    ];

    for (const e of emergencias) {
      it(`«${e}» abre caso`, () => {
        expect(esRuido(e)).toBe(false);
      });
    }

    it('una palabra desconocida basta, aunque el resto sea saludo', () => {
      // Es la regla entera del filtro: la lista de ruido es CERRADA. Lo que
      // no está en ella no se descarta.
      expect(esRuido('hola buenas tardes disparos')).toBe(false);
    });
  });

  describe('normalización', () => {
    it('las letras alargadas se colapsan: así escribe la gente', () => {
      expect(palabras('holaaaa')).toEqual(['hola']);
      expect(palabras('siiiii')).toEqual(['si']);
    });

    it('pero una letra doble normal NO se toca', () => {
      // Aplastar «carro» a «caro» cambiaría el texto de verdad.
      expect(palabras('carro arroz')).toEqual(['carro', 'arroz']);
    });

    it('las tildes no cambian nada', () => {
      expect(esRuido('Buenos días')).toBe(true);
      expect(esRuido('buenos dias')).toBe(true);
    });
  });
});

describe('Admisión de WhatsApp · el menú de tipificación', () => {
  const catalogo = [
    { codigo: 'RIN', descripcion: 'Riña o agresión' },
    { codigo: 'INC', descripcion: 'Incendio' },
    { codigo: 'ACC', descripcion: 'Accidente de tránsito' },
  ];

  it('sale del catálogo del municipio, no de una lista fija', () => {
    const ops = menuDeTipos(catalogo);
    expect(ops[0]).toEqual({ numero: 1, codigo: 'RIN', descripcion: 'Riña o agresión' });
    expect(ops[1].codigo).toBe('INC');
  });

  it('siempre termina en «otra»: el catálogo no cubre la calle entera', () => {
    const ops = menuDeTipos(catalogo);
    const ultima = ops[ops.length - 1];
    expect(ultima.codigo).toBeNull();
    expect(ultima.descripcion).toContain('Otra');
  });

  it('un catálogo enorme se recorta, pero «otra» sobrevive', () => {
    // Un menú de treinta opciones en un móvil no se lee; y si «otra»
    // desapareciera, el ciudadano se quedaría sin forma de seguir.
    const enorme = Array.from({ length: 30 }, (_, i) => ({
      codigo: `C${i}`, descripcion: `Tipo ${i}`,
    }));
    const ops = menuDeTipos(enorme);

    expect(ops.length).toBe(MAX_OPCIONES + 1);
    expect(ops[ops.length - 1].codigo).toBeNull();
  });

  it('un catálogo vacío deja solo «otra», y no revienta', () => {
    const ops = menuDeTipos([]);
    expect(ops.length).toBe(1);
    expect(ops[0].numero).toBe(1);
  });

  it('el texto del menú lleva los números que se van a teclear', () => {
    const t = textoDelMenu(menuDeTipos(catalogo));
    expect(t).toContain('1. Riña o agresión');
    expect(t).toContain('2. Incendio');
    expect(t).toContain('4. Otra cosa');
  });
});

describe('Admisión de WhatsApp · leer la respuesta al menú', () => {
  const ops = menuDeTipos([
    { codigo: 'RIN', descripcion: 'Riña' },
    { codigo: 'INC', descripcion: 'Incendio' },
  ]);

  it('un número suelto es una elección', () => {
    expect(opcionElegida('2', ops)?.codigo).toBe('INC');
    expect(opcionElegida(' 1 ', ops)?.codigo).toBe('RIN');
    expect(opcionElegida('1.', ops)?.codigo).toBe('RIN');
    expect(opcionElegida('2)', ops)?.codigo).toBe('INC');
  });

  it('un número DENTRO de una frase NO es una elección', () => {
    // Es el error que más caro sale: «hay 2 heridos en la calle 50» no es
    // elegir la opción 2. Tipificaría un caso con heridos como otra cosa, y
    // la prioridad saldría del código equivocado.
    expect(opcionElegida('hay 2 heridos en la calle 50', ops)).toBeNull();
    expect(opcionElegida('2 personas heridas', ops)).toBeNull();
    expect(opcionElegida('calle 50 numero 2', ops)).toBeNull();
  });

  it('un número fuera del menú no elige nada', () => {
    expect(opcionElegida('9', ops)).toBeNull();
    expect(opcionElegida('0', ops)).toBeNull();
  });

  it('«otra» se puede elegir como cualquier otra', () => {
    expect(opcionElegida('3', ops)?.codigo).toBeNull();
    expect(opcionElegida('3', ops)?.numero).toBe(3);
  });
});

describe('Admisión de WhatsApp · la ubicación del ciudadano', () => {
  it('unas coordenadas normales se leen', () => {
    const u = ubicacionDe({ type: 'LOCATION', latitude: 6.1845, longitude: -75.5986 });
    expect(u).toEqual({ lat: 6.1845, lng: -75.5986 });
  });

  it('la dirección que resuelve WhatsApp viene con ellas', () => {
    const u = ubicacionDe({
      latitude: 6.1845, longitude: -75.5986,
      name: 'Parque de Itagüí', address: 'Cra 51 #51-55',
    });
    expect(u!.direccion).toContain('Parque de Itagüí');
    expect(u!.direccion).toContain('Cra 51');
  });

  describe('lo que NO se guarda', () => {
    it('«0, 0» se rechaza: es el golfo de Guinea, no una emergencia', () => {
      // Un campo ausente o ilegible se vuelve cero sin que nada falle, y 0,0
      // es un punto real en el Atlántico. Guardarlo mandaría una patrulla
      // allá y, peor, haría creer al despachador que tiene la ubicación —
      // dejaría de preguntarla. No tenerla es recuperable; tener una falsa
      // que parece buena, no.
      expect(ubicacionDe({ latitude: 0, longitude: 0 })).toBeNull();
      expect(ubicacionDe({})).toBeNull();
      expect(ubicacionDe({ latitude: 'x', longitude: 'y' })).toBeNull();
      expect(ubicacionDe(null)).toBeNull();
    });

    it('una coordenada fuera del planeta se rechaza', () => {
      expect(ubicacionDe({ latitude: 91, longitude: 0 })).toBeNull();
      expect(ubicacionDe({ latitude: 0, longitude: 181 })).toBeNull();
    });

    it('pero una coordenada con UN cero sí vale', () => {
      // El ecuador y el meridiano existen. Solo se rechaza el par completo.
      expect(ubicacionDe({ latitude: 0, longitude: -75.5 })).toEqual({ lat: 0, lng: -75.5 });
      expect(ubicacionDe({ latitude: 6.18, longitude: 0 })).toEqual({ lat: 6.18, lng: 0 });
    });
  });
});
