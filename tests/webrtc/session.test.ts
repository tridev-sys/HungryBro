import { createVoiceSession } from '@/lib/webrtc/session';
import { FakeTransport } from '@/lib/webrtc/fake-transport';

test('start moves idle to connecting to live and publishes the mic', async () => {
  const t = new FakeTransport();
  const s = createVoiceSession(t);
  expect(s.status).toBe('idle');
  await s.start('wss://example.livekit.cloud', 'token');
  expect(s.status).toBe('live');
  expect(t.connects).toBe(1);
});

test('level follows transport level events', async () => {
  const t = new FakeTransport();
  const s = createVoiceSession(t);
  await s.start('wss://x', 'token');
  t.emitLevel(0.4);
  expect(s.level).toBeCloseTo(0.4);
});

test('a failed connect sets status to error with the message', async () => {
  const t = new FakeTransport();
  t.failNextConnect('mic permission denied');
  const s = createVoiceSession(t);
  await s.start('wss://x', 'token');
  expect(s.status).toBe('error');
  expect(s.error).toBe('mic permission denied');
});

test('stop disconnects, resets level, and notifies subscribers', async () => {
  const t = new FakeTransport();
  const s = createVoiceSession(t);
  let notified = 0;
  s.subscribe(() => notified++);
  await s.start('wss://x', 'token');
  t.emitLevel(0.6);
  await s.stop();
  expect(t.disconnects).toBe(1);
  expect(s.status).toBe('idle');
  expect(s.level).toBe(0);
  expect(notified).toBeGreaterThan(2);
});
