import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Reads the declared minimum sizes from the source class names, so the 44 px touch-target
// rule is enforced without a browser.
const MIN_TOUCH_PX = 44;
const src = readFileSync(path.resolve(__dirname, '../../app/delivery/_components/VoiceInput.tsx'), 'utf8');

function buttonClasses(predicate: (tag: string) => boolean): string {
  const tags = [...src.matchAll(/<button\b[\s\S]*?>/g)].map((m) => m[0]).filter(predicate);
  expect(tags.length).toBe(1);
  const cls = /className="([^"]*)"/.exec(tags[0]);
  expect(cls).not.toBeNull();
  return cls![1];
}

function declaredMin(classes: string, axis: 'h' | 'w'): number | null {
  const m = new RegExp(`(?:^|\\s)min-${axis}-\\[(\\d+)px\\]`).exec(classes);
  return m ? Number(m[1]) : null;
}

test('microphone button declares a minimum 44 px height and width', () => {
  const cls = buttonClasses((t) => t.includes('Voice input arrives'));
  expect(declaredMin(cls, 'h')).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  expect(declaredMin(cls, 'w')).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
});

test('Find kitchens button declares a minimum 44 px height', () => {
  const cls = buttonClasses((t) => t.includes('type="submit"'));
  expect(declaredMin(cls, 'h')).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
});

test('the touch-target check fails for a 34 px button', () => {
  expect(declaredMin('rounded-full p-2', 'h')).toBeNull();
  expect(declaredMin('min-h-[34px]', 'h')).toBe(34);
});

// Source-wide scan. Every interactive control in app/ and components/ must declare a height of at
// least 44 CSS px (min-h-11, min-h-[44px], h-11, ...). Its width must be declared at least 44 px
// (min-w-11, w-11, w-full, flex-1, ...), or carry horizontal padding of at least px-3, which keeps a
// labelled control at 44 px or wider once its text is counted. Icon-only controls need a declared
// width. Class names built from a const are resolved from that file.

const SOURCE_ROOTS = ['app', 'components'].map((d) => path.resolve(__dirname, '../..', d));
const NATIVE_CONTROLS = new Set(['button', 'a', 'input', 'select', 'textarea']);
// Non-native elements made interactive by an ARIA role (for example <div role="button">) are controls too.
const CONTROL_ROLE = /\brole="(button|link|radio|checkbox|switch|tab|menuitem)"/;
const ELEMENT = /<([a-z][a-z0-9-]*)(?=[\s>/])/g;
const FILLS = /(?:^|\s)(w-full|flex-1|grow)(?=\s|$)/;
// px-3 is 12 px each side: a labelled control with that padding is at least 44 px wide.
const PADDED = /(?:^|\s)px-(\d+)(?=\s|$)/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

// Index of the '>' that closes the tag starting at `start`, skipping braces and quoted strings
// so arrow functions inside props do not end the tag early.
function tagEnd(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return j;
  }
  return -1;
}

// Every interactive element in the source: native controls plus any element given a control role.
// Each entry carries the full opening tag text so the callers can read its props.
function controlStarts(src: string): { start: number; tag: string }[] {
  const found: { start: number; tag: string }[] = [];
  for (const m of src.matchAll(ELEMENT)) {
    const start = m.index!;
    const end = tagEnd(src, start);
    if (end < 0) continue;
    const tag = src.slice(start, end + 1);
    if (NATIVE_CONTROLS.has(m[1]) || CONTROL_ROLE.test(tag)) found.push({ start, tag });
  }
  return found;
}

// Resolves ${name} references to the string literals in the const that declares them.
function expandConsts(classes: string, src: string): string {
  return classes.replace(/\$\{(\w+)\}/g, (_m, name: string) => {
    const decl = new RegExp(`const\\s+${name}\\s*=([^;]*);`).exec(src);
    if (!decl) return '';
    return [...decl[1].matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]).join(' ');
  });
}

function axisPx(classes: string, prefixes: string[]): number {
  let best = 0;
  for (const prefix of prefixes) {
    const re = new RegExp(`(?:^|\\s)${prefix}-(?:\\[(\\d+)px\\]|(\\d+))(?=\\s|$)`, 'g');
    for (const m of classes.matchAll(re)) {
      best = Math.max(best, m[1] ? Number(m[1]) : Number(m[2]) * 4);
    }
  }
  return best;
}

interface SmallControl { line: number; tag: string; classes: string; problem: string }

function smallControlsIn(file: string): SmallControl[] {
  const src = readFileSync(file, 'utf8');
  const found: SmallControl[] = [];
  for (const { start, tag } of controlStarts(src)) {
    if (/type="hidden"/.test(tag)) continue;
    const cls = /className=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\}|\{([^}]*)\})/.exec(tag);
    const raw = cls ? (cls[1] ?? cls[2] ?? cls[3] ?? '') : '';
    const classes = expandConsts(raw, src).replace(/\s+/g, ' ');
    const height = axisPx(classes, ['min-h', 'h', 'size']);
    const width = axisPx(classes, ['min-w', 'w', 'size']);
    const problems: string[] = [];
    if (height < MIN_TOUCH_PX) problems.push(`height ${height || 'undeclared'}px`);
    const padded = PADDED.exec(classes);
    const wideEnough = width >= MIN_TOUCH_PX || FILLS.test(classes) || (padded !== null && Number(padded[1]) >= 3);
    if (!wideEnough) problems.push(`width ${width || 'undeclared'}px`);
    if (problems.length) {
      found.push({ line: src.slice(0, start).split('\n').length, tag: /^<([a-z][a-z0-9-]*)/.exec(tag)![1], classes, problem: problems.join(', ') });
    }
  }
  return found;
}

const allFiles = SOURCE_ROOTS.flatMap(tsxFiles);
const relative = (f: string) => path.relative(path.resolve(__dirname, '../..'), f);

test('the source scan finds the interactive controls it is meant to check', () => {
  const controls = allFiles.reduce((n, f) => n + controlStarts(readFileSync(f, 'utf8')).length, 0);
  expect(allFiles.length).toBeGreaterThan(20);
  expect(controls).toBeGreaterThan(20);
});

// Audit inventory: every file in app/ and components/ that renders a control (hidden inputs
// excluded), with the number of controls audited in that file. A new control, or a file that
// gains one, fails this test until it is sized and added here.
const AUDITED_CONTROLS: Record<string, number> = {
  'app/auth/login/LoginForm.tsx': 6,
  'app/delivery/_components/DeliveryConsole.tsx': 2,
  'app/delivery/_components/VoiceInput.tsx': 3,
  'app/profile/settings/SettingsForms.tsx': 10,
  'components/billing/BillPanel.tsx': 2,
  'components/dine/BillSplitSelector.tsx': 4,
  'components/dine/DynamicUpiQrModal.tsx': 1,
  'components/dine/MenuList.tsx': 1,
  'components/kds/StationTicketCard.tsx': 2,
  // Added with the delivery customer flow (feat/delivery-customer-flow): one stepper button per row.
  'components/order/CartView.tsx': 1,
  'components/order/CheckoutView.tsx': 1,
  'components/order/MenuList.tsx': 2,
  'components/order/OrderStatus.tsx': 1,
  'components/order/RatingPanel.tsx': 1,
  'components/home/HomeMenu.tsx': 1,
  'components/ratings/RatingModal.tsx': 5,
  'components/ui/ActionBar.tsx': 2,
  'components/ui/AppShell.tsx': 2,
  'components/ui/FilterChip.tsx': 1,
};

test('every control in app/ and components/ is in the audited inventory', () => {
  const counted: Record<string, number> = {};
  for (const file of allFiles) {
    const n = controlStarts(readFileSync(file, 'utf8')).filter((c) => !/type="hidden"/.test(c.tag)).length;
    if (n > 0) counted[relative(file)] = n;
  }
  expect(counted).toEqual(AUDITED_CONTROLS);
});

test('no interactive control in app/ or components/ is below 44 x 44 CSS px', () => {
  const failures: string[] = [];
  for (const file of allFiles) {
    for (const s of smallControlsIn(file)) {
      failures.push(`${relative(file)}:${s.line} <${s.tag}> ${s.problem} [${s.classes.slice(0, 120)}]`);
    }
  }
  expect(failures).toEqual([]);
});

test('the scan flags a 34 px control and a control with no declared size', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'touch-'));
  const file = path.join(dir, 'Fixture.tsx');
  writeFileSync(file, 'export const A = () => <button className="min-h-[34px] min-w-[34px]">x</button>;\n' +
    'export const B = () => <input className="px-2" />;\n' +
    'export const C = () => <a className="min-h-11 min-w-11">ok</a>;\n' +
    'export const D = () => <div role="button" className="p-1">x</div>;\n');
  try {
    const found = smallControlsIn(file);
    expect(found.map((f) => f.tag)).toEqual(['button', 'input', 'div']);
    expect(found[0].problem).toContain('height 34px');
    expect(found[2].problem).toContain('height undeclared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
