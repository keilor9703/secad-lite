import { Repository } from 'typeorm';
import { ConfigPbxEntity } from './config-pbx.entity';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { cifrar } from '../common/secretos';
import { descriptor } from './proveedores/registro';

/**
 * Las credenciales de la planta: leerlas, descifrarlas, guardarlas.
 *
 * Aquí vive el cifrado, y por eso aquí se prueba. Lo que se protege:
 *
 *  - que lo marcado como secreto en el descriptor se cifre, y lo demás no
 *    (si `key` se cifrara, no se podría volver a mostrar en pantalla; si
 *    `secreto` no se cifrara, estaría en claro en la base);
 *  - que un campo que no viene en el formulario no se borre;
 *  - que una llave de cifrado cambiada no tumbe la telefonía, sino que deje
 *    el campo vacío —y con eso el aviso se rechaza con su motivo, que es lo
 *    correcto: sin secreto no se puede verificar nada.
 */
describe('PbxCredencialesService', () => {
  const ZADARMA = descriptor('ZADARMA')!;
  let svc: PbxCredencialesService;

  const fila = (credenciales: Record<string, string>, proveedor = 'ZADARMA') =>
    ({ tenant: 'itagui', proveedor, credenciales: JSON.stringify(credenciales) }) as ConfigPbxEntity;

  beforeEach(() => {
    process.env.JWT_SECRET = 'llave-de-prueba';
    svc = new PbxCredencialesService({} as unknown as Repository<ConfigPbxEntity>);
  });

  describe('leer', () => {
    it('descifra lo secreto y deja lo demás tal cual', () => {
      const f = fila({ key: '71278d8e6746cb220a36', secreto: cifrar('s3cr3t0', 'llave-de-prueba') });

      expect(svc.enClaro(f)).toEqual({ key: '71278d8e6746cb220a36', secreto: 's3cr3t0' });
    });

    it('si la llave de cifrado cambió, ese campo sale VACÍO en vez de reventar', () => {
      // Vacío hace que la verificación falle y el webhook rechace con su
      // motivo. Reventar dejaría a la central reintentando contra un 500.
      const f = fila({ key: 'k', secreto: cifrar('s3cr3t0', 'llave-vieja') });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const c = svc.enClaro(f);

      expect(c.secreto).toBeUndefined();
      expect(c.key).toBe('k');
    });

    it('un JSON corrupto no tumba la telefonía de la instancia', () => {
      const f = { tenant: 'itagui', proveedor: 'ZADARMA', credenciales: '{roto' } as ConfigPbxEntity;
      expect(svc.enClaro(f)).toEqual({});
    });

    it('sin fila no hay credenciales, y sin proveedor conocido tampoco', () => {
      expect(svc.enClaro(null)).toEqual({});
      expect(svc.enClaro(fila({ key: 'k' }, 'TWILIO'))).toEqual({});
    });

    it('un campo que el proveedor no declara se ignora al leer', () => {
      // Quedan de otro proveedor, o de una versión anterior: son inertes.
      expect(svc.enClaro(fila({ key: 'k', sobrante: 'x' }))).toEqual({ key: 'k' });
    });

    it('sin fila, el proveedor es el de por defecto', () => {
      expect(svc.claveProveedor(null)).toBe('YACO');
    });
  });

  describe('guardar', () => {
    it('cifra lo que el descriptor marca como secreto, y solo eso', () => {
      const r = svc.mezclar(ZADARMA, {}, { key: 'K', secreto: 'S' });

      expect(r.key).toBe('K');
      expect(r.secreto).not.toBe('S');
      expect(r.secreto).toContain('enc1:');
    });

    it('lo que no viene en el formulario no se toca', () => {
      // El formulario nunca recibe el secreto, así que no puede reenviarlo:
      // sin esta regla, cambiar la key lo borraría sin avisar.
      const guardadas = { key: 'vieja', secreto: cifrar('S', 'llave-de-prueba') };

      const r = svc.mezclar(ZADARMA, guardadas, { key: 'nueva' });

      expect(r.key).toBe('nueva');
      expect(r.secreto).toBe(guardadas.secreto);
    });

    it('un campo mandado vacío sí se borra: es un borrado explícito', () => {
      const r = svc.mezclar(ZADARMA, { key: 'k', secreto: 'cifrado' }, { key: '' });

      expect(r.key).toBeUndefined();
      expect(r.secreto).toBe('cifrado');
    });

    it('un campo que el proveedor no declara no se guarda', () => {
      // Así un formulario manipulado no mete basura —ni credenciales de otro
      // proveedor— en la fila.
      const r = svc.mezclar(ZADARMA, {}, { inventado: 'x' });
      expect(r).toEqual({});
    });

    it('las credenciales de OTRO proveedor se conservan al mezclar', () => {
      // Quien pasa de un proveedor a otro y vuelve no tiene que volver a
      // teclear sus llaves. Son inertes mientras ese proveedor no esté puesto.
      const r = svc.mezclar(ZADARMA, { tokenDeOtro: 'abc' }, { key: 'k' });
      expect(r.tokenDeOtro).toBe('abc');
    });

    it('lo cifrado se puede volver a leer: el ciclo cierra', () => {
      const guardadas = svc.mezclar(ZADARMA, {}, { key: 'k', secreto: 's3cr3t0' });

      expect(svc.enClaro(fila(guardadas)).secreto).toBe('s3cr3t0');
    });
  });
});
