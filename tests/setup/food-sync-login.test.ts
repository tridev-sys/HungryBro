import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { setSyncLogin } from '../helpers/roles';
import { acquireFoodSyncLogin, withFoodSyncLogin } from './cluster-lock';

// Cross-run race: nightly-sync holds food_sync LOGIN from beforeAll to afterAll, but another run's
// cluster-lock test (or afterAll) could turn LOGIN off in between, and a new food_sync connection then
// fails with "password authentication failed". The holder takes the food_sync login window; the other
// context must wait for it, and the holder must still authenticate.
describe('food_sync login window', () => {
  it('a holder keeps authenticating as food_sync while another context waits to turn the login off', async () => {
    const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL, max: 4 });
    let releaseHolder: (() => Promise<void>) | undefined;
    let other: Promise<void> | undefined;
    try {
      releaseHolder = await acquireFoodSyncLogin(); // holder: nightly-sync beforeAll
      await setSyncLogin(admin, true);
      let otherDone = false;
      other = withFoodSyncLogin(() => setSyncLogin(admin, false)).then(() => { otherDone = true; }); // other run's afterAll
      await new Promise((r) => setTimeout(r, 500)); // give the other context time to run if it were not blocked
      expect(otherDone).toBe(false);
      const client = new pg.Client({ connectionString: process.env.SYNC_DATABASE_URL });
      await client.connect(); // holder: nightly-sync needs a fresh food_sync connection here
      try {
        const { rows } = await client.query('SELECT current_user AS u');
        expect(rows[0].u).toBe('food_sync');
      } finally {
        await client.end();
      }
      await releaseHolder();
      releaseHolder = undefined;
      await other;
      const { rows } = await admin.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'food_sync'`);
      expect(rows[0].rolcanlogin).toBe(false);
    } finally {
      await releaseHolder?.();
      await other?.catch(() => undefined);
      await admin.end();
    }
  });
});
