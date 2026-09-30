/**
 * Prueba de integración de la videollamada: la aplicación Nest DE VERDAD, con
 * su gateway de socket.io real, PostgreSQL real, y dos clientes —uno haciendo
 * de despachador y otro de ciudadano—.
 *
 * Por qué así y no con mocks: lo que puede estar mal aquí es el aislamiento
 * (¿puede un despachador de otra instancia entrar a esta llamada?), quién
 * decide el emisor de un mensaje, y a quién le llega cada relay. Un mock del
 * socket respondería que sí a todo eso.
 *
 *   DATABASE_URL=postgres://falcon_app:falcon@127.0.0.1:5432/falcon \
 *     npx ts-node test/videollamada.integracion.ts
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { io, Socket } from 'socket.io-client';
import { VideollamadaModule } from '../src/videollamada/videollamada.module';
import { VideollamadaService } from '../src/videollamada/videollamada.service';
import { VideoTokenService } from '../src/videollamada/video-token.service';
import { VideoSesionEntity } from '../src/videollamada/video-sesion.entity';
import { VideoChatMensajeEntity } from '../src/videollamada/video-chat-mensaje.entity';
import { ArchivoEntity } from '../src/archivos/archivo.entity';
import { ArchivoChunkEntity } from '../src/archivos/archivo-chunk.entity';
import { ConfigSmsEntity } from '../src/sms/config-sms.entity';
import { TenantEntity } from '../src/tenants/tenant.entity';
import { CasoEntity } from '../src/casos/caso.entity';
import { CommonModule } from '../src/common/common.module';
import { UsuariosModule } from '../src/usuarios/usuarios.module';
import { RolesModule } from '../src/roles/roles.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermisosGuard } from '../src/auth/permisos.guard';
import { TenantRlsService } from '../src/common/tenant-rls.service';

const PUERTO = 5645;
const SECRETO = 'secreto-de-prueba';
const fallos: string[] = [];

function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

/**
 * Espera un evento del socket, o null si no llega en el plazo.
 *
 * `filtro` importa en el chat: el servidor emite a TODA la sala, así que quien
 * escribe recibe también el eco de su propio mensaje. Sin filtrar, la espera
 * capturaría ese eco y no el mensaje del otro extremo.
 */
function esperar<T>(
  socket: Socket, evento: string, ms = 2500, filtro?: (c: T) => boolean,
): Promise<T | null> {
  return new Promise((resolver) => {
    const reloj = setTimeout(() => { socket.off(evento, alLlegar); resolver(null); }, ms);
    const alLlegar = (carga: T) => {
      if (filtro && !filtro(carga)) return;
      clearTimeout(reloj);
      socket.off(evento, alLlegar);
      resolver(carga);
    };
    socket.on(evento, alLlegar);
  });
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function conectar(auth: Record<string, unknown> = {}): Promise<Socket> {
  return new Promise((resolver, rechazar) => {
    const s = io(`http://127.0.0.1:${PUERTO}/video`, { auth, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolver(s));
    s.on('connect_error', rechazar);
  });
}

async function main(): Promise<number> {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        // Sin esto, un `.env` del entorno de desarrollo pisa estos valores
        // —incluido JWT_SECRET— y el gateway rechaza los tokens que firma la
        // propia prueba con un «No autenticado.» que no tiene nada que ver
        // con el código bajo prueba.
        ignoreEnvFile: true,
        load: [() => ({
          JWT_SECRET: SECRETO,
          FRONTEND_URL: 'https://falcon.example',
          VIDEO_TOKEN_MINUTOS: '15',
        })],
      }),
      // Global: el gateway lo resuelve por su módulo, que en la app lo toma de
      // AuthModule; aquí se registra suelto para no arrastrar media aplicación.
      JwtModule.register({ secret: SECRETO, global: true }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: process.env.DATABASE_URL ?? 'postgres://falcon_app:falcon@127.0.0.1:5432/falcon',
        // autoLoad en vez de una lista a mano: VideollamadaModule importa
        // AuthModule (de donde sale el JwtService del gateway) y eso arrastra
        // roles, usuarios y tenants. Enumerarlas aquí sería una lista que se
        // desactualiza sola.
        autoLoadEntities: true,
        synchronize: true,
      }),
      // La capa de archivos trae su barrido programado; la app lo registra
      // en app.module y aquí hay que hacer lo mismo.
      ScheduleModule.forRoot(),
      // AuthModule (que trae el JwtService del gateway) registra un guard de
      // throttling; en la app lo configura app.module.
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
      CommonModule,
      // Los guardias globales necesitan resolver usuario y rol contra la base.
      UsuariosModule,
      RolesModule,
      VideollamadaModule,
    ],
    // Los MISMOS guardias globales que registra app.module. Sin ellos, las
    // rutas se probarían desnudas: la del ciudadano parecía abierta cuando en
    // la aplicación real respondía 403, porque PermisosGuard resuelve permisos
    // contra la base y no mira `@Public()`.
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: PermisosGuard },
    ],
  }).compile();

  const app: INestApplication = modulo.createNestApplication();
  await app.listen(PUERTO);

  const rls = app.get(TenantRlsService);
  const video = app.get(VideollamadaService);
  const tokens = app.get(VideoTokenService);
  const jwt = app.get(JwtService);

  // Las políticas RLS de estas tablas las crea la migración; aquí se replican
  // para poder correr sobre una base limpia.
  const ds = app.get(ConfigService) && (rls as unknown as { dataSource: { query: (q: string) => Promise<unknown> } }).dataSource;
  for (const tabla of ['video_sesiones', 'video_chat_mensajes']) {
    await ds.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
    await ds.query(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY`);
    await ds.query(`DROP POLICY IF EXISTS tenant_isolation ON ${tabla}`);
    await ds.query(`CREATE POLICY tenant_isolation ON ${tabla}
      USING (tenant = current_setting('app.tenant', true))
      WITH CHECK (tenant = current_setting('app.tenant', true))`);
  }

  // Un caso de Tunja del que colgar la llamada.
  const casoId = await rls.conTenant('tunja', async (m) => {
    await m.query(`DELETE FROM video_sesiones WHERE tenant = 'tunja'`);
    const caso = await m.getRepository(CasoEntity).save(
      m.getRepository(CasoEntity).create({
        tenant: 'tunja', estado: 'nuevo', canal: 'llamada', titulo: 'Prueba de videollamada', ciudadano: 'Ciudadano de prueba', telefono: '3001234567',
        descripcion: '', creadoPor: 'operador1',
      } as Partial<CasoEntity>));
    return caso.id;
  });

  const jwtDespachador = jwt.sign({ sub: 'despachador1', tenant: 'tunja', rol: 'operador' }, { secret: SECRETO });
  const jwtOtraInstancia = jwt.sign({ sub: 'intruso', tenant: 'mebog', rol: 'operador' }, { secret: SECRETO });

  console.log('\n1) Crear la llamada');
  const creada = await video.crear('tunja', casoId, '3001234567', 'despachador1');
  afirmar(!!creada.sesionId, 'se creó la sesión');
  afirmar(/\/v\/tunja-[23456789abcdefghjkmnpqrstuvwxyz]{12}$/.test(creada.enlace),
    `el enlace es corto y dictable: ${creada.enlace}`);
  afirmar(creada.enlace.length <= 70,
    `y cabe en un SMS sin parecer un fraude (${creada.enlace.length} caracteres)`);
  afirmar(creada.smsEnviado === false,
    'sin proveedor configurado el SMS no sale, pero la llamada queda abierta igual');

  console.log('\n2) Es idempotente por caso');
  const otra = await video.crear('tunja', casoId, '3001234567', 'despachador1');
  afirmar(otra.sesionId === creada.sesionId && otra.reutilizada,
    'pedirla dos veces devuelve la MISMA sesión, no deja al ciudadano hablando solo');

  console.log('\n3) El enlace del ciudadano');
  afirmar(tokens.validar(creada.token)?.tenant === 'tunja', 'el token lleva la instancia dentro, firmada');
  afirmar(tokens.validar('token-inventado') === null, 'un token inventado no vale');
  afirmar(tokens.validar(jwtDespachador) === null,
    'y un JWT de sesión de funcionario TAMPOCO sirve como enlace de video');

  const claveCreada = creada.enlace.split('/').pop() ?? '';
  afirmar((await video.porClave(claveCreada))?.id === creada.sesionId,
    'la clave corta resuelve a SU sesión');
  afirmar((await video.porClave('tunja-zzzzzzzzzzzz')) === null,
    'un código inventado de la misma instancia no resuelve a nada');
  afirmar((await video.porClave(`mebog-${claveCreada.split('-')[1]}`)) === null,
    'y el mismo código bajo OTRA instancia tampoco: el aislamiento se mantiene');
  afirmar((await video.porClave('sin-guiones-ni-nada')) === null, 'una clave mal formada se rechaza');

  console.log('\n4) El despachador entra a su sala');
  const sDesp = await conectar({ token: jwtDespachador });
  sDesp.emit('video:unirse-despachador', { sesionId: creada.sesionId });
  const unido = await esperar<{ estado: string }>(sDesp, 'video:unido');
  afirmar(unido?.estado === 'PENDIENTE', `entró y ve el estado ${unido?.estado}`);

  console.log('\n5) Un despachador de OTRA instancia no entra');
  const sIntruso = await conectar({ token: jwtOtraInstancia });
  sIntruso.emit('video:unirse-despachador', { sesionId: creada.sesionId });
  const errorIntruso = await esperar<string>(sIntruso, 'video:error');
  afirmar(!!errorIntruso, `rechazado: ${errorIntruso}`);

  console.log('\n6) El ciudadano entra con su enlace');
  const avisoCiudadano = esperar(sDesp, 'video:ciudadano-conectado');
  const sCiud = await conectar();
  sCiud.emit('video:unirse-ciudadano', { token: creada.token });
  const unidoCiud = await esperar<{ estado: string }>(sCiud, 'video:unido');
  afirmar(unidoCiud?.estado === 'CONECTADA', 'el ciudadano entró');
  afirmar((await avisoCiudadano) !== null, 'y al despachador le avisaron');

  const trasEntrar = await video.obtener('tunja', creada.sesionId);
  afirmar(trasEntrar?.estado === 'CONECTADA' && !!trasEntrar?.conectadoEn,
    'queda registrado cuándo entró');

  console.log('\n7) Señalización: llega al otro, y solo al otro');
  const ofertaEnCiudadano = esperar<{ sdp: string }>(sCiud, 'video:oferta');
  const ofertaEnIntruso = esperar(sIntruso, 'video:oferta', 900);
  sDesp.emit('video:oferta', { sdp: 'v=0 oferta-de-prueba' });
  afirmar((await ofertaEnCiudadano)?.sdp === 'v=0 oferta-de-prueba', 'la oferta llegó al ciudadano');
  afirmar((await ofertaEnIntruso) === null, 'y NO a quien no está en la sala');

  const respuestaEnDesp = esperar<{ sdp: string }>(sDesp, 'video:respuesta');
  sCiud.emit('video:respuesta', { sdp: 'v=0 respuesta-de-prueba' });
  afirmar((await respuestaEnDesp)?.sdp === 'v=0 respuesta-de-prueba', 'la respuesta volvió al despachador');

  const iceEnDesp = esperar<{ candidato: unknown }>(sDesp, 'video:ice');
  sCiud.emit('video:ice', { candidato: { candidate: 'candidato-de-prueba' } });
  afirmar(!!(await iceEnDesp), 'los candidatos ICE también se relayan');

  console.log('\n8) Chat: se guarda y el emisor lo decide el servidor');
  const chatEnDesp = esperar<{ emisor: string; texto: string; usuario: string | null }>(sDesp, 'video:chat');
  sCiud.emit('video:chat', { texto: 'No puedo hablar, hay alguien afuera' });
  const recibido = await chatEnDesp;
  afirmar(recibido?.emisor === 'CIUDADANO', `el emisor salió como ${recibido?.emisor}`);
  afirmar(recibido?.usuario === null, 'y sin usuario, porque el ciudadano no es un funcionario');

  const chatEnCiud = esperar<{ emisor: string; usuario: string | null }>(
    sCiud, 'video:chat', 2500, (m) => m.emisor === 'DESPACHADOR');
  sDesp.emit('video:chat', { texto: 'Ya vamos en camino' });
  const delDespachador = await chatEnCiud;
  afirmar(delDespachador?.emisor === 'DESPACHADOR' && delDespachador?.usuario === 'despachador1',
    'el del despachador queda con su usuario, tomado del token y no de lo que mande el cliente');

  // El guardado va por su propio camino asíncrono; se le da un instante antes
  // de listar, o se estaría midiendo la carrera y no el resultado.
  await pausa(200);
  const guardados = await video.listarChat('tunja', creada.sesionId);
  afirmar(guardados.length === 2, `los ${guardados.length} mensajes quedaron guardados, no solo en pantalla`);

  console.log('\n9) Ubicación: solo del ciudadano, y se guarda');
  const ubicEnDesp = esperar<{ lat: number; lng: number }>(sDesp, 'video:ubicacion');
  sCiud.emit('video:ubicacion', { lat: 5.5353, lng: -73.3678, precision: 12 });
  afirmar((await ubicEnDesp)?.lat === 5.5353, 'le llegó al despachador');
  const conUbic = await video.obtener('tunja', creada.sesionId);
  afirmar(conUbic?.ultimaLat === 5.5353 && conUbic?.ultimaLng === -73.3678, 'y quedó en la sesión');

  const ubicDelDesp = esperar(sCiud, 'video:ubicacion', 900);
  sDesp.emit('video:ubicacion', { lat: 1, lng: 1 });
  afirmar((await ubicDelDesp) === null, 'la del despachador se ignora: no tendría sentido');

  console.log('\n10) Caerse NO termina la llamada');
  const avisoCaida = esperar<{ rol: string }>(sDesp, 'video:participante-desconectado');
  sCiud.disconnect();
  afirmar((await avisoCaida)?.rol === 'ciudadano', 'al despachador le avisan que se cayó');
  const trasCaida = await video.obtener('tunja', creada.sesionId);
  afirmar(trasCaida?.estado === 'CONECTADA',
    'la sesión sigue viva: el ciudadano puede volver con el mismo enlace');
  const sigueActiva = await video.activaDe('tunja', casoId);
  afirmar(sigueActiva?.id === creada.sesionId, 'y el caso la sigue ofreciendo para reconectarse');

  console.log('\n11) Colgar sí la termina');
  sDesp.emit('video:finalizar');
  await esperar(sDesp, 'video:finalizada');
  const trasColgar = await video.obtener('tunja', creada.sesionId);
  afirmar(trasColgar?.estado === 'FINALIZADA', `quedó ${trasColgar?.estado}`);
  afirmar((await video.activaDe('tunja', casoId)) === null, 'y el caso ya no ofrece reconectarse');

  console.log('\n12) La superficie HTTP, con los guardias globales puestos');
  const abierta = await video.crear('tunja', casoId, '3001234567', 'despachador1');
  const publica = await fetch(`http://127.0.0.1:${PUERTO}/videollamada/publico/${abierta.token}`);
  const cuerpo = (await publica.json()) as { valido?: boolean };
  afirmar(publica.status === 200 && cuerpo.valido === true,
    `el ciudadano valida su enlace SIN sesión (${publica.status})`);

  const caducado = await fetch(`http://127.0.0.1:${PUERTO}/videollamada/publico/token-inventado`);
  afirmar(caducado.status === 200 && ((await caducado.json()) as { valido?: boolean }).valido === false,
    'un enlace inventado responde que no vale, sin filtrarse por la puerta');

  const sinSesion = await fetch(`http://127.0.0.1:${PUERTO}/casos/${casoId}/videollamada/activa`);
  afirmar(sinSesion.status === 401,
    `lo demás del controlador SIGUE cerrado sin sesión (${sinSesion.status})`);

  afirmar(typeof (cuerpo as { token?: string }).token === 'string'
    && !!tokens.validar((cuerpo as { token?: string }).token as string),
    'y con la clave corta el servidor entrega el token de sala, firmado y válido');

  // Un SMS ya despachado no se puede retirar: el enlace con token de antes
  // tiene que seguir abriendo la llamada.
  const viejaForma = await fetch(`http://127.0.0.1:${PUERTO}/videollamada/publico/${abierta.token}`);
  afirmar(viejaForma.status === 200
    && ((await viejaForma.json()) as { valido?: boolean }).valido === true,
    'un enlace de los de antes (con el token en la URL) sigue funcionando');

  sDesp.disconnect();
  sIntruso.disconnect();
  await app.close();

  console.log(fallos.length === 0
    ? '\n────────── TODO EN VERDE ──────────'
    : `\n────────── ${fallos.length} FALLO(S) ──────────\n  - ${fallos.join('\n  - ')}`);
  return fallos.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
