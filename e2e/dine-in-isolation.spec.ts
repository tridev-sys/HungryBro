import { test, expect } from '@playwright/test';
import { FIXTURE_RESTAURANTS, FIXTURE_ITEMS } from '@/lib/seed/fixtures';
import { getAdminPool } from '@/lib/db/client';
import { tableSignatures } from '@/lib/seed/run';

const r = FIXTURE_RESTAURANTS[0];
let sigs: Record<string, string> = {};
test.beforeAll(async () => { sigs = await tableSignatures(getAdminPool(), r.id); });
test.afterAll(async () => { await getAdminPool().end(); });

test('two tables ordering at the same moment do not see each other tickets', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await Promise.all([
      a.goto(`/dine/${r.id}/${r.tables[0]}?sig=${sigs[r.tables[0]]}`),
      b.goto(`/dine/${r.id}/${r.tables[1]}?sig=${sigs[r.tables[1]]}`),
    ]);
    await Promise.all([
      a.getByTestId(`add-item-${FIXTURE_ITEMS.paneerTikka.code}`).click(),
      b.getByTestId(`add-item-${FIXTURE_ITEMS.freshLimeSoda.code}`).click(),
    ]);
    await expect(a.getByTestId('kds-ticket')).toHaveCount(1);
    await expect(a.getByTestId('kds-ticket')).toContainText(FIXTURE_ITEMS.paneerTikka.name);
    await expect(b.getByTestId('kds-ticket')).toHaveCount(1);
    await expect(b.getByTestId('kds-ticket')).toContainText(FIXTURE_ITEMS.freshLimeSoda.name);
    await expect(a.getByTestId('kds-ticket').filter({ hasText: FIXTURE_ITEMS.freshLimeSoda.name })).toHaveCount(0);
    await expect(b.getByTestId('kds-ticket').filter({ hasText: FIXTURE_ITEMS.paneerTikka.name })).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
