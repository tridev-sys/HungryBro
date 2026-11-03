import net from 'node:net';

test('guard blocks a non-loopback TCP connection', () => {
  const s = new net.Socket();
  s.on('error', () => {});
  expect(() => s.connect({ host: 'example.com', port: 80 })).toThrow(/non-loopback/);
});

test('guard blocks a non-loopback fetch', async () => {
  await expect(fetch('https://api.razorpay.com/v1/orders')).rejects.toThrow(/network fetch/);
});

test('guard allows loopback', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  const s = net.createConnection({ host: '127.0.0.1', port });
  await new Promise<void>((r) => s.once('connect', () => r()));
  s.destroy();
  srv.close();
});
