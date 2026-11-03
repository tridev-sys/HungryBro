import { getAdminPool } from '../lib/db/client';
import { seedMeshDev } from '../lib/dev/seed-mesh';

const pool = getAdminPool();
seedMeshDev(pool)
  .then(() => console.log('mesh dev seed OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
