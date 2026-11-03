import { EnergyVad, rms } from '@/lib/voice/vad/energy';
import { SileroVad } from '@/lib/voice/vad/silero';
import { selectVad } from '@/lib/voice/vad/select';

test('rms of silence is 0 and of a 0.5 amplitude frame is 0.5', () => {
  expect(rms(new Float32Array(160))).toBe(0);
  expect(rms(new Float32Array(160).fill(0.5))).toBeCloseTo(0.5);
  expect(rms(new Float32Array(160).fill(3))).toBe(1);
});

test('EnergyVad detects speech above threshold and reports level', () => {
  const vad = new EnergyVad({ threshold: 0.02 });
  expect(vad.process(new Float32Array(160))).toEqual({ speech: false, level: 0 });
  const loud = vad.process(new Float32Array(160).fill(0.5));
  expect(loud.speech).toBe(true);
  expect(loud.level).toBeCloseTo(0.5);
});

test('SileroVad takes speech from model probability and level from RMS', async () => {
  const vad = new SileroVad({ loadModel: async () => ({ process: async () => 0.9 }) });
  await vad.ready();
  const frame = new Float32Array(160).fill(0.2);
  const r = vad.process(frame);
  expect(r.speech).toBe(true);
  expect(r.level).toBeCloseTo(0.2);
});

test('selectVad falls back to energy when Silero is not preferred or not loadable', () => {
  expect(selectVad({ preferSilero: false }).name).toBe('energy');
  expect(selectVad({ preferSilero: true }).name).toBe('energy');
  expect(selectVad({ preferSilero: true, loadModel: async () => ({ process: async () => 0 }) }).name).toBe('silero');
});
