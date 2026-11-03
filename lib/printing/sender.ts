import net from 'node:net';

export class PrinterTimeoutError extends Error {}
export class PrinterUnreachableError extends Error {}

// Writes raw bytes to a network printer (port 9100 by default). Never retries: the caller decides.
// The timeout covers connect plus the full write flush.
export async function sendToPrinter(opts: {
  host: string;
  port?: number;
  bytes: Buffer;
  timeoutMs?: number;
}): Promise<void> {
  const { host, bytes } = opts;
  const port = opts.port ?? 9100;
  const timeoutMs = opts.timeoutMs ?? 3000;
  if (typeof host !== 'string' || host.length === 0 || /\s/.test(host)) {
    throw new TypeError('printer host must be a non-empty string without whitespace');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('printer port must be an integer between 1 and 65535');
  }

  await new Promise<void>((resolve, reject) => {
    let done = false;
    let connected = false;
    const socket = net.createConnection({ host, port });
    const settle = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(
      () => settle(new PrinterTimeoutError(`printer ${host}:${port} did not accept the job within ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once('connect', () => {
      connected = true;
      socket.end(bytes, () => settle());
    });
    socket.once('error', (err) => {
      settle(
        connected
          ? new Error(`printer ${host}:${port} write failed: ${err.message}`)
          : new PrinterUnreachableError(`printer ${host}:${port} unreachable: ${err.message}`),
      );
    });
  });
}
