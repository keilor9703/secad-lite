import { resolverIpCliente } from './ip-cliente.decorator';

describe('resolverIpCliente', () => {
  it('usa CF-Connecting-IP cuando la conexión directa viene de un borde de Cloudflare', () => {
    const ip = resolverIpCliente({
      socket: { remoteAddress: '108.162.212.211' }, // borde real de Cloudflare
      headers: { 'cf-connecting-ip': '200.75.10.50' }, // IP del visitante, según Cloudflare
      ip: '108.162.212.211', // lo que req.ip (trust proxy=1) resolvió mal
    });
    expect(ip).toBe('200.75.10.50');
  });

  it('ignora CF-Connecting-IP si alguien le habla directo al backend (no es un borde de Cloudflare)', () => {
    const ip = resolverIpCliente({
      socket: { remoteAddress: '203.0.113.7' }, // cualquiera, no Cloudflare
      headers: { 'cf-connecting-ip': '1.2.3.4' }, // inventada por el atacante
      ip: '203.0.113.7',
    });
    expect(ip).toBe('203.0.113.7'); // no se confía en la cabecera falsa
  });

  it('sin CF-Connecting-IP (dev local, u otro despliegue sin Cloudflare) cae a req.ip', () => {
    const ip = resolverIpCliente({
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
      ip: '127.0.0.1',
    });
    expect(ip).toBe('127.0.0.1');
  });

  it('si la conexión directa es de Cloudflare pero sin la cabecera, cae a req.ip', () => {
    const ip = resolverIpCliente({
      socket: { remoteAddress: '104.22.86.40' },
      headers: {},
      ip: '104.22.86.40',
    });
    expect(ip).toBe('104.22.86.40');
  });

  it('toma la IPv4 mapeada en IPv6 del socket (::ffff:x.x.x.x), típica de Node', () => {
    const ip = resolverIpCliente({
      socket: { remoteAddress: '::ffff:172.71.156.213' },
      headers: { 'cf-connecting-ip': '200.75.10.50' },
      ip: '172.71.156.213',
    });
    expect(ip).toBe('200.75.10.50');
  });
});
