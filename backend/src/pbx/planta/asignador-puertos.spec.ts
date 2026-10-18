import {
  asignarRanura,
  cuantasRanuras,
  PLAN_POR_DEFECTO,
  PlanDePuertos,
  RanuraPuertos,
  ranuraDe,
  revisarChoques,
} from './asignador-puertos';

/**
 * El reparto de puertos de las plantas de un servidor compartido.
 *
 * Lo que se protege, y por qué cada cosa importa en una línea del 123:
 *
 *  1. **Que nunca entregue un puerto que ya está tomado**, sea SIP o HTTP.
 *     El contenedor va en la red del host, así que los tres puertos viven en
 *     el mismo espacio: el HTTP de una planta y el SIP de otra se pelean
 *     igual. Dos contenedores con el mismo puerto: el segundo no arranca, y
 *     el municipio queda sin teléfono sin que nadie haya tocado nada suyo.
 *  2. **Que nunca entregue un rango RTP que se CRUCE con otro**, ni siquiera
 *     parcialmente. Un cruce no impide arrancar: deja audio que entra por el
 *     puerto de otra instancia. Es el fallo más caro y el más difícil de ver.
 *  3. **Que respete los puertos de los otros servicios del servidor.** En el
 *     servidor de la centralita conviven SECAD, FALCON test y coturn; pisar
 *     uno tumba algo que no tiene nada que ver con telefonía. Ya nos pasó con
 *     el 8088 de `secad-api`.
 *  4. **Que la banda quede abajo del rango efímero del kernel** (32768): un
 *     RTP ahí arriba se cae un día cualquiera, por un socket saliente, sin
 *     dejar rastro.
 *  5. **Que pueda registrar lo que YA existe**, aunque esté fuera de la banda
 *     —la centralita actual escucha SIP en el 3478—. Un validador que no
 *     admite la realidad obliga a desactivarlo.
 *  6. **Que cuando se agote diga que se agotó**, en vez de repetir el último.
 */
describe('asignador de puertos de las plantas', () => {
  describe('la primera planta y las siguientes', () => {
    it('la primera planta del servidor toma el principio de las bandas', () => {
      const r = asignarRanura([]);
      expect(r.ok).toBe(true);
      expect(r.ok && r.ranura).toEqual({
        puertoSip: 5060,
        rtpDesde: 20500,
        rtpHasta: 20999,
        puertoHttp: 8100,
      });
    });

    it('la segunda no choca con la primera en nada', () => {
      const segunda = asignarRanura([ranuraDe(0)!]);
      expect(segunda.ok).toBe(true);
      expect(segunda.ok && segunda.ranura).toEqual({
        puertoSip: 5061,
        rtpDesde: 21000,
        rtpHasta: 21499,
        puertoHttp: 8101,
      });
    });

    it('los tres puertos salen de la MISMA ranura, para auditar el servidor de un vistazo', () => {
      expect(ranuraDe(3)).toEqual({
        puertoSip: 5063,
        rtpDesde: 22000,
        rtpHasta: 22499,
        puertoHttp: 8103,
      });
    });

    it('veinte plantas seguidas no repiten ni cruzan nada', () => {
      const dadas: RanuraPuertos[] = [];
      for (let i = 0; i < 20; i++) {
        const r = asignarRanura(dadas);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(revisarChoques(r.ranura, dadas)).toBeNull();
        dadas.push(r.ranura);
      }
      const sueltos = dadas.flatMap((d) => [d.puertoSip, d.puertoHttp]);
      expect(new Set(sueltos).size).toBe(40);
      for (const d of dadas) expect(d.rtpDesde % 2).toBe(0);
    });

    it('todo lo que reparte queda abajo del rango efímero del kernel (32768)', () => {
      expect(PLAN_POR_DEFECTO.rtpHasta).toBeLessThan(32768);
      const ultima = ranuraDe(cuantasRanuras(PLAN_POR_DEFECTO) - 1)!;
      expect(ultima.rtpHasta).toBeLessThan(32768);
    });

    it('no se mete en el rango por defecto de Asterisk (10000–20000), donde ya corre la centralita a mano', () => {
      expect(PLAN_POR_DEFECTO.rtpDesde).toBeGreaterThan(20000);
    });

    it('el HTTP arranca por encima del 8088 de secad-api, que ya nos tumbó una vez el softphone', () => {
      expect(PLAN_POR_DEFECTO.httpDesde).toBeGreaterThan(8089);
    });
  });

  describe('lo que ya está ocupado', () => {
    it('reutiliza el hueco de una planta dada de baja: la banda es finita', () => {
      const ocupadas = [ranuraDe(0)!, ranuraDe(2)!];
      const r = asignarRanura(ocupadas);
      expect(r.ok && r.ranura.puertoSip).toBe(5061);
    });

    it('una planta fuera de la cuadrícula bloquea la ranura que pisa, y solo esa', () => {
      // Un rango escrito a mano que se come la mitad de dos ranuras.
      const aMano = {
        puertoSip: 3478,
        rtpDesde: 20800,
        rtpHasta: 21200,
        puertoHttp: 8099,
      };
      const r = asignarRanura([aMano]);
      expect(r.ok).toBe(true);
      // 0 (20500–20999) y 1 (21000–21499) se cruzan con él; 2 ya no.
      expect(r.ok && r.ranura).toEqual({
        puertoSip: 5062,
        rtpDesde: 21500,
        rtpHasta: 21999,
        puertoHttp: 8102,
      });
    });

    it('un puerto SIP ajeno dentro de la banda no se vuelve a entregar', () => {
      const r = asignarRanura([
        { puertoSip: 5060, rtpDesde: 60000, rtpHasta: 60100, puertoHttp: 8199 },
      ]);
      expect(r.ok && r.ranura.puertoSip).toBe(5061);
    });

    it('tampoco se vuelve a entregar un puerto HTTP ajeno', () => {
      const r = asignarRanura([
        { puertoSip: 5500, rtpDesde: 60000, rtpHasta: 60100, puertoHttp: 8100 },
      ]);
      expect(r.ok && r.ranura.puertoHttp).toBe(8101);
      expect(r.ok && r.ranura.puertoSip).toBe(5061);
    });
  });

  describe('los puertos de otros servicios del servidor', () => {
    const conReservados: PlanDePuertos = {
      ...PLAN_POR_DEFECTO,
      reservados: [5060, 21050],
    };

    it('no entrega como SIP un puerto reservado', () => {
      const r = asignarRanura([], conReservados);
      expect(r.ok).toBe(true);
      // 5060 está reservado; la ranura 1 tendría el 21050 dentro del RTP.
      expect(r.ok && r.ranura.puertoSip).toBe(5062);
    });

    it('no entrega una tajada RTP que contenga un puerto reservado', () => {
      const r = asignarRanura([], { ...PLAN_POR_DEFECTO, reservados: [20600] });
      expect(r.ok && r.ranura.rtpDesde).toBe(21000);
    });

    it('tampoco entrega como HTTP un puerto reservado', () => {
      const r = asignarRanura([], { ...PLAN_POR_DEFECTO, reservados: [8100] });
      expect(r.ok && r.ranura.puertoHttp).toBe(8101);
    });

    it('lo dice con el número y el rol, para que se sepa a quién llamar', () => {
      expect(
        revisarChoques(ranuraDe(0)!, [], {
          ...PLAN_POR_DEFECTO,
          reservados: [20600],
        }),
      ).toContain('20600');
      expect(
        revisarChoques(ranuraDe(0)!, [], {
          ...PLAN_POR_DEFECTO,
          reservados: [8100],
        }),
      ).toContain('HTTP/ARI');
    });
  });

  describe('lo que escribe un administrador a mano', () => {
    it('acepta la centralita que ya existe, aunque esté fuera de la banda', () => {
      const comoEsta = {
        puertoSip: 3478,
        rtpDesde: 10000,
        rtpHasta: 20000,
        puertoHttp: 8089,
      };
      expect(revisarChoques(comoEsta, [])).toBeNull();
    });

    it('rechaza repetir el puerto SIP de otra planta, nombrándolo', () => {
      const motivo = revisarChoques(
        { puertoSip: 5061, rtpDesde: 40000, rtpHasta: 40499, puertoHttp: 8190 },
        [ranuraDe(1)!],
      );
      expect(motivo).toContain('5061');
    });

    it('rechaza el HTTP de uno contra el SIP de otro: en la red del host es el mismo espacio', () => {
      const motivo = revisarChoques(
        { puertoSip: 5500, rtpDesde: 40000, rtpHasta: 40499, puertoHttp: 5061 },
        [ranuraDe(1)!],
      );
      expect(motivo).toContain('5061');
      expect(motivo).toContain('SIP');
    });

    it('rechaza un cruce PARCIAL de rangos RTP, que es el que no impide arrancar', () => {
      const motivo = revisarChoques(
        { puertoSip: 5090, rtpDesde: 20900, rtpHasta: 21400, puertoHttp: 8190 },
        [ranuraDe(0)!],
      );
      expect(motivo).toContain('se cruza');
      expect(motivo).toContain('20500');
    });

    it('rechaza un rango RTP que se come el puerto de otra planta', () => {
      const motivo = revisarChoques(
        { puertoSip: 6000, rtpDesde: 5000, rtpHasta: 5499, puertoHttp: 8190 },
        [ranuraDe(1)!],
      );
      expect(motivo).toContain('5061');
    });

    it('rechaza un rango RTP impar: partiría el par RTP/RTCP entre dos plantas', () => {
      expect(
        revisarChoques(
          {
            puertoSip: 5090,
            rtpDesde: 40001,
            rtpHasta: 40500,
            puertoHttp: 8190,
          },
          [],
        ),
      ).toContain('par');
    });

    it('rechaza un rango al revés y un puerto imposible', () => {
      expect(
        revisarChoques(
          {
            puertoSip: 5090,
            rtpDesde: 40500,
            rtpHasta: 40000,
            puertoHttp: 8190,
          },
          [],
        ),
      ).toContain('al revés');
      expect(
        revisarChoques(
          {
            puertoSip: 70000,
            rtpDesde: 40000,
            rtpHasta: 40499,
            puertoHttp: 8190,
          },
          [],
        ),
      ).toContain('no es un puerto válido');
    });

    it('rechaza un puerto que cae dentro de un rango RTP, propio o ajeno', () => {
      expect(
        revisarChoques(
          {
            puertoSip: 40100,
            rtpDesde: 40000,
            rtpHasta: 40499,
            puertoHttp: 8190,
          },
          [],
        ),
      ).toContain('misma planta');
      expect(
        revisarChoques(
          {
            puertoSip: 5090,
            rtpDesde: 40000,
            rtpHasta: 40499,
            puertoHttp: 40200,
          },
          [],
        ),
      ).toContain('misma planta');
      expect(
        revisarChoques(
          {
            puertoSip: 20600,
            rtpDesde: 40000,
            rtpHasta: 40499,
            puertoHttp: 8190,
          },
          [ranuraDe(0)!],
        ),
      ).toContain('otra planta');
    });

    it('rechaza el mismo puerto para SIP y para HTTP', () => {
      expect(
        revisarChoques(
          {
            puertoSip: 5090,
            rtpDesde: 40000,
            rtpHasta: 40499,
            puertoHttp: 5090,
          },
          [],
        ),
      ).toContain('no pueden ser el mismo');
    });
  });

  describe('cuando ya no caben más', () => {
    it('dice que el servidor se agotó, con el número de plantas que admite', () => {
      const todas = Array.from(
        { length: cuantasRanuras(PLAN_POR_DEFECTO) },
        (_, i) => ranuraDe(i)!,
      );
      const r = asignarRanura(todas);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain(
        String(cuantasRanuras(PLAN_POR_DEFECTO)),
      );
      expect(!r.ok && r.error).toContain('servidor');
    });

    it('la banda más corta manda, y hoy las tres dan lo mismo', () => {
      expect(cuantasRanuras(PLAN_POR_DEFECTO)).toBe(24);
      expect(cuantasRanuras({ ...PLAN_POR_DEFECTO, httpHasta: 8102 })).toBe(3);
    });

    it('no reparte nada con un plan inválido, en vez de repartir cruces', () => {
      const impar: PlanDePuertos = {
        ...PLAN_POR_DEFECTO,
        puertosRtpPorPlanta: 501,
      };
      expect(asignarRanura([], impar).ok).toBe(false);
      const sinSitio: PlanDePuertos = {
        ...PLAN_POR_DEFECTO,
        rtpHasta: PLAN_POR_DEFECTO.rtpDesde + 10,
      };
      expect(asignarRanura([], sinSitio).ok).toBe(false);
      const bandasCruzadas: PlanDePuertos = {
        ...PLAN_POR_DEFECTO,
        rtpDesde: 8000,
        rtpHasta: 20000,
      };
      expect(asignarRanura([], bandasCruzadas).ok).toBe(false);
    });
  });
});
