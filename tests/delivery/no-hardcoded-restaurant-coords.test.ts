import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Owner requirement: delivery must not use hardcoded restaurant or diner locations. The screen asks
// the browser for live coordinates through the location helper, and falls back to manual entry.
const ROOT = path.resolve(__dirname, '..', '..');
const DELIVERY_DIR = path.join(ROOT, 'app', 'delivery');

function delivery(file: string): string {
  return fs.readFileSync(path.join(DELIVERY_DIR, file), 'utf8');
}

function deliveryFiles(dir = DELIVERY_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? deliveryFiles(path.join(dir, e.name)) : e.name.endsWith('.tsx') || e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [],
  );
}

describe('delivery screen has no hardcoded coordinates', () => {
  it('contains no numeric lat or lng literal in any delivery file', () => {
    const literal = /\b(lat|lng|latitude|longitude)\b\s*[:=]\s*-?\d+\.\d+/;
    for (const file of deliveryFiles()) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(literal);
    }
  });

  it('does not send coordinates derived from a typed locality name', () => {
    expect(delivery('_components/DeliveryConsole.tsx')).not.toMatch(/parsed\.client_coordinates/);
  });

  it('gets the diner position through the browser location helper', () => {
    const src = delivery('_components/DeliveryConsole.tsx');
    expect(src).toMatch(/import \{[^}]*requestBrowserLocation[^}]*\} from '@\/lib\/location\/browser-location'/);
    expect(src).toMatch(/requestBrowserLocation\(navigator\.geolocation\)/);
  });
});
