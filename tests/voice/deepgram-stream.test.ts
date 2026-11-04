import { createDeepgramStt, type DeepgramSocket } from '@/lib/voice/providers/deepgram';
import { vi } from 'vitest';

type Listener = (ev: { data?: unknown }) => void;

// Fake WebSocket transport: records what the adapter sends, and replays a scripted
// Deepgram session once the adapter sends CloseStream (the server then closes the socket).
class FakeDeepgramSocket implements DeepgramSocket {
  sent: Array<Uint8Array | string> = [];
  private listeners: Record<string, Listener[]> = {};
  constructor(private readonly script: Array<Record<string, unknown>>) {
    queueMicrotask(() => this.emit('open', {}));
  }
  send(data: Uint8Array | string): void {
    this.sent.push(data);
    if (typeof data === 'string' && JSON.parse(data).type === 'CloseStream') {
      for (const msg of this.script) this.emit('message', { data: JSON.stringify(msg) });
      queueMicrotask(() => this.emit('close', {}));
    }
  }
  close(): void {
    this.emit('close', {});
  }
  addEventListener(type: string, cb: Listener): void {
    (this.listeners[type] ??= []).push(cb);
  }
  private emit(type: string, ev: { data?: unknown }): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

function resultsMsg(transcript: string, isFinal: boolean, confidence = 0.9) {
  return {
    type: 'Results',
    is_final: isFinal,
    channel: { alternatives: [{ transcript, confidence }] },
  };
}

test('Deepgram streaming adapter opens the wss listen URL with nova-3 and the Token header', async () => {
  const openSocket = vi.fn((_url: string, _headers: Record<string, string>) => new FakeDeepgramSocket([]));
  const stt = createDeepgramStt({ apiKey: 'dg-test-key', openSocket });
  await stt.transcribe({ pcm16: new Uint8Array(4), sampleRate: 16000 });
  const [url, headers] = openSocket.mock.calls[0];
  expect(url.startsWith('wss://api.deepgram.com/v1/listen?')).toBe(true);
  const q = new URL(url).searchParams;
  expect(q.get('model')).toBe('nova-3');
  expect(q.get('encoding')).toBe('linear16');
  expect(q.get('sample_rate')).toBe('16000');
  expect(headers).toEqual({ Authorization: 'Token dg-test-key' });
});

test('Deepgram streaming adapter never uses the pre-recorded REST path or fetch', async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  try {
    const openSocket = vi.fn((_url: string, _headers: Record<string, string>) => new FakeDeepgramSocket([]));
    const stt = createDeepgramStt({ apiKey: 'dg-test-key', openSocket });
    await stt.transcribe({ pcm16: new Uint8Array(4), sampleRate: 16000 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSocket.mock.calls[0][0]).not.toContain('https://');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('Deepgram streaming adapter forwards the PCM audio in ordered chunks, then CloseStream', async () => {
  const sockets: FakeDeepgramSocket[] = [];
  const openSocket = (_url: string, _headers: Record<string, string>) => {
    const s = new FakeDeepgramSocket([resultsMsg('two naan', true)]);
    sockets.push(s);
    return s;
  };
  const stt = createDeepgramStt({ apiKey: 'dg-test-key', openSocket });
  const pcm = new Uint8Array(7000).map((_, i) => i % 251);
  await stt.transcribe({ pcm16: pcm, sampleRate: 16000 });
  const sent = sockets[0].sent;
  const binary = sent.filter((f): f is Uint8Array => f instanceof Uint8Array);
  expect(binary.map((b) => b.byteLength)).toEqual([3200, 3200, 600]);
  const joined = new Uint8Array(7000);
  let off = 0;
  for (const b of binary) {
    joined.set(b, off);
    off += b.byteLength;
  }
  expect(joined).toEqual(pcm);
  expect(JSON.parse(sent[sent.length - 1] as string)).toEqual({ type: 'CloseStream' });
});

test('Deepgram streaming adapter yields final transcript events and ignores interim ones', async () => {
  const openSocket = () =>
    new FakeDeepgramSocket([
      resultsMsg('two', false, 0.5),
      resultsMsg('two naan', true, 0.9),
      resultsMsg('', true, 0.0),
      resultsMsg('please', true, 0.8),
    ]);
  const stt = createDeepgramStt({ apiKey: 'dg-test-key', openSocket });
  const r = await stt.transcribe({ pcm16: new Uint8Array(4), sampleRate: 16000 });
  expect(r.text).toBe('two naan please');
  expect(r.confidence).toBeCloseTo((0.9 + 0.8) / 2, 5);
  expect(r.language).toBe('en');
});

test('Deepgram streaming adapter rejects when the socket errors and does not leak the key', async () => {
  const openSocket = (): DeepgramSocket => ({
    send: () => {},
    close: () => {},
    addEventListener: (type: string, cb: Listener) => {
      if (type === 'error') queueMicrotask(() => cb({}));
    },
  });
  const stt = createDeepgramStt({ apiKey: 'dg-test-key', openSocket });
  const err = await stt.transcribe({ pcm16: new Uint8Array(4), sampleRate: 16000 }).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect(String((err as Error).message)).not.toContain('dg-test-key');
});
