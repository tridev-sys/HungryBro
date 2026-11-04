import { readJsonWithLimit, enforceDeclaredLength, PayloadTooLargeError, BODY_LIMIT_BYTES } from '@/lib/http/body';

function streamOf(totalBytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024);
  return new ReadableStream({
    start(c) {
      let sent = 0;
      while (sent < totalBytes) {
        const n = Math.min(chunk.length, totalBytes - sent);
        c.enqueue(chunk.subarray(0, n));
        sent += n;
      }
      c.close();
    },
  });
}

test('limit is 64 KiB', () => {
  expect(BODY_LIMIT_BYTES).toBe(65536);
});

test('rejects a streamed body over the limit with no Content-Length (Review Focus 3)', async () => {
  const req = new Request('http://localhost/api/t', { method: 'POST', body: streamOf(65 * 1024), duplex: 'half' } as RequestInit);
  await expect(readJsonWithLimit(req)).rejects.toBeInstanceOf(PayloadTooLargeError);
});

test('accepts a JSON body at exactly the limit', async () => {
  const json = JSON.stringify({ s: 'a'.repeat(BODY_LIMIT_BYTES - 8) }); // 65536 bytes total
  expect(new TextEncoder().encode(json).length).toBe(BODY_LIMIT_BYTES);
  const req = new Request('http://localhost/api/t', { method: 'POST', body: json });
  expect(await readJsonWithLimit(req)).toEqual({ s: 'a'.repeat(BODY_LIMIT_BYTES - 8) });
});

test('declared Content-Length above the limit is refused before reading', () => {
  expect(() => enforceDeclaredLength(new Headers({ 'content-length': '70000' }))).toThrow(PayloadTooLargeError);
  expect(() => enforceDeclaredLength(new Headers({ 'content-length': '100' }))).not.toThrow();
  expect(() => enforceDeclaredLength(new Headers())).not.toThrow();
});
