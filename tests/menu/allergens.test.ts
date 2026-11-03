import { getPool, runMigrations } from '@/lib/db/client';
import { filterByAllergens, isAllergenSafe, ALLERGEN_TAGS } from '@/lib/menu/allergens';
import { makeRestaurant } from '../helpers/db';

const pool = getPool();

beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const menu = [
  { id: 'paneer', allergenTags: ['dairy'] },
  { id: 'dal', allergenTags: [] as string[] },
  { id: 'satay', allergenTags: ['peanut', 'gluten'] },
];

test('excludes items that contain a declared allergen', () => {
  expect(filterByAllergens(menu, ['peanut']).map((i) => i.id)).toEqual(['paneer', 'dal']);
});

test('no declared allergens keeps everything', () => {
  expect(filterByAllergens(menu, [])).toHaveLength(3);
});

test('multiple declared allergens exclude every match', () => {
  expect(filterByAllergens(menu, ['dairy', 'gluten']).map((i) => i.id)).toEqual(['dal']);
});

test('isAllergenSafe agrees with the filter', () => {
  expect(isAllergenSafe(menu[2], ['gluten'])).toBe(false);
  expect(isAllergenSafe(menu[1], ['dairy', 'peanut'])).toBe(true);
});

test('the four allergen tags are exactly those in the spec', () => {
  expect([...ALLERGEN_TAGS]).toEqual(['peanut', 'shellfish', 'dairy', 'gluten']);
});

test('tags read back from menu_items filter correctly (round trip)', async () => {
  const rid = await makeRestaurant(pool);
  await pool.query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, allergen_tags)
     VALUES ($1, 'S-1', 'Satay', 240, 'non_veg', ARRAY['peanut','gluten'])`, [rid]);
  const { rows } = await pool.query(
    `SELECT pos_item_code AS "id", allergen_tags AS "allergenTags" FROM menu_items WHERE restaurant_id = $1`, [rid]);
  expect(filterByAllergens(rows, ['peanut'])).toEqual([]);
});
