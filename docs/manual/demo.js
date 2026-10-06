// Instancia de demostración de FALCON CAD, en una sola pasada y por la API,
// sobre el catálogo de fábrica que el backend siembra al arrancar.
//
// Lo que importa del modelo, y que se aprende rompiéndolo: el estado del caso
// NO se fija a mano, se deriva de las bandejas por agencia (casos_canales).
// Despachar una ambulancia a un caso de policía no mueve la bandeja de
// policía, y el caso se queda en «nuevo». Por eso aquí cada caso se despacha
// SIEMPRE con un recurso de su propia agencia responsable.
const API = 'http://127.0.0.1:3000/api';

function sesion() {
  let token = '';
  const api = async (metodo, ruta, cuerpo) => {
    const r = await fetch(API + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${txt.slice(0, 220)}`);
    try { return txt ? JSON.parse(txt) : null; } catch { return null; }
  };
  api.entrar = async (u, c = 'demo') => { token = (await api('POST', '/auth/login', { usuario: u, contrasena: c })).token; };
  return api;
}

// El Retiro (Antioquia): vías, veredas y sectores reales del municipio.
const SITIOS = {
  parque:    ['Parque principal',          'Centro',      6.0597, -75.5028],
  calle20:   ['Calle 20 con Carrera 21',   'Centro',      6.0612, -75.5041],
  viaceja:   ['Vía El Retiro — La Ceja',   'Salida sur',  6.0489, -75.4967],
  carmen:    ['Vereda El Carmen',          'El Carmen',   6.0721, -75.5183],
  salados:   ['Urbanización Los Salados',  'Los Salados', 6.0663, -75.4894],
  dondiego:  ['Vía a Don Diego',           'Don Diego',   6.0412, -75.5231],
  colegio:   ['Institución Educativa',     'Centro',      6.0584, -75.5055],
  pantanillo:['Vereda Pantanillo',         'Pantanillo',  6.0942, -75.4788],
  quebrada:  ['Puente de la quebrada',     'La Amapola',  6.0538, -75.4921],
  chuscal:   ['Zona industrial',           'El Chuscal',  6.0498, -75.5142],
};

// fase: 'nuevo' · 'gestion' · 'despachado' · 'ruta' · 'sitio' · 'cerrado'
const CASOS = [
  // ── Cola de recepción, sin tomar ────────────────────────────────────────
  ['nuevo', '101', 'llamada',  'Doris Agudelo',    '3104432219', 'Riña entre varias personas a la salida del establecimiento. Ya rompieron vidrios.', 'parque', 'PONAL'],
  ['nuevo', '301', 'llamada',  'Hija del paciente','3187765540', 'Mi papá se cayó en el baño y no logra levantarse. Está consciente y responde.', 'salados', 'SEM'],
  ['nuevo', '102', 'whatsapp', 'Vendedora',        '3145567123', 'Me robaron el celular dos sujetos en bicicleta, salieron hacia la calle 21.', 'calle20', 'PONAL'],
  ['nuevo', '403', 'chat',     'Residente',        '3177712398', 'Un vehículo lleva dos días obstruyendo la salida del garaje comunal.', 'salados', 'MOVILIDAD'],
  ['nuevo', '103', 'llamada',  'Celadora',         '3192245566', 'Dos hombres llevan rato merodeando frente a las casas de la vereda.', 'colegio', 'PONAL'],
  ['nuevo', '302', 'llamada',  'Centro de salud',  '3001123456', 'Solicitamos traslado de paciente estable a consulta especializada.', 'viaceja', 'SEM'],
  ['nuevo', '402', 'llamada',  'Motociclista',     '3167781234', 'Me cerraron y me caí. Solo raspones, pero la moto quedó atravesada en la vía.', 'dondiego', 'MOVILIDAD'],

  // ── Tomados, en gestión, todavía sin unidad ─────────────────────────────
  ['gestion', '104', 'llamada', 'Vecino',          '3156678234', 'Escucho gritos y el llanto de un niño en la casa contigua desde hace rato.', 'viaceja', 'PONAL'],
  ['gestion', '203', 'llamada', 'Operario',        '3045523344', 'Un compañero quedó colgando del arnés en la fachada y no puede subir.', 'quebrada', 'B'],
  ['gestion', '101', 'llamada', 'Administrador',   '3156678890', 'Fiesta con música a muy alto volumen; los vecinos ya reclamaron y no bajan.', 'salados', 'PONAL'],

  // ── Despachados: unidad asignada, en ruta o ya en el sitio ──────────────
  ['ruta',       '201', 'llamada', 'Portero',        '3209912340', 'Fuego en el cuarto de basuras del edificio; está entrando humo a los pasillos.', 'chuscal', 'B'],
  ['sitio',      '401', 'llamada', 'Conductor de bus','3012298877','Atropellamos a un ciclista en la curva. Está en el piso, consciente.', 'viaceja', 'SEM'],
  ['ruta',       '102', 'llamada', 'Tendero',        '3167789012', 'Entraron a robar la tienda de la esquina y se llevaron la registradora.', 'quebrada', 'PONAL'],
  ['despachado', '202', 'llamada', 'Administradora', '3122234990', 'Olor fuerte a gas en el sótano. Ya evacuamos el primer piso.', 'chuscal', 'B'],
  ['despachado', '104', 'llamada', 'Hermana',        '3145590021', 'Mi hermana me llamó llorando, su pareja la está agrediendo. Vayan por favor.', 'viaceja', 'PONAL'],

  // ── Historial del turno ─────────────────────────────────────────────────
  ['cerrado', '301', 'llamada',  'Gloria Mesa',     '3209981145', 'Mi esposo tiene dolor en el pecho y dificultad para respirar. Tiene 68 años.', 'salados', 'SEM'],
  ['cerrado', '401', 'llamada',  'Andrés Quintero', '3015548902', 'Choque entre moto y campero. El motociclista está consciente pero no se mueve.', 'viaceja', 'SEM'],
  ['cerrado', '101', 'llamada',  'Luisa Restrepo',  '3104557821', 'Varias personas discutiendo a gritos frente al establecimiento. No se ven armas.', 'parque', 'PONAL'],
  ['cerrado', '201', 'llamada',  'Vigilante turno 2','3187742301','Sale humo del segundo piso de la bodega. Alcancé a ver llamas por la ventana.', 'chuscal', 'B'],
  ['cerrado', '402', 'llamada',  'Conductor',       '3111203344', 'Me chocaron por detrás en el semáforo. Nadie está herido, solo latonería.', 'calle20', 'MOVILIDAD'],
  ['cerrado', '103', 'llamada',  'Celador',         '3185567712', 'Hay un hombre revisando los carros parqueados desde hace rato.', 'colegio', 'PONAL'],
  ['cerrado', '301', 'whatsapp', 'Profesora',       '3133345567', 'Una estudiante se desmayó en el descanso. Ya reaccionó pero está muy pálida.', 'colegio', 'SEM'],
  ['cerrado', '403', 'chat',     'Comerciante',     '3144410023', 'Hay un camión bloqueando la entrada del parqueadero desde esta mañana.', 'calle20', 'MOVILIDAD'],
  ['cerrado', '203', 'llamada',  'Capataz de obra', '3016672200', 'Un trabajador quedó atrapado entre la formaleta en el tercer piso.', 'chuscal', 'B'],
  ['cerrado', '102', 'llamada',  'Camilo Ospina',   '3122298740', 'Dos sujetos en moto le arrebataron el bolso a una señora y salieron hacia la vía.', 'calle20', 'PONAL'],
  ['cerrado', '302', 'llamada',  'Hogar geriátrico','3045567890', 'Requerimos traslado programado de un residente a cita de control.', 'colegio', 'SEM'],
  ['cerrado', '101', 'llamada',  'Vecino vereda',   '3106678123', 'Discusión fuerte entre vecinos por un lindero; hay gente reunida en la vía.', 'pantanillo', 'PONAL'],
];

const CIERRES = [
  ['atendido',     'Unidad en el sitio. Situación atendida y verificada; no se requiere apoyo adicional.'],
  ['atendido',     'Se valoró al paciente y se trasladó al centro asistencial con acompañante.'],
  ['falsa_alarma', 'La unidad verificó el sitio y no encontró la situación reportada.'],
  ['atendido',     'Las partes llegaron a un acuerdo. Se dejó constancia y se retiró la unidad.'],
  ['informativo',  'El ciudadano solo solicitaba información; no requirió despacho de unidades.'],
  ['desistido',    'Al llegar la unidad, el informante manifestó que ya no requería el servicio.'],
];

const RECURSOS_EXTRA = [
  ['P-03',  'Patrulla 03',           'patrulla',   'POLICIA'],
  ['MT-01', 'Motorizado 01',         'moto',       'POLICIA'],
  ['MT-02', 'Motorizado 02',         'moto',       'POLICIA'],
  ['AMB-2', 'Ambulancia 2 — TAM',    'ambulancia', 'SALUD'],
  ['M-2',   'Máquina 2 — Rescate',   'maquina',    'BOMBEROS'],
  ['GR-01', 'Grúa 01',               'otro',       'TRANSITO'],
  ['AT-01', 'Agente de Tránsito 01', 'moto',       'TRANSITO'],
  ['AMB-3', 'Ambulancia 3',          'ambulancia', 'SALUD'],
  ['M-3',   'Máquina 3',             'maquina',    'BOMBEROS'],
];

/** Los recursos de fábrica traen la agencia como texto, sin vincular. */
const AGENCIA_POR_TEXTO = {
  'Policía': 'POLICIA', 'Bomberos': 'BOMBEROS', 'Salud': 'SALUD', 'Tránsito': 'TRANSITO',
};

const USUARIOS = [
  ['agomez',   'Ana Gómez',     'operador'],
  ['cruiz',    'Carlos Ruiz',   'operador'],
  ['mlondono', 'Marta Londoño', 'supervisor'],
  ['jsalazar', 'Jorge Salazar', 'supervisor'],
];

async function main() {
  const admin = sesion();    await admin.entrar('admin1');
  const operador = sesion(); await operador.entrar('operador1');

  const agencias = await admin('GET', '/catalogos/agencias');
  const canales  = await admin('GET', '/catalogos/canales');
  const idAg = Object.fromEntries(agencias.map(a => [a.codigo, a.id]));
  const canalPorCodigo = Object.fromEntries(canales.map(c => [c.codigo, c]));

  for (const [codigo, nombre, tipo, ag] of RECURSOS_EXTRA) {
    await admin('POST', '/recursos', { codigo, nombre, tipo, agenciaId: idAg[ag] });
  }
  let vinculados = 0;
  for (const r of await admin('GET', '/recursos')) {
    if (r.agenciaId) continue;
    const codigo = AGENCIA_POR_TEXTO[r.agencia];
    if (!codigo || !idAg[codigo]) continue;
    await admin('PATCH', `/recursos/${r.id}`, { agenciaId: idAg[codigo] })
      .then(() => vinculados++).catch(e => console.log(`  (vincular ${r.codigo}: ${e.message.slice(0, 70)})`));
  }
  console.log(`✔ flota: +${RECURSOS_EXTRA.length} nuevos, ${vinculados} de fábrica vinculados a su agencia`);

  await admin('POST', '/roles', {
    nombre: 'Despachador',
    permisos: ['casos.ver', 'casos.ver_todos', 'casos.gestionar', 'casos.cerrar',
               'despacho.ver', 'despacho.asignar', 'recursos.ver', 'pbx.usar'],
  }).then(() => console.log('✔ rol Despachador')).catch(e => console.log(`  (rol: ${e.message.slice(0, 70)})`));

  const agenciaAdmin = idAg['OTRAS'] ?? agencias[0].id;
  for (const [username, nombre, rol] of USUARIOS) {
    await admin('POST', '/usuarios',
      { username, nombre, rol, contrasena: 'falcon2026', agenciaId: agenciaAdmin })
      .catch(e => console.log(`  (usuario ${username}: ${e.message.slice(0, 90)})`));
  }
  console.log(`✔ usuarios: +${USUARIOS.length}`);

  // Un recurso de la agencia del caso, y disponible: sin eso la bandeja de esa
  // agencia no avanza y el caso se queda donde estaba.
  const libreDe = async agenciaId => {
    const libres = await admin('GET', '/recursos/disponibles');
    return libres.find(r => r.agenciaId === agenciaId) ?? null;
  };

  const cuenta = {};
  let iCierre = 0;
  for (const [fase, cod, canal, ciudadano, telefono, relato, sitio, destino] of CASOS) {
    const [direccion, barrio, lat, lng] = SITIOS[sitio];
    const c = canalPorCodigo[destino];
    const caso = await operador('POST', '/casos', {
      canal, ciudadano, telefono, descripcion: relato, codigoCaso: cod,
      ciudad: 'El Retiro', barrio, direccion, lat, lng,
      agenciaResponsableId: c?.agenciaId, canales: c ? [c.id] : undefined,
    });
    cuenta[fase] = (cuenta[fase] ?? 0) + 1;
    if (fase === 'nuevo') continue;

    await admin('POST', `/casos/${caso.id}/tomar`, {});
    if (fase === 'gestion') continue;

    const recurso = await libreDe(c?.agenciaId);
    if (!recurso) { console.log(`  (sin recurso libre de ${destino} para ${cod})`); continue; }
    const asig = await admin('POST', `/casos/${caso.id}/asignaciones`, { recursoId: recurso.id });

    if (fase === 'ruta' || fase === 'sitio') {
      await admin('PATCH', `/asignaciones/${asig.id}/estado`,
        { estado: fase === 'ruta' ? 'en_ruta' : 'en_sitio' });
    }
    if (fase !== 'cerrado') continue;

    const [codigoCierre, comentario] = CIERRES[iCierre++ % CIERRES.length];
    await admin('PATCH', `/casos/${caso.id}/estado`, { estado: 'cerrado', codigoCierre, comentario });
  }
  console.log(`✔ casos: ${JSON.stringify(cuenta)}`);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
