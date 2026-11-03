import type { AllergenTag, DietaryClassification, SpiceLevel } from '@/types/food-os';
import { isAllergenSafe } from './allergens';

export interface MenuCard {
  id: string;
  name: string;
  dietary: DietaryClassification;
  spiceLevel: SpiceLevel;
  allergens: AllergenTag[];
  station: string;
  price: number;
}

export interface FilterState {
  pureVeg: boolean;
  jain: boolean;
  halal: boolean;
  mildSpicy: boolean;
}

function matches(item: MenuCard, f: FilterState): boolean {
  if (f.pureVeg && !['pure_veg', 'jain', 'vegan'].includes(item.dietary)) return false;
  if (f.jain && item.dietary !== 'jain') return false;
  if (f.halal && item.dietary !== 'halal') return false;
  if (f.mildSpicy && item.spiceLevel > 1) return false;
  return true;
}

/** Allergen exclusions remove an item regardless of the other filters; enabled filters combine with AND. */
export function filterMenu(items: MenuCard[], filters: FilterState, exclusions: AllergenTag[]): MenuCard[] {
  return items.filter((item) =>
    isAllergenSafe({ allergenTags: item.allergens }, exclusions) && matches(item, filters));
}
