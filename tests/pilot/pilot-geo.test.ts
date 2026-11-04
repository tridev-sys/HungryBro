import { describe, expect, it } from 'vitest';
import { haversineKm, offsetByKm } from '@/lib/geo/distance';
import { generatePilotNodes, assertPilotSeedAllowed, PILOT_PRODUCTION_DB_NAME } from '@/lib/seed/pilot-geo';

const CENTRE = { lat: 12.9352, lng: 77.6245 }; // Koramangala-ish, only a test input
const OPEN = { PILOT_SEED_ENABLED: '1' };

describe('haversine and offset helpers', () => {
  it('offsetByKm moves a point by the requested distance', () => {
    for (const bearing of [0, 45, 90, 180, 270]) {
      const p = offsetByKm(CENTRE, 2.5, bearing);
      expect(haversineKm(CENTRE, p)).toBeCloseTo(2.5, 2);
    }
  });
});

describe('generatePilotNodes', () => {
  it('(a) produces 3 to 5 nodes, each 1.5 to 3.5 km from the centre', () => {
    const nodes = generatePilotNodes(CENTRE);
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.length).toBeLessThanOrEqual(5);
    for (const n of nodes) {
      const d = haversineKm(CENTRE, { lat: n.lat, lng: n.lng });
      expect(d).toBeGreaterThanOrEqual(1.5);
      expect(d).toBeLessThanOrEqual(3.5);
      expect(n.distanceKm).toBeCloseTo(d, 2);
    }
  });

  it('(a) is deterministic: the same centre gives the same nodes, a different centre gives different ones', () => {
    expect(generatePilotNodes(CENTRE)).toEqual(generatePilotNodes({ ...CENTRE }));
    expect(generatePilotNodes({ lat: 12.97, lng: 77.64 })).not.toEqual(generatePilotNodes(CENTRE));
  });

  it('marks every node as pilot data by name and slug, with unique identifiers', () => {
    const nodes = generatePilotNodes(CENTRE);
    for (const n of nodes) {
      expect(n.name).toContain('(Pilot Data)');
      expect(n.slug.startsWith('pilot-geo-')).toBe(true);
    }
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    expect(new Set(nodes.map((n) => n.fssai)).size).toBe(nodes.length);
  });

  it('works for any valid centre (a diner anywhere in India)', () => {
    for (const c of [{ lat: 28.6139, lng: 77.209 }, { lat: 19.076, lng: 72.8777 }]) {
      const nodes = generatePilotNodes(c);
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      for (const n of nodes) {
        const d = haversineKm(c, { lat: n.lat, lng: n.lng });
        expect(d).toBeGreaterThanOrEqual(1.5);
        expect(d).toBeLessThanOrEqual(3.5);
      }
    }
  });
});

describe('assertPilotSeedAllowed (safety guard)', () => {
  it('(b) refuses without PILOT_SEED_ENABLED=1', () => {
    expect(() => assertPilotSeedAllowed({}, 'food_os_test_abc123')).toThrow(/PILOT_SEED_ENABLED=1/);
    expect(() => assertPilotSeedAllowed({ PILOT_SEED_ENABLED: '0' }, 'food_os_test_abc123')).toThrow(/PILOT_SEED_ENABLED=1/);
    expect(() => assertPilotSeedAllowed({ PILOT_SEED_ENABLED: 'yes' }, 'food_os_test_abc123')).toThrow(/PILOT_SEED_ENABLED=1/);
  });

  it('(c) refuses when NODE_ENV=production unless PILOT_SEED_ALLOW_PROD=1 is also set', () => {
    expect(() => assertPilotSeedAllowed({ ...OPEN, NODE_ENV: 'production' }, 'food_os_test_abc123')).toThrow(/PILOT_SEED_ALLOW_PROD=1/);
    expect(() => assertPilotSeedAllowed({ ...OPEN, NODE_ENV: 'production', PILOT_SEED_ALLOW_PROD: '0' }, 'food_os_test_abc123')).toThrow(/PILOT_SEED_ALLOW_PROD=1/);
    expect(() => assertPilotSeedAllowed({ ...OPEN, NODE_ENV: 'production', PILOT_SEED_ALLOW_PROD: '1' }, 'food_os_test_abc123')).not.toThrow();
  });

  it('never seeds the production database, even with every override set', () => {
    expect(PILOT_PRODUCTION_DB_NAME).toBe('food_os');
    expect(() => assertPilotSeedAllowed({ ...OPEN }, 'food_os')).toThrow(/production database/);
    expect(() => assertPilotSeedAllowed({ ...OPEN, NODE_ENV: 'production', PILOT_SEED_ALLOW_PROD: '1' }, 'food_os')).toThrow(/production database/);
  });

  it('allows a per-run test database when enabled and not in production', () => {
    expect(() => assertPilotSeedAllowed({ ...OPEN, NODE_ENV: 'test' }, 'food_os_test_abc123')).not.toThrow();
  });
});
