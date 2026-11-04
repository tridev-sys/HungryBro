import { describe, expect, it, vi } from 'vitest';
import { mapGeolocationError, mapGeolocationSuccess, requestBrowserLocation } from '@/lib/location/browser-location';

describe('mapGeolocationSuccess / mapGeolocationError', () => {
  it('maps a valid position to located', () => {
    expect(mapGeolocationSuccess({ coords: { latitude: 12.9, longitude: 77.6 } })).toEqual({ status: 'located', lat: 12.9, lng: 77.6 });
  });

  it('maps an out-of-range position to unavailable (never sends it)', () => {
    expect(mapGeolocationSuccess({ coords: { latitude: 123, longitude: 77.6 } })).toEqual({ status: 'unavailable' });
    expect(mapGeolocationSuccess({ coords: { latitude: Number.NaN, longitude: 77.6 } })).toEqual({ status: 'unavailable' });
  });

  it('maps the GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout', () => {
    expect(mapGeolocationError({ code: 1 })).toEqual({ status: 'denied' });
    expect(mapGeolocationError({ code: 2 })).toEqual({ status: 'unavailable' });
    expect(mapGeolocationError({ code: 3 })).toEqual({ status: 'timeout' });
    expect(mapGeolocationError({ code: 99 })).toEqual({ status: 'unavailable' });
  });
});

describe('requestBrowserLocation', () => {
  it('is unavailable when the browser has no geolocation API', async () => {
    await expect(requestBrowserLocation(undefined)).resolves.toEqual({ status: 'unavailable' });
  });

  it('resolves located on success', async () => {
    const geo = { getCurrentPosition: vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 12.97, longitude: 77.64 } } as GeolocationPosition)) };
    await expect(requestBrowserLocation(geo as unknown as Geolocation)).resolves.toEqual({ status: 'located', lat: 12.97, lng: 77.64 });
  });

  it('resolves denied when the user refuses, and passes a bounded timeout to the browser', async () => {
    const geo = { getCurrentPosition: vi.fn((_ok: PositionCallback, err: PositionErrorCallback, _opts?: PositionOptions) => err({ code: 1 } as GeolocationPositionError)) };
    await expect(requestBrowserLocation(geo as unknown as Geolocation, 5000)).resolves.toEqual({ status: 'denied' });
    expect(geo.getCurrentPosition.mock.calls[0][2]).toMatchObject({ timeout: 5000 });
  });

  it('resolves timeout when the browser never answers', async () => {
    vi.useFakeTimers();
    try {
      const geo = { getCurrentPosition: vi.fn() };
      const pending = requestBrowserLocation(geo as unknown as Geolocation, 1000);
      await vi.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toEqual({ status: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves unavailable when the API throws synchronously', async () => {
    const geo = { getCurrentPosition: () => { throw new Error('boom'); } };
    await expect(requestBrowserLocation(geo as unknown as Geolocation)).resolves.toEqual({ status: 'unavailable' });
  });
});
