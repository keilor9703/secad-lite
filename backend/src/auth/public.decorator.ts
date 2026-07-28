import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca un handler/controlador como accesible sin JWT (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
