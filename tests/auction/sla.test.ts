import {
  MAX_SLA_MINUTES,
  SLA_BUFFER_MINUTES,
  TRANSIT_ESTIMATE_MINUTES,
  maxPrepMinutes,
  withinSla,
} from '@/lib/auction/sla';

test('the delivery SLA is under 30 minutes with a 3 minute buffer', () => {
  expect(MAX_SLA_MINUTES).toBe(30);
  expect(SLA_BUFFER_MINUTES).toBe(3);
  expect(TRANSIT_ESTIMATE_MINUTES).toBe(12);
  expect(maxPrepMinutes()).toBe(15);
});

test('a kitchen exactly on the limit is included (prep + transit + buffer = 30)', () => {
  expect(withinSla(15)).toBe(true);
});

test('a kitchen just over the limit is excluded (16 + 12 + 3 = 31)', () => {
  expect(withinSla(16)).toBe(false);
});

test('a kitchen just under the limit is included (14 + 12 + 3 = 29)', () => {
  expect(withinSla(14)).toBe(true);
});

test('the limit and buffer can be overridden', () => {
  expect(withinSla(22, 5, { maxSlaMinutes: 30, bufferMinutes: 3 })).toBe(true);
  expect(withinSla(23, 5, { maxSlaMinutes: 30, bufferMinutes: 3 })).toBe(false);
});
