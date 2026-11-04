import { LatLngSchema, type LatLng } from '@/types/food-os';

// Browser location for the delivery and dining screens. Pure mapping functions plus one wrapper
// around navigator.geolocation. Coordinates are only ever returned from a successful, valid
// browser fix; every other outcome leaves the screen to ask for manual entry.

export type LocationState =
  | { status: 'requesting' }
  | ({ status: 'located' } & LatLng)
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

/** Minimal shape of a GeolocationPosition, so tests can pass plain objects. */
export interface PositionLike {
  coords: { latitude: number; longitude: number };
}

/** Minimal shape of a GeolocationPositionError (code 1 denied, 2 unavailable, 3 timeout). */
export interface PositionErrorLike {
  code: number;
}

export function mapGeolocationSuccess(position: PositionLike): LocationState {
  const parsed = LatLngSchema.safeParse({ lat: position.coords.latitude, lng: position.coords.longitude });
  return parsed.success ? { status: 'located', lat: parsed.data.lat, lng: parsed.data.lng } : { status: 'unavailable' };
}

export function mapGeolocationError(error: PositionErrorLike): LocationState {
  if (error.code === 1) return { status: 'denied' };
  if (error.code === 3) return { status: 'timeout' };
  return { status: 'unavailable' };
}

type GeoLike = Pick<Geolocation, 'getCurrentPosition'>;

/**
 * Asks the browser once for the diner's position. Resolves to a LocationState and never rejects.
 * A browser that never calls back is cut off by our own timer (timeout), so the screen never hangs.
 */
export function requestBrowserLocation(geo: GeoLike | undefined, timeoutMs = 10_000): Promise<LocationState> {
  if (!geo || typeof geo.getCurrentPosition !== 'function') return Promise.resolve({ status: 'unavailable' });
  return new Promise<LocationState>((resolve) => {
    let settled = false;
    const finish = (state: LocationState) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(state);
    };
    const guard = setTimeout(() => finish({ status: 'timeout' }), timeoutMs + 500);
    try {
      geo.getCurrentPosition(
        (position) => finish(mapGeolocationSuccess(position)),
        (error) => finish(mapGeolocationError(error)),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch {
      finish({ status: 'unavailable' });
    }
  });
}
