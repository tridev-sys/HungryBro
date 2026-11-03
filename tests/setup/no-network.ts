// Test-only guard: any TCP connection or global fetch to a host other than
// loopback fails the run instead of reaching a real third-party endpoint.
import net from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function assertLoopback(host: string, kind: 'connection' | 'network fetch'): void {
  if (!LOOPBACK.has(host)) {
    throw new Error(`test attempted non-loopback ${kind} to ${host}`);
  }
}

const originalConnect = net.Socket.prototype.connect;
// net.Socket.prototype.connect accepts (options, cb), (port, host, cb), or (path).
net.Socket.prototype.connect = function patchedConnect(
  this: net.Socket,
  ...args: unknown[]
): net.Socket {
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    const opts = first as net.TcpSocketConnectOpts & { path?: string };
    if (!opts.path) assertLoopback(opts.host ?? 'localhost', 'connection');
  } else if (typeof first === 'number') {
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    assertLoopback(host, 'connection');
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(raw).hostname;
  assertLoopback(host, 'network fetch');
  return originalFetch(input, init);
}) as typeof fetch;
