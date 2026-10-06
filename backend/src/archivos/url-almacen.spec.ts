import { revisarUrlAlmacen } from './url-almacen';

const PAR = 'https://objectstorage.sa-x.oraclecloud.com/p/SECRETO/n/ESPACIO/b/falcon-grabaciones/o';

/**
 * El fallo que esto impide, y que ocurrió de verdad: la variable acabó con la
 * URL pegada DOS veces. El PUT funcionó, el GET de verificación también —los
 * dos usaban la misma ruta mal formada— y diez grabaciones se archivaron sin
 * perder un byte, pero con nombres como `https://objectstorage…/o/grabaciones/…`.
 * Ninguna comprobación del sistema lo notó; se vio mirando el cubo.
 */
describe('revisarUrlAlmacen', () => {
  it('acepta un PAR de cubo bien formado, con y sin barra final', () => {
    expect(revisarUrlAlmacen(PAR).ok).toBe(true);
    expect(revisarUrlAlmacen(PAR + '/').ok).toBe(true);
    expect(revisarUrlAlmacen(`  ${PAR}  `).ok).toBe(true);
  });

  it('RECHAZA la URL pegada dos veces, que es el fallo que ocurrió', () => {
    const r = revisarUrlAlmacen(`${PAR}/${PAR}`);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('más de una vez');
  });

  it('rechaza un PAR de objeto único: no termina en /o', () => {
    // Serviría para UNA grabación. Con el resto, el PUT iría a una ruta que el
    // PAR no cubre y el archivado fallaría grabación tras grabación.
    const r = revisarUrlAlmacen(`${PAR}/grabaciones/itagui/2026/10/abc.webm`);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('/o');
  });

  it('rechaza una URL que no es de solicitud previamente autenticada', () => {
    expect(revisarUrlAlmacen('https://objectstorage.sa-x.oraclecloud.com/n/E/b/B/o').ok).toBe(false);
  });

  it('rechaza algo que ni siquiera es una URL', () => {
    for (const malo of ['', '   ', 'no-soy-una-url', '/opt/falcon/objetos']) {
      expect(revisarUrlAlmacen(malo).ok).toBe(false);
    }
  });

  it('rechaza un esquema que no sea http(s)', () => {
    expect(revisarUrlAlmacen('ftp://objectstorage.sa-x.oraclecloud.com/p/S/n/E/b/B/o').ok).toBe(false);
  });

  it('todo rechazo dice POR QUÉ: un «no sirve» a secas no se puede arreglar', () => {
    for (const malo of ['no-soy-una-url', `${PAR}/${PAR}`, `${PAR}/x.webm`,
                        'https://objectstorage.sa-x.oraclecloud.com/n/E/b/B/o']) {
      expect(revisarUrlAlmacen(malo).motivo).not.toBe('');
    }
  });
});
