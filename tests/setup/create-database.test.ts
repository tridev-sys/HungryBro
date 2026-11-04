import { describe, expect, it } from 'vitest';
import { isTemplateBusy, withBusyRetry } from './create-database';

// The retry path is tested with a stub operation that fails with the template-busy error once,
// so no database is needed. Real CREATE DATABASE calls are covered by the suite's globalSetup.

const busy = () => Object.assign(new Error('source database "template1" is being accessed by other users'), { code: '55006' });

describe('template1 busy handling', () => {
  it('recognises SQLSTATE 55006 and the server message', () => {
    expect(isTemplateBusy(busy())).toBe(true);
    expect(isTemplateBusy(new Error('source database template1 is being accessed by other users'))).toBe(true);
    expect(isTemplateBusy(Object.assign(new Error('permission denied'), { code: '42501' }))).toBe(false);
    expect(isTemplateBusy(undefined)).toBe(false);
  });

  it('retries once after the busy error, logs the retry, and returns the result', async () => {
    let calls = 0;
    const logs: string[] = [];
    const sleeps: number[] = [];
    const result = await withBusyRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw busy();
        return 'created';
      },
      'CREATE DATABASE food_os_test_x',
      { log: (m) => logs.push(m), sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 250 },
    );
    expect(result).toBe('created');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([250]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('retrying');
  });

  it('rethrows other errors immediately without retrying', async () => {
    let calls = 0;
    const other = Object.assign(new Error('permission denied'), { code: '42501' });
    await expect(
      withBusyRetry(async () => { calls += 1; throw other; }, 'x', { sleep: async () => undefined, log: () => undefined }),
    ).rejects.toBe(other);
    expect(calls).toBe(1);
  });

  it('gives up after the bounded number of attempts and rethrows the busy error', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    await expect(
      withBusyRetry(async () => { calls += 1; throw busy(); }, 'x', {
        attempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 150,
        sleep: async (ms) => void sleeps.push(ms),
        log: () => undefined,
      }),
    ).rejects.toThrow(/being accessed by other users/);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 150]);
  });
});
