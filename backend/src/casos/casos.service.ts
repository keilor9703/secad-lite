import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Caso, CANALES, ESTADOS } from './caso.model';
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';

/**
 * Almacén de casos en memoria (mock del esqueleto). Todo está aislado por
 * `tenant`: cada municipio ve solo sus casos. En producción esto se reemplaza
 * por el repositorio real (PostgreSQL pooled con filtro por tenant), sin cambiar
 * la interfaz del servicio.
 */
@Injectable()
export class CasosService {
  private casos: Caso[] = [];
  private seq = 0;

  constructor() {
    this.seed();
  }

  listar(tenant: string): Caso[] {
    return this.casos
      .filter((c) => c.tenant === tenant)
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }

  obtener(tenant: string, id: string): Caso {
    const caso = this.casos.find((c) => c.tenant === tenant && c.id === id);
    if (!caso) throw new NotFoundException('Caso no encontrado.');
    return caso;
  }

  crear(tenant: string, dto: CrearCasoDto, usuario: string): Caso {
    if (!dto?.titulo?.trim()) throw new BadRequestException('El título es obligatorio.');
    if (!dto?.ciudadano?.trim()) throw new BadRequestException('El ciudadano es obligatorio.');
    if (!CANALES.includes(dto.canal)) throw new BadRequestException('Canal inválido.');

    const ahora = new Date().toISOString();
    const caso: Caso = {
      id: `C-${String(++this.seq).padStart(4, '0')}`,
      tenant,
      canal: dto.canal,
      titulo: dto.titulo.trim(),
      descripcion: dto.descripcion?.trim() ?? '',
      ciudadano: dto.ciudadano.trim(),
      telefono: dto.telefono?.trim() || undefined,
      agencia: dto.agencia?.trim() || 'Central',
      estado: 'nuevo',
      creadoPor: usuario,
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    this.casos.push(caso);
    return caso;
  }

  cambiarEstado(tenant: string, id: string, dto: CambiarEstadoDto): Caso {
    const caso = this.obtener(tenant, id);
    if (!ESTADOS.includes(dto.estado)) throw new BadRequestException('Estado inválido.');
    if (dto.estado === 'derivado' && !dto.agencia?.trim()) {
      throw new BadRequestException('Para derivar se requiere la agencia destino.');
    }
    caso.estado = dto.estado;
    if (dto.estado === 'derivado') caso.agencia = dto.agencia!.trim();
    caso.actualizadoEn = new Date().toISOString();
    return caso;
  }

  private seed(): void {
    const base = [
      { canal: 'llamada', titulo: 'Riña en vía pública', ciudadano: 'María Gómez', telefono: '3001112233', agencia: 'Policía', estado: 'nuevo' },
      { canal: 'chat', titulo: 'Reporte de semáforo dañado', ciudadano: 'Carlos Ruiz', agencia: 'Tránsito', estado: 'en_gestion' },
      { canal: 'integracion', titulo: 'Alarma activada — comercio', ciudadano: 'Sistema Alarmas', agencia: 'Policía', estado: 'nuevo' },
    ] as const;

    const t0 = Date.now();
    base.forEach((b, i) => {
      const ts = new Date(t0 - (base.length - i) * 6 * 60000).toISOString();
      this.casos.push({
        id: `C-${String(++this.seq).padStart(4, '0')}`,
        tenant: 'demo',
        canal: b.canal,
        titulo: b.titulo,
        descripcion: '',
        ciudadano: b.ciudadano,
        telefono: 'telefono' in b ? b.telefono : undefined,
        agencia: b.agencia,
        estado: b.estado,
        creadoPor: 'seed',
        creadoEn: ts,
        actualizadoEn: ts,
      });
    });
  }
}
