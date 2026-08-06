import { SetMetadata } from '@nestjs/common';

export const INTEGRACION_KEY = 'integracion';

/**
 * Marca un módulo como parte de una integración contratable (pbx, whatsapp,
 * api). SuscripcionGuard lo rechaza si el tenant no la tiene habilitada: es la
 * palanca comercial de cada módulo.
 */
export const RequiereIntegracion = (clave: string) => SetMetadata(INTEGRACION_KEY, clave);
