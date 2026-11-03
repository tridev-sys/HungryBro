import { filterMenu, type MenuCard } from '@/lib/menu/filters';

const card = (over: Partial<MenuCard>): MenuCard => ({
  id: over.name ?? 'x', name: 'x', dietary: 'pure_veg', spiceLevel: 1, allergens: [], station: 'General', price: 100, ...over,
});
const menu: MenuCard[] = [
  card({ name: 'Paneer Tikka', dietary: 'jain', spiceLevel: 1, allergens: ['dairy'] }),
  card({ name: 'Peanut Chaat', dietary: 'pure_veg', spiceLevel: 2, allergens: ['peanut'] }),
  card({ name: 'Chicken Tikka', dietary: 'halal', spiceLevel: 3, allergens: ['dairy'] }),
  card({ name: 'Veg Pulao', dietary: 'vegan', spiceLevel: 0, allergens: [] }),
];
const none = { pureVeg: false, jain: false, halal: false, mildSpicy: false };
const names = (xs: MenuCard[]) => xs.map((x) => x.name);

test('no filter keeps the whole menu', () => {
  expect(names(filterMenu(menu, none, []))).toHaveLength(4);
});

test('Pure Veg matches pure_veg, jain and vegan', () => {
  expect(names(filterMenu(menu, { ...none, pureVeg: true }, []))).toEqual(['Paneer Tikka', 'Peanut Chaat', 'Veg Pulao']);
});

test('Jain and Halal are exact dietary matches', () => {
  expect(names(filterMenu(menu, { ...none, jain: true }, []))).toEqual(['Paneer Tikka']);
  expect(names(filterMenu(menu, { ...none, halal: true }, []))).toEqual(['Chicken Tikka']);
});

test('Mild Spicy keeps spice level 0 or 1', () => {
  expect(names(filterMenu(menu, { ...none, mildSpicy: true }, []))).toEqual(['Paneer Tikka', 'Veg Pulao']);
});

test('allergen exclusions remove matching items even when another filter passes them (spec: allergen data on menu_items)', () => {
  expect(names(filterMenu(menu, { ...none, pureVeg: true }, ['peanut']))).toEqual(['Paneer Tikka', 'Veg Pulao']);
  expect(names(filterMenu(menu, none, ['dairy']))).toEqual(['Peanut Chaat', 'Veg Pulao']);
});

test('enabled filters combine with AND', () => {
  expect(names(filterMenu(menu, { ...none, pureVeg: true, mildSpicy: true }, []))).toEqual(['Paneer Tikka', 'Veg Pulao']);
});
