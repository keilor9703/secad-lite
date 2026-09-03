import { Global, Module } from '@nestjs/common';
import { TenantRlsService } from './tenant-rls.service';

/** Utilidades compartidas por cualquier módulo, sin dependencias circulares. */
@Global()
@Module({
  providers: [TenantRlsService],
  exports: [TenantRlsService],
})
export class CommonModule {}
