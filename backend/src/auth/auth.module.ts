import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { RolesModule } from '../roles/roles.module';
import { TenantsModule } from '../tenants/tenants.module';

/** Valores que jamás pueden firmar sesiones en un despliegue publicado. */
const SECRETOS_DE_DESARROLLO = ['dev-secret', 'cambia-este-secreto-en-produccion'];

/**
 * Con qué se firman los JWT. Quien firme tokens controla todas las sesiones
 * (incluida la del superadmin), así que en producción un secreto ausente o de
 * ejemplo no se suple en silencio: el proceso se niega a arrancar, igual que
 * ya ocurre sin DATABASE_URL.
 */
function resolverSecreto(config: ConfigService): string {
  const secreto = config.get<string>('JWT_SECRET')?.trim();
  const inseguro = !secreto || SECRETOS_DE_DESARROLLO.includes(secreto);
  if (inseguro && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET no está configurado (o conserva el valor de ejemplo). ' +
        'Defina un secreto largo y aleatorio en las variables de entorno antes de publicar.',
    );
  }
  return secreto || 'dev-secret';
}

@Module({
  imports: [
    AuditoriaModule,
    UsuariosModule,
    RolesModule,
    TenantsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolverSecreto(config),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES', '8h') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
