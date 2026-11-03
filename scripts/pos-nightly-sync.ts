import { getSyncPool } from '../lib/db/sync';
import { httpMenuFetcher, runNightlyMenuSync } from '../lib/pos/nightly-sync';

async function main(): Promise<number> {
  const pool = getSyncPool();
  try {
    const summary = await runNightlyMenuSync(pool, httpMenuFetcher({}));
    console.log(JSON.stringify(summary));
    return summary.failed.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
