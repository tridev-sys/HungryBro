import net from 'node:net';
import { sendToPrinter, PrinterTimeoutError, PrinterUnreachableError } from '@/lib/printing/sender';

function listen(onConn: (s: net.Socket) => void): Promise<{ srv: net.Server; port: number }> {
  return new Promise((resolve) => {
    const srv = net.createServer(onConn).listen(0, '127.0.0.1', () =>
      resolve({ srv, port: (srv.address() as net.AddressInfo).port }));
  });
}

test('writes the exact bytes to the printer port and resolves', async () => {
  const received: Buffer[] = [];
  const { srv, port } = await listen((s) => s.on('data', (d) => received.push(d)));
  const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
  await sendToPrinter({ host: '127.0.0.1', port, bytes, timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));
  srv.close();
  expect(Buffer.concat(received).equals(bytes)).toBe(true);
});

test('rejects with PrinterTimeoutError when the printer stops reading', async () => {
  const { srv, port } = await listen((s) => s.pause());
  const bytes = Buffer.alloc(64 * 1024 * 1024, 0x41);
  await expect(sendToPrinter({ host: '127.0.0.1', port, bytes, timeoutMs: 300 })).rejects.toThrow(PrinterTimeoutError);
  srv.close();
});

test('rejects with PrinterUnreachableError when nothing listens on the port', async () => {
  const probe = await listen(() => {});
  const closedPort = probe.port;
  await new Promise<void>((r) => probe.srv.close(() => r()));
  await expect(sendToPrinter({ host: '127.0.0.1', port: closedPort, bytes: Buffer.from('x'), timeoutMs: 1000 }))
    .rejects.toThrow(PrinterUnreachableError);
});

test('rejects invalid host and port without opening a socket', async () => {
  await expect(sendToPrinter({ host: '', bytes: Buffer.from('x') })).rejects.toThrow(TypeError);
  await expect(sendToPrinter({ host: '127.0.0.1', port: 70000, bytes: Buffer.from('x') })).rejects.toThrow(TypeError);
});
