import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as tls from 'node:tls';

import { PlantaAsteriskEntity, urlAri } from './planta-asterisk.entity';
import {
  DIAS_AVISO_CERTIFICADO,
  FallaPlanta,
  hayQueAvisar,
  PlantaSaludEntity,
} from './planta-salud.entity';
import { PbxCredencialesService } from '../pbx-credenciales.service';
import { CorreoService } from '../../correo/correo.service';
import { plantillaAvisoPlanta } from '../../correo/plantillas';

/** Lo que se encontró al revisar una planta, antes de guardarlo. */
export interface RevisionPlanta {
  tenant: string;
  bien: boolean;
  fallas: FallaPlanta[];
  version: string | null;
  operadores: number;
  certificadoVence: Date | null;
  detalle: string;
}

/**
 * Cuánto se espera a cada comprobación.
 *
 * Corto a propósito: esto corre cada pocos minutos contra N plantas, y una
 * planta que tarda diez segundos en contestar ya está mal aunque conteste.
 */
const ESPERA_MS = 6000;

/**
 * REVISA QUE LAS PLANTAS ESTÉN VIVAS, Y AVISA CUANDO DEJAN DE ESTARLO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES PREGUNTAS, Y NINGUNA SE RESPONDE POR SSH
 *
 *  1. **¿Asterisk contesta?** Por ARI, entrando por el 443 de la planta.
 *  2. **¿La troncal está disponible?** También por ARI: si el endpoint de la
 *     troncal no está `online`, no entran llamadas aunque todo lo demás ande.
 *  3. **¿El certificado sigue vigente?** Un apretón de manos TLS contra el
 *     nombre de la planta.
 *
 * Las tres entran por el mismo camino que usa el navegador del operador. Es
 * deliberado: comprobar por un camino privilegiado que el operador no usa es
 * comprobar otra cosa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE SERVICIO NO HACE, Y NO ES OLVIDO
 *
 *  - **No reinicia nada.** Un monitoreo que arregla por su cuenta esconde el
 *    problema y repite el reinicio hasta que alguien mira. Avisa y para.
 *  - **No avisa mientras algo sigue roto.** Avisa cuando APARECE una falla.
 *    Un correo cada cinco minutos deja de leerse al tercero, y entonces el
 *    monitoreo empeora las cosas.
 *  - **No tumba nada si falla.** Una revisión que explota es una revisión
 *    perdida, no una planta caída.
 */
@Injectable()
export class PlantaSaludService {
  private readonly logger = new Logger(PlantaSaludService.name);

  /** A dónde va el aviso. El mismo buzón que los reportes de la mesa. */
  private readonly mesa = (
    process.env.SOPORTE_CORREO ?? 'soporte@falconcad.com.co'
  ).trim();

  constructor(
    @InjectRepository(PlantaAsteriskEntity)
    private readonly plantas: Repository<PlantaAsteriskEntity>,
    @InjectRepository(PlantaSaludEntity)
    private readonly salud: Repository<PlantaSaludEntity>,
    private readonly cred: PbxCredencialesService,
    private readonly correo: CorreoService,
  ) {}

  /**
   * Revisa todas las plantas que deberían estar atendiendo.
   *
   * Solo las `activa`: una en `borrador` todavía no existe en ningún servidor
   * y una `suspendida` está apagada a propósito. Avisar de esas sería ruido, y
   * el ruido es lo que hace que un monitoreo se deje de mirar.
   */
  async revisarTodas(): Promise<number> {
    const activas = await this.plantas.find({ where: { estado: 'activa' } });
    let revisadas = 0;
    for (const planta of activas) {
      try {
        await this.revisarYGuardar(planta);
        revisadas++;
      } catch (e) {
        // Una planta que explota no puede impedir que se revisen las demás.
        this.logger.error(
          `Revisión de «${planta.tenant}» falló: ${(e as Error)?.message}`,
        );
      }
    }
    return revisadas;
  }

  /** Revisa una planta, guarda el resultado y avisa si hay algo nuevo. */
  async revisarYGuardar(planta: PlantaAsteriskEntity): Promise<RevisionPlanta> {
    const revision = await this.revisar(planta);
    const anterior = await this.salud.findOne({
      where: { tenant: planta.tenant },
    });

    const ahora = new Date();
    const fila =
      anterior ?? this.salud.create({ tenant: planta.tenant, avisadoDe: [] });

    fila.bien = revision.bien;
    fila.fallas = revision.fallas;
    fila.version = revision.version;
    fila.operadores = revision.operadores;
    fila.certificadoVence = revision.certificadoVence;
    fila.detalle = revision.detalle;

    // `fallaDesde` se pone en la primera revisión mala y NO se toca mientras
    // siga mal: es lo que distingue «lleva dos minutos» de «lleva dos días».
    if (revision.bien) {
      fila.fallaDesde = null;
      fila.avisadoDe = [];
      fila.avisadoEn = null;
    } else if (!fila.fallaDesde) {
      fila.fallaDesde = ahora;
    }

    const avisar =
      !revision.bien && hayQueAvisar(revision.fallas, fila.avisadoDe ?? []);
    if (avisar) {
      fila.avisadoDe = revision.fallas;
      fila.avisadoEn = ahora;
    }

    await this.salud.save(fila);

    if (avisar) await this.avisar(planta, revision, fila.fallaDesde ?? ahora);
    return revision;
  }

  /** Las tres comprobaciones, sin tocar la base. */
  async revisar(planta: PlantaAsteriskEntity): Promise<RevisionPlanta> {
    const fallas: FallaPlanta[] = [];
    const detalle: string[] = [];
    let version: string | null = null;
    let operadores = 0;

    const clave = this.cred.enClaro(
      await this.cred.configDe(planta.tenant),
    ).ariClave;

    if (!clave) {
      // Sin credencial de ARI no se puede comprobar nada por ese camino. No es
      // una falla de la planta: es una planta que todavía no se ha aplicado.
      detalle.push('La planta no tiene clave de ARI: no se ha aplicado.');
      return {
        tenant: planta.tenant,
        bien: false,
        fallas: ['asterisk'],
        version: null,
        operadores: 0,
        certificadoVence: null,
        detalle: detalle.join(' '),
      };
    }

    // ── 1. ¿Asterisk contesta? ──────────────────────────────────────────
    const info = await this.ari<{ system?: { version?: string } }>(
      planta,
      clave,
      'asterisk/info',
    );
    if (!info.ok) {
      fallas.push('asterisk');
      detalle.push(`Asterisk no contesta por ARI: ${info.error}.`);
    } else {
      version = info.datos?.system?.version ?? null;
      detalle.push(`Asterisk ${version ?? 'sin versión'} responde.`);
    }

    // ── 2. ¿La troncal está disponible, y cuántos operadores hay? ───────
    // Solo tiene sentido preguntarlo si Asterisk contestó: si no, ya sabemos
    // la respuesta y una segunda espera de seis segundos no agrega nada.
    if (info.ok) {
      const puntos = await this.ari<
        Array<{ technology?: string; resource?: string; state?: string }>
      >(planta, clave, 'endpoints');
      if (!puntos.ok) {
        fallas.push('asterisk');
        detalle.push(`No se pudo listar los puntos: ${puntos.error}.`);
      } else {
        const lista = puntos.datos ?? [];
        const troncal = lista.find((p) => p.resource === 'troncal');
        if (!troncal) {
          fallas.push('troncal');
          detalle.push('La planta no tiene troncal configurada.');
        } else if (troncal.state !== 'online') {
          fallas.push('troncal');
          detalle.push(
            `La troncal está «${troncal.state}»: no entran llamadas.`,
          );
        } else {
          detalle.push('La troncal está disponible.');
        }
        operadores = lista.filter(
          (p) => p.resource !== 'troncal' && p.state === 'online',
        ).length;
        detalle.push(`${operadores} operador(es) con el softphone conectado.`);
      }
    }

    // ── 3. ¿El certificado sigue vigente? ───────────────────────────────
    const cert = await this.certificado(planta.dominioSip);
    if (cert.vence) {
      const dias = Math.floor((cert.vence.getTime() - Date.now()) / 86_400_000);
      if (dias < 0) {
        fallas.push('certificado-vencido');
        detalle.push(`El certificado venció hace ${-dias} día(s).`);
      } else if (dias <= DIAS_AVISO_CERTIFICADO) {
        fallas.push('certificado');
        detalle.push(`El certificado vence en ${dias} día(s).`);
      }
    } else {
      detalle.push(`No se pudo leer el certificado: ${cert.error}.`);
    }

    return {
      tenant: planta.tenant,
      bien: fallas.length === 0,
      fallas,
      version,
      operadores,
      certificadoVence: cert.vence,
      detalle: detalle.join(' '),
    };
  }

  /** Una consulta a ARI, por el 443 de la planta. Nunca lanza. */
  private async ari<T>(
    planta: PlantaAsteriskEntity,
    clave: string,
    ruta: string,
  ): Promise<{ ok: boolean; datos?: T; error?: string }> {
    const url = `${urlAri(planta)}/${ruta}`;
    const corte = AbortSignal.timeout(ESPERA_MS);
    try {
      const r = await fetch(url, {
        signal: corte,
        headers: {
          // ARI usa autenticación básica. La clave la generó FALCON y vive
          // cifrada: aquí se usa y no se registra en ningún log.
          Authorization:
            'Basic ' + Buffer.from(`falcon:${clave}`).toString('base64'),
        },
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, datos: (await r.json()) as T };
    } catch (e) {
      return { ok: false, error: motivo(e) };
    }
  }

  /**
   * Cuándo vence el certificado del nombre, por un apretón de manos TLS.
   *
   * No valida la cadena a propósito (`rejectUnauthorized: false`): lo que se
   * quiere saber es **cuándo vence el que está puesto**, y un certificado que
   * ya no valida igual tiene fecha. Si se rechazara, un certificado vencido
   * daría «error de conexión» en vez de «venció hace tres días», que es
   * justamente el dato que hace falta.
   */
  private async certificado(
    dominio: string,
  ): Promise<{ vence: Date | null; error?: string }> {
    return new Promise((resolver) => {
      let resuelto = false;
      const terminar = (r: { vence: Date | null; error?: string }) => {
        if (resuelto) return;
        resuelto = true;
        try {
          socket.destroy();
        } catch {
          /* ya estaba cerrado */
        }
        resolver(r);
      };

      const socket = tls.connect(
        {
          host: dominio,
          port: 443,
          servername: dominio,
          rejectUnauthorized: false,
          timeout: ESPERA_MS,
        },
        () => {
          const cert = socket.getPeerCertificate();
          const hasta = cert?.valid_to ? new Date(cert.valid_to) : null;
          terminar({
            vence: hasta && !Number.isNaN(hasta.getTime()) ? hasta : null,
            error: hasta ? undefined : 'el certificado no trae fecha',
          });
        },
      );
      socket.on('timeout', () =>
        terminar({ vence: null, error: 'sin respuesta' }),
      );
      socket.on('error', (e) => terminar({ vence: null, error: motivo(e) }));
    });
  }

  /** El correo a la mesa. Que no salga no puede tumbar la revisión. */
  private async avisar(
    planta: PlantaAsteriskEntity,
    revision: RevisionPlanta,
    desde: Date,
  ): Promise<void> {
    try {
      await this.correo.enviar({
        ...plantillaAvisoPlanta({
          tenant: planta.tenant,
          dominio: planta.dominioSip,
          servidor: planta.servidor,
          fallas: revision.fallas,
          detalle: revision.detalle,
          operadores: revision.operadores,
          desde,
        }),
        para: this.mesa,
      });
    } catch (e) {
      this.logger.error(
        `No se pudo avisar de «${planta.tenant}»: ${(e as Error)?.message}`,
      );
    }
  }

  /** La última revisión de una planta, para la pantalla. */
  async ultima(tenant: string): Promise<PlantaSaludEntity | null> {
    return this.salud.findOne({ where: { tenant } });
  }
}

/** El motivo de un fallo, en una línea y sin volcar el objeto entero. */
function motivo(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.length > 120 ? `${m.slice(0, 117)}…` : m;
}
