import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(__dirname, '../../test-results/a11y');
const PREVIEW = '/dev/dine-in-preview';
const DELIVERY = '/delivery';
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 768 };
const SMALL = { width: 320, height: 640 };
const AXE_PATH = path.resolve(__dirname, '../../node_modules/axe-core/axe.min.js');

fs.mkdirSync(OUT, { recursive: true });

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (window as any).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    });
    return res.violations.map((v: { id: string; impact: string | null; help: string; nodes: { target: unknown[] }[] }) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.map(String).join(' ')),
    }));
  });
}

// --- 1. axe-core scans -----------------------------------------------------
for (const [name, url] of [['preview', PREVIEW], ['delivery', DELIVERY]] as const) {
  for (const [vname, vp] of [['390x844', PHONE], ['1366x768', LAPTOP]] as const) {
    test(`axe: ${name} at ${vname}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await open(page, url);
      const violations = await runAxe(page);
      fs.writeFileSync(path.join(OUT, `axe-${name}-${vname}.json`), JSON.stringify(violations, null, 2));
      const bySev = (s: string) => violations.filter((v) => v.impact === s).length;
      const counts = { critical: bySev('critical'), serious: bySev('serious'), moderate: bySev('moderate'), minor: bySev('minor') };
      console.log(`axe ${name} ${vname}: ${JSON.stringify(counts)}`, JSON.stringify(violations.map((v) => `${v.impact}:${v.id}:${v.nodes.join(' | ')}`), null, 1));
      expect(counts.critical).toBe(0);
      expect(counts.serious).toBe(0);
    });
  }
}

// --- 2. Touch targets on the preview page at 390x844 -----------------------
test('touch targets: every interactive control on preview is >= 44x44 at 390x844', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page, PREVIEW);
  const controls = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"]';
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          visible,
        };
      })
      .filter((c) => c.visible);
  });
  const small = controls.filter((c) => c.w < 44 || c.h < 44);
  console.log(`touch controls measured: ${controls.length}; below 44px: ${small.length}`, JSON.stringify(small));
  expect(controls.length).toBeGreaterThan(0);
  expect(small).toEqual([]);
});

// --- 3. Contrast of --color-text-muted ---------------------------------------
function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: number[], b: number[]) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function parseRgb(s: string): number[] {
  return s.match(/[\d.]+/g)!.slice(0, 3).map(Number);
}

test('contrast: --color-text-muted on its surface is >= 4.5:1', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page, PREVIEW);
  const measured = await page.evaluate(() => {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim();
    const el = Array.from(document.querySelectorAll<HTMLElement>('dt, span, p')).find((e) => e.textContent?.trim() === 'Subtotal')!;
    const fg = getComputedStyle(el).color;
    let bgEl: HTMLElement | null = el;
    let bg = 'rgba(0, 0, 0, 0)';
    while (bgEl) {
      bg = getComputedStyle(bgEl).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
      bgEl = bgEl.parentElement;
    }
    return { token, fg, bg };
  });
  const fg = parseRgb(measured.fg);
  const bg = parseRgb(measured.bg);
  const r = ratio(fg, bg);
  console.log(`contrast token=${measured.token} fg=${measured.fg} bg=${measured.bg} ratio=${r.toFixed(2)}:1`);
  expect(r).toBeGreaterThanOrEqual(4.5);
});

// --- 4. Reduced motion -------------------------------------------------------
test('reduced motion: voice orb ring has no running animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await open(page, PREVIEW);
  const ring = page.getByTestId('voice-orb-ring');
  await expect(ring).toBeVisible();
  const style = await ring.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { animationName: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount };
  });
  console.log(`reduced motion ring: ${JSON.stringify(style)}`);
  expect(style.animationName).toBe('none');
});

test('control: voice orb ring pulses without reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize(PHONE);
  await open(page, PREVIEW);
  const ring = page.getByTestId('voice-orb-ring');
  await expect(ring).toBeVisible();
  const anim = await ring.evaluate((el) => getComputedStyle(el).animationName);
  console.log(`no-preference ring animationName=${anim}`);
  expect(anim).not.toBe('none');
});

// --- 5. Keyboard focus -------------------------------------------------------
test('keyboard: every interactive control receives focus with a visible indicator', async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await open(page, PREVIEW);
  const total = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.hasAttribute('disabled'); });
    els.forEach((el, i) => el.setAttribute('data-a11y-idx', String(i)));
    return els.length;
  });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached = new Set<number>();
  const noIndicator: string[] = [];
  for (let i = 0; i < total + 2; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.hasAttribute('data-a11y-idx')) return null;
      const cs = getComputedStyle(el);
      const outlined = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      return { idx: Number(el.getAttribute('data-a11y-idx')), label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), outlined, focusVisible: el.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
    });
    if (info) {
      reached.add(info.idx);
      if (!info.outlined) noIndicator.push(`${info.idx}:${info.label}`);
    }
  }
  console.log(`keyboard: focusable=${total} reached=${reached.size} withoutIndicator=${JSON.stringify(noIndicator)}`);
  expect(reached.size).toBe(total);
  expect(noIndicator).toEqual([]);
});

// --- 6. Responsive ----------------------------------------------------------
test('320px: no horizontal page scroll on preview; ticket strip scrolls inside itself', async ({ page }) => {
  await page.setViewportSize(SMALL);
  await open(page, PREVIEW);
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const strip = Array.from(document.querySelectorAll<HTMLElement>('div')).find((d) => getComputedStyle(d).overflowX === 'auto' && d.querySelector('article'))!;
    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      stripClientWidth: strip.clientWidth,
      stripScrollWidth: strip.scrollWidth,
      stripOverflowX: getComputedStyle(strip).overflowX,
    };
  });
  console.log(`320px preview: ${JSON.stringify(m)}`);
  expect(m.pageOverflow).toBeLessThanOrEqual(0);
  expect(m.stripOverflowX).toBe('auto');
  expect(m.stripScrollWidth).toBeGreaterThan(m.stripClientWidth);
  expect(m.stripClientWidth).toBeLessThanOrEqual(SMALL.width);
});

test('320px: no horizontal page scroll on delivery', async ({ page }) => {
  await page.setViewportSize(SMALL);
  await open(page, DELIVERY);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`320px delivery page overflow=${overflow}`);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('1366x768: preview splits into two columns; no page overflow', async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await open(page, PREVIEW);
  const m = await page.evaluate(() => {
    const cols = getComputedStyle(document.querySelector('[data-testid="screen-columns"]')!).gridTemplateColumns.split(' ').length;
    return { cols, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  console.log(`1366 preview: ${JSON.stringify(m)}`);
  expect(m.cols).toBe(2);
  expect(m.overflow).toBeLessThanOrEqual(0);
});

// --- 7. Screenshots ---------------------------------------------------------
for (const [name, url] of [['preview', PREVIEW], ['delivery', DELIVERY]] as const) {
  for (const [vname, vp] of [['390x844', PHONE], ['1366x768', LAPTOP]] as const) {
    test(`screenshot: ${name} ${vname}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await open(page, url);
      const file = path.join(OUT, `${name}-${vname}.png`);
      await page.screenshot({ path: file, fullPage: true });
      expect(fs.statSync(file).size).toBeGreaterThan(0);
      console.log(`screenshot saved: ${file}`);
    });
  }
}
