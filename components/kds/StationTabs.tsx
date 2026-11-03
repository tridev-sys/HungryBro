import type { StationCategory } from '@/types/food-os';
import { stationLabel } from '@/lib/kds/labels';
import { FilterChip } from '@/components/ui/FilterChip';

export type StationFilter = StationCategory | 'ALL';

const STATIONS: StationCategory[] = ['Tandoor', 'Curry', 'Pantry', 'Bar', 'General'];

export interface StationTabsProps {
  value: StationFilter;
  onChange: (next: StationFilter) => void;
}

export function StationTabs({ value, onChange }: StationTabsProps) {
  return (
    <div role="tablist" aria-label="Stations" className="flex flex-wrap gap-2">
      <FilterChip label="All" pressed={value === 'ALL'} onToggle={() => onChange('ALL')} />
      {STATIONS.map((s) => (
        <FilterChip key={s} label={stationLabel(s)} pressed={value === s} onToggle={() => onChange(s)} />
      ))}
    </div>
  );
}
