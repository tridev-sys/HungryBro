import type { AllergenTag } from '@/types/food-os';

export const ALLERGEN_TAGS: readonly AllergenTag[] = ['peanut', 'shellfish', 'dairy', 'gluten'];

export function isAllergenSafe(item: { allergenTags: readonly string[] }, declared: readonly AllergenTag[]): boolean {
  return !item.allergenTags.some((t) => declared.includes(t as AllergenTag));
}

export function filterByAllergens<T extends { allergenTags: readonly string[] }>(
  items: readonly T[],
  declared: readonly AllergenTag[],
): T[] {
  return items.filter((i) => isAllergenSafe(i, declared));
}
