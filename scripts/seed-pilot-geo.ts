// Seeds mock pilot restaurants 1.5 to 3.5 km around a centre point. Mock data: guarded by
// PILOT_SEED_ENABLED=1 (and PILOT_SEED_ALLOW_PROD=1 when NODE_ENV=production). Never run against food_os.
//
// Usage: PILOT_SEED_ENABLED=1 ADMIN_DATABASE_URL=... npx tsx scripts/seed-pilot-geo.ts --lat 12.9352 --lng 77.6245
import { getAdminPool } from '../lib/db/client';
import { runPilotSeed } from '../lib/seed/pilot-geo';

function argNumber(name: string): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : Number.NaN;
  if (Number.isNaN(value)) throw new Error(`missing or invalid --${name}`);
  return value;
}

async function main(): Promise<void> {
  const centre = { lat: argNumber('lat'), lng: argNumber('lng') };
  const pool = getAdminPool();
  try {
    const counts = await runPilotSeed(pool, centre, process.env);
    console.log(`pilot seed OK: restaurants=${counts.restaurants} menuItems=${counts.menuItems} tables=${counts.tables}`);
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
