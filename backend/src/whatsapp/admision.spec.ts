import {
  esRuido, formaDe, menuDeTipos, opcionElegida, palabras, pareceMovil, textoDelMenu,
  ubicacionDe, MAX_OPCIONES,
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

describe('Admisión de WhatsApp · la forma de un mensaje', () => {
  // El 22/10/2026 una foto y una ubicación reales no se pudieron leer, y
  // averiguar por qué era imposible: el log decía que había fallado, no QUÉ
  // venía dentro. Esto cierra ese agujero sin abrir otro.

  it('dice los campos, no lo que llevan dentro', () => {
    // Es la garantía que importa: un reporte de emergencia —su texto, su
    // dirección, sus coordenadas— no puede acabar escrito en el log de un
    // servidor por querer depurar el formato.
    const f = formaDe({
      type: 'LOCATION', latitude: 6.1845, longitude: -75.5986,
      address: 'Calle 50 #70-20',
    });

    expect(f).toContain('latitude');
    expect(f).toContain('address');
    expect(f).not.toContain('6.1845');
    expect(f).not.toContain('Calle 50');
    expect(f).not.toContain('LOCATION');
  });

  it('entra un nivel en lo anidado, que es donde se escondía el problema', () => {
    const f = formaDe({ type: 'LOCATION', location: { latitude: 1, longitude: 2 } });
    expect(f).toContain('location{latitude,longitude}');
  });

  it('no se hunde en algo muy anidado', () => {
    const f = formaDe({ a: { b: { c: { d: 1 } } } });
    expect(f).toContain('…');
  });

  it('un cuerpo vacío o raro no revienta', () => {
    expect(formaDe(null)).toBe('nada');
    expect(formaDe(undefined)).toBe('nada');
    expect(formaDe('texto')).toBe('string');
    expect(formaDe([1, 2, 3])).toBe('[3]');
  });
});

describe('Admisión de WhatsApp · la ubicación anidada', () => {
  it('se acepta tanto al nivel del mensaje como dentro de «location»', () => {
    // Dos convenciones conviven entre proveedores. Distinguirlas no aporta
    // nada y equivocarse cuesta la ubicación de una emergencia.
    expect(ubicacionDe({ latitude: 6.18, longitude: -75.59 })).toEqual({ lat: 6.18, lng: -75.59 });
    expect(ubicacionDe({ location: { latitude: 6.18, longitude: -75.59 } }))
      .toEqual({ lat: 6.18, lng: -75.59 });
  });

  it('y «0, 0» sigue rechazándose venga como venga', () => {
    expect(ubicacionDe({ location: { latitude: 0, longitude: 0 } })).toBeNull();
  });
});

/**
 * ¿A ESTE NÚMERO SE LE PUEDE ESCRIBIR POR WHATSAPP?
 *
 * Esta pregunta existe porque el proveedor NO la contesta. Le mandas una
 * plantilla a un teléfono fijo y responde 200: el rechazo llega después, en un
 * informe de entrega que no estamos escuchando. Resultado sin este freno: el
 * operador leía «Enviado por WhatsApp», el ciudadano no recibía nada, y el SMS
 * —que sí le habría llegado— no se intentaba nunca.
 *
 * El sesgo es deliberado: ante la duda, intentarlo. Equivocarse hacia «parece
 * móvil» cuesta una petición de más; hacia el otro lado cuesta mandar por SMS
 * algo que habría llegado mejor por WhatsApp.
 */
describe('pareceMovil · a quién se le puede mandar la plantilla', () => {
  describe('sí, es un móvil colombiano', () => {
    it('con indicativo, como lo escribe el webhook', () => {
      expect(pareceMovil('573175882321')).toBe(true);
      expect(pareceMovil('573132354086')).toBe(true);
    });

    it('sin indicativo, como lo teclea el operador', () => {
      expect(pareceMovil('3175882321')).toBe(true);
    });

    it('con el signo, los espacios y los guiones que la gente escribe', () => {
      // El número llega de una ficha rellenada a mano: si el formato decidiera
      // el canal, el mismo ciudadano recibiría WhatsApp o SMS según cómo lo
      // hubiera copiado el operador.
      expect(pareceMovil('+57 317 588 2321')).toBe(true);
      expect(pareceMovil('+57-317-588-2321')).toBe(true);
      expect(pareceMovil('(317) 588 2321')).toBe(true);
    });

    it('un móvil de otro país con cola de diez dígitos también se intenta', () => {
      // No se sabe marcar la numeración del mundo, y rechazar de más deja al
      // ciudadano con un SMS. Si no tiene WhatsApp, el envío falla y quien
      // llama tiene el SMS detrás.
      expect(pareceMovil('13055882321')).toBe(true);
    });
  });

  describe('no, y aquí está el valor de la prueba', () => {
    it('un fijo de Medellín con indicativo nacional', () => {
      // 604 + siete dígitos. El proveedor aceptaría la plantilla y diría 200.
      expect(pareceMovil('576042161000')).toBe(false);
      expect(pareceMovil('6042161000')).toBe(false);
    });

    it('un fijo de Bogotá', () => {
      expect(pareceMovil('576012194000')).toBe(false);
    });

    it('un fijo escrito corto, como está en media base de datos', () => {
      expect(pareceMovil('2161000')).toBe(false);
      expect(pareceMovil('42161000')).toBe(false);
    });

    it('una línea 123 o cualquier número de emergencias', () => {
      expect(pareceMovil('123')).toBe(false);
    });

    it('nada, vacío o basura', () => {
      expect(pareceMovil('')).toBe(false);
      expect(pareceMovil('   ')).toBe(false);
      expect(pareceMovil('sin teléfono')).toBe(false);
      expect(pareceMovil(undefined as unknown as string)).toBe(false);
      expect(pareceMovil(null as unknown as string)).toBe(false);
    });
  });
});
