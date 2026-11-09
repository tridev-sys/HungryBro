import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_RESTAURANTS, FIXTURE_ITEMS } from '@/lib/seed/fixtures';
import { getAdminPool } from '@/lib/db/client';
import { tableSignatures } from '@/lib/seed/run';

const r = FIXTURE_RESTAURANTS[0];
let sigs: Record<string, string> = {};
test.beforeAll(async () => { sigs = await tableSignatures(getAdminPool(), r.id); });
test.afterAll(async () => { await getAdminPool().end(); });

// Current UI: the menu list (aria-label "Menu") has an "Add <item name>" button per dish, and each
// kitchen ticket renders as an <article> headed "Ticket #NN" with its item lines.
const addItem = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Menu' }).getByRole('button', { name: `Add ${name}`, exact: true });
const kdsTickets = (page: Page) => page.getByRole('article').filter({ has: page.getByRole('heading', { name: /^Ticket #/ }) });

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
      addItem(a, FIXTURE_ITEMS.paneerTikka.name).click(),
      addItem(b, FIXTURE_ITEMS.freshLimeSoda.name).click(),
    ]);
    await expect(kdsTickets(a)).toHaveCount(1);
    await expect(kdsTickets(a)).toContainText(FIXTURE_ITEMS.paneerTikka.name);
    await expect(kdsTickets(b)).toHaveCount(1);
    await expect(kdsTickets(b)).toContainText(FIXTURE_ITEMS.freshLimeSoda.name);
    await expect(kdsTickets(a).filter({ hasText: FIXTURE_ITEMS.freshLimeSoda.name })).toHaveCount(0);
    await expect(kdsTickets(b).filter({ hasText: FIXTURE_ITEMS.paneerTikka.name })).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
