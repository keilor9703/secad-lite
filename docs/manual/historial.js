// Historial del último mes: casos ya cerrados que dan cuerpo al Panel, al Mapa
// y a la Consulta. Sin ellos la tendencia es una línea plana con un pico el
// día del sembrado, que no representa la operación de una central.
const API = 'http://127.0.0.1:3000/api';
function sesion() {
  let token = '';
  const api = async (m, r, b) => {
    const res = await fetch(API + r, {
      method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`${m} ${r} → ${res.status} ${t.slice(0, 180)}`);
    try { return t ? JSON.parse(t) : null; } catch { return null; }
  };
  api.entrar = async (u, c = 'demo') => { token = (await api('POST', '/auth/login', { usuario: u, contrasena: c })).token; };
  return api;
}

const SITIOS = [
  ['Parque principal', 'Centro', 6.0597, -75.5028],
  ['Calle 20 con Carrera 21', 'Centro', 6.0612, -75.5041],
  ['Vía El Retiro — La Ceja', 'Salida sur', 6.0489, -75.4967],
  ['Vereda El Carmen', 'El Carmen', 6.0721, -75.5183],
  ['Urbanización Los Salados', 'Los Salados', 6.0663, -75.4894],
  ['Vía a Don Diego', 'Don Diego', 6.0412, -75.5231],
  ['Institución Educativa', 'Centro', 6.0584, -75.5055],
  ['Vereda Pantanillo', 'Pantanillo', 6.0942, -75.4788],
  ['Puente de la quebrada', 'La Amapola', 6.0538, -75.4921],
  ['Zona industrial', 'El Chuscal', 6.0498, -75.5142],
];

// Peso aproximado de cada tipo en una central municipal: convivencia y
// tránsito por encima, rescates e incendios mucho más abajo.
const MEZCLA = [
  ['101', 'PONAL', 14], ['102', 'PONAL', 8], ['103', 'PONAL', 7], ['104', 'PONAL', 6],
  ['301', 'SEM', 9],    ['302', 'SEM', 5],
  ['401', 'MOVILIDAD', 6], ['402', 'MOVILIDAD', 8], ['403', 'MOVILIDAD', 5],
  ['201', 'B', 3],      ['202', 'B', 2], ['203', 'B', 2],
];

const REPORTANTES = ['Vecino del sector', 'Transeúnte', 'Administrador del conjunto', 'Celador',
  'Conductor', 'Familiar', 'Comerciante', 'Portería', 'Ciudadano', 'Docente de turno'];
const RELATOS = [
  'Reporta la situación y solicita presencia de una unidad en el sitio.',
  'Llama para informar lo ocurrido; indica que hay personas en el lugar.',
  'Solicita apoyo. Manifiesta que la situación continúa al momento de la llamada.',
  'Informa el hecho y queda atento a la llegada de la unidad.',
  'Pide que se verifique el sitio; dice que la situación se repite con frecuencia.',
];
const CIERRES = [
  ['atendido', 'Unidad en el sitio. Situación atendida y verificada.'],
  ['atendido', 'Se atendió el requerimiento y se dejó constancia en la minuta.'],
  ['atendido', 'Las partes llegaron a un acuerdo; se retiró la unidad sin novedad.'],
  ['falsa_alarma', 'La unidad verificó el sitio y no encontró la situación reportada.'],
  ['informativo', 'El ciudadano solo solicitaba información; no requirió despacho.'],
  ['desistido', 'Al llegar la unidad, el informante ya no requería el servicio.'],
  ['sin_merito', 'Verificado el sitio, los hechos no corresponden a un caso de policía.'],
];

const azar = a => a[Math.floor(Math.random() * a.length)];

async function main() {
  const admin = sesion();    await admin.entrar('admin1');
  const operador = sesion(); await operador.entrar('operador1');
  const canales = await admin('GET', '/catalogos/canales');
  const porCodigo = Object.fromEntries(canales.map(c => [c.codigo, c]));

  const bolsa = MEZCLA.flatMap(([cod, destino, n]) => Array(n).fill([cod, destino]));
  let hechos = 0, fallos = 0;

  for (const [cod, destino] of bolsa) {
    const [direccion, barrio, lat, lng] = azar(SITIOS);
    const c = porCodigo[destino];
    try {
      const caso = await operador('POST', '/casos', {
        canal: Math.random() < 0.82 ? 'llamada' : (Math.random() < 0.6 ? 'whatsapp' : 'chat'),
        ciudadano: azar(REPORTANTES),
        telefono: `31${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        descripcion: azar(RELATOS),
        codigoCaso: cod,
        ciudad: 'El Retiro', barrio, direccion,
        // Un poco de dispersión: dos casos del mismo sitio no caen en el mismo píxel.
        lat: lat + (Math.random() - 0.5) * 0.004,
        lng: lng + (Math.random() - 0.5) * 0.004,
        agenciaResponsableId: c?.agenciaId, canales: c ? [c.id] : undefined,
      });
      await admin('POST', `/casos/${caso.id}/tomar`, {});

      // Tres de cada cuatro salieron con unidad; el resto se resolvió sin despacho.
      if (Math.random() < 0.75) {
        const libres = await admin('GET', '/recursos/disponibles');
        const recurso = libres.find(r => r.agenciaId === c?.agenciaId);
        if (recurso) await admin('POST', `/casos/${caso.id}/asignaciones`, { recursoId: recurso.id });
      }
      const [codigoCierre, comentario] = azar(CIERRES);
      await admin('PATCH', `/casos/${caso.id}/estado`, { estado: 'cerrado', codigoCierre, comentario });
      hechos++;
    } catch (e) {
      if (fallos++ < 3) console.log(`  (${e.message.slice(0, 110)})`);
    }
  }
  console.log(`✔ historial: ${hechos} casos cerrados${fallos ? `, ${fallos} fallidos` : ''}`);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
