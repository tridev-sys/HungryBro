// Fictional test restaurants for the pilot areas (Indiranagar and HSR). Not real brands.
// Koramangala is not seeded in v1 (tech decisions, decision 6).

export interface SeedRestaurant {
  id: string;
  slug: string;
  name: string;
  area: 'Indiranagar' | 'HSR';
  lat: number;
  lng: number;
  fssai: string;
  gstin: string;
  tables: string[];
}

export interface SeedItem {
  code: string;
  name: string;
  station: 'Tandoor' | 'Curry' | 'Pantry' | 'Bar' | 'General';
  dietary: 'pure_veg' | 'jain' | 'halal' | 'non_veg' | 'vegan' | 'egg';
  basePrice: number;
}

/** Fixed UUID: 00000000-0000-4000-8000-<4-digit restaurant n><8-digit k>. k = 0 for the restaurant. */
export function fixedUuid(n: number, k: number): string {
  const tail = `${String(n).padStart(4, '0')}${String(k).padStart(8, '0')}`;
  return `00000000-0000-4000-8000-${tail}`;
}

const TABLES = ['01', '02', '03', '04'];

export const FIXTURE_RESTAURANTS: SeedRestaurant[] = [
  { id: fixedUuid(1, 0), slug: 'seed-indiranagar-1', name: 'Seed Indiranagar Kitchen One', area: 'Indiranagar', lat: 12.9716, lng: 77.6412, fssai: '20000000000001', gstin: '29AAAAA0000A1Z5', tables: TABLES },
  { id: fixedUuid(2, 0), slug: 'seed-indiranagar-2', name: 'Seed Indiranagar Kitchen Two', area: 'Indiranagar', lat: 12.9760, lng: 77.6360, fssai: '20000000000002', gstin: '29BBBBB0000B1Z5', tables: TABLES },
  { id: fixedUuid(3, 0), slug: 'seed-hsr-1', name: 'Seed HSR Kitchen One', area: 'HSR', lat: 12.9121, lng: 77.6446, fssai: '20000000000003', gstin: '29CCCCC0000C1Z5', tables: TABLES },
  { id: fixedUuid(4, 0), slug: 'seed-hsr-2', name: 'Seed HSR Kitchen Two', area: 'HSR', lat: 12.9150, lng: 77.6390, fssai: '20000000000004', gstin: '29DDDDD0000D1Z5', tables: TABLES },
];

/** Category ids per restaurant: fixedUuid(n, 1..4) in the order of CATEGORIES. */
export const CATEGORIES: { k: number; name: string; station: SeedItem['station'] }[] = [
  { k: 1, name: 'Tandoor & Breads', station: 'Tandoor' },
  { k: 2, name: 'Curries', station: 'Curry' },
  { k: 3, name: 'Salads', station: 'Pantry' },
  { k: 4, name: 'Drinks', station: 'Bar' },
];

export const FIXTURE_ITEMS: Record<string, SeedItem> = {
  paneerTikka: { code: 'IND1-PNR-TIKKA', name: 'Paneer Tikka', station: 'Tandoor', dietary: 'jain', basePrice: 320 },
  chickenBiryani: { code: 'IND1-CHK-BIRYANI', name: 'Chicken Biryani', station: 'Curry', dietary: 'halal', basePrice: 340 },
  seekhKebab: { code: 'IND1-SEEKH-KEBAB', name: 'Seekh Kebab', station: 'Tandoor', dietary: 'halal', basePrice: 280 },
  dalTadka: { code: 'IND1-DAL-TADKA', name: 'Dal Tadka', station: 'Curry', dietary: 'pure_veg', basePrice: 220 },
  gardenSalad: { code: 'IND1-GARDEN-SALAD', name: 'Garden Salad', station: 'Pantry', dietary: 'pure_veg', basePrice: 150 },
  freshLimeSoda: { code: 'IND1-LIME-SODA', name: 'Fresh Lime Soda', station: 'Bar', dietary: 'pure_veg', basePrice: 120 },
};

/**
 * Delivery drop point for the E2E spec. Placeholder midway between the Indiranagar and HSR clusters,
 * within the 6 km transit radius of all four seeded kitchens.
 * OWNER TO SET a real address.
 */
export const DROP = { lat: 12.9420, lng: 77.6430 };
