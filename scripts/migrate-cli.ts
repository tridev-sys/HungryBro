import { getPool, runMigrations } from '../lib/db/client';

async function main(): Promise<void> {
  const pool = getPool();
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no pending migrations');
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
