import { getAdminPool } from '../lib/db/client';
import { runSeed } from '../lib/seed/run';

async function main(): Promise<void> {
  const pool = getAdminPool();
  try {
    const counts = await runSeed(pool, {
      nodeEnv: process.env.NODE_ENV,
      allowProd: process.env.ALLOW_SEED_PROD === 'yes',
    });
    console.log(`seed OK: restaurants=${counts.restaurants} menuItems=${counts.menuItems} tables=${counts.tables}`);
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
