import { encodeGeohash, decodeGeohashCenter, geohashNeighbors, geohashBlock, meshChannel, auctionEventsChannel } from '@/lib/mesh/geohash';

test('encodes the standard reference point (42.6, -5.6) to ezs42 at precision 5', () => {
  expect(encodeGeohash({ lat: 42.6, lng: -5.6 }, 5)).toBe('ezs42');
});

test('decoded centre of a cell lies within the cell', () => {
  const c = decodeGeohashCenter('ezs42');
  expect(Math.abs(c.lat - 42.6)).toBeLessThan(0.05);
  expect(Math.abs(c.lng - (-5.6))).toBeLessThan(0.05);
});

test('a Bengaluru point encodes to a 5-character base32 cell', () => {
  const cell = encodeGeohash({ lat: 12.9716, lng: 77.6412 });
  expect(cell).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/);
});

test('neighbours are 8 distinct cells, excluding the origin', () => {
  const n = geohashNeighbors('ezs42');
  expect(n).toHaveLength(8);
  expect(new Set(n).size).toBe(8);
  expect(n).not.toContain('ezs42');
});

test('the 3x3 block contains a point 4 km north of the origin cell centre', () => {
  const origin = decodeGeohashCenter('ezs42');
  const north = { lat: origin.lat + 0.036, lng: origin.lng };
  expect(geohashBlock('ezs42')).toContain(encodeGeohash(north));
});

test('channel names follow the PDF pattern', () => {
  expect(meshChannel('tdr1v')).toBe('mesh:auction:tdr1v');
  expect(auctionEventsChannel('a1')).toBe('mesh:auction:events:a1');
});
