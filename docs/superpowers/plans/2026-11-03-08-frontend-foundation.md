# Plan 08: Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared frontend layer: design tokens, the app shell, the reusable dine-in components (voice orb, filter chips, ticket cards, bill panel, action bar), and the installable PWA setup. Phone layout is primary; laptop layout is a wider view of the same components.

**Architecture:** Presentational components in `components/` take plain props and have no data fetching. Data wiring belongs to the feature plans (02, 03, 05), which import these components. Styling comes only from the tokens defined in one CSS theme, so the look can be changed in one place.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4 (`@theme` tokens), Lucide React, Framer Motion (only for non-essential motion, disabled under reduced motion), `next/font` with Inter, Vitest with jsdom and Testing Library, Playwright (from Plan 07) for screenshot checks.

**Reference look:** `/home/ubuntu/docker/mobile-friendly.png`, a dark navy phone screen at a restaurant table. Colours and sizes below are approximations taken from that image. The owner refines them later by changing the tokens file only.

## Scope

**In:** tokens and theme, app shell, voice orb (presentational), filter chips, ticket card and ticket strip, bill panel, bottom action bar, PWA manifest and icons, viewport and safe-area handling, responsive layout rules.

**Out:**
- Wiring real data, sessions, or server actions into the screens (Plans 02, 03, 05).
- Real audio levels for the orb (Plan 04 passes the level in).
- Offline caching and the service worker. Installable PWA only. Offline support is a later plan.
- Brand logo, final colours, and final typography (owner decides; placeholders used).
- Dark and light theme switching. The app ships dark only in v1.

**Decision (tech):** the navy theme is the only theme. Light mode is not built.

## Global Constraints

- Phone width reference: 390 × 844 (iPhone 14). Smallest supported width: 320 px. No horizontal page scroll at any supported width; only the ticket strip scrolls sideways.
- Laptop width reference: 1366 × 768. From 1024 px up, the layout becomes two columns: tickets on the left, bill on the right.
- Maximum content width on phones: 430 px, centred on larger phones.
- Touch targets at least 44 × 44 CSS px.
- Text contrast at least 4.5:1 against its background (WCAG AA for body text).
- Money is INR, shown with Indian digit grouping: `₹1,22,500.00`. Use `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- Respect `prefers-reduced-motion`: the orb stops its pulse and Framer Motion animations are disabled.
- Respect safe-area insets (`env(safe-area-inset-bottom)`) for the bottom action bar.
- Tokens below are the single source of colour and radius values. No hard-coded hex values in components.
- Dine-in SLA colours follow decision 3 in the tech decisions file: green under 5 min, yellow from 5 min until the SLA, red after the SLA (8 min dine-in, 12 min delivery).

## Design Tokens (reference values)

| Token | Approx. value | Used for |
|---|---|---|
| `--color-bg` | `#0B1A36` | page background |
| `--color-surface` | `#15274A` | cards, panels |
| `--color-surface-2` | `#1E3461` | pressed or selected card |
| `--color-text` | `#F5F7FB` | primary text |
| `--color-text-muted` | `#A9B6D3` | secondary text (contrast checked against surface) |
| `--color-accent` | `#2EC4A0` | positive chips, primary actions |
| `--color-accent-ink` | `#06201A` | text on accent |
| `--color-sla-green` | `#2EC4A0` | ticket under 5 min |
| `--color-sla-yellow` | `#F5C451` | ticket 5 min to SLA |
| `--color-sla-red` | `#F26B6B` | ticket past SLA |
| `--color-orb-a` / `-b` / `-c` | `#3BD3FF` / `#7B61FF` / `#FF6FB5` | orb gradient |
| `--radius-card` | `16px` | cards |
| `--radius-pill` | `999px` | chips |

Tokens go in `app/theme.css` as `@theme` variables. The `.dark` palette is the only palette.

---

## Review Focus

1. A 320 px-wide phone shows no horizontal page scroll; the ticket strip is the only sideways scroller. Owned by Task 2.
2. The payment button sits above the iPhone home indicator (safe-area inset applied). Owned by Task 6.
3. A bill total of ₹1,22,500 is shown with Indian digit grouping, not ₹122,500. Owned by Task 5.
4. A ticket at exactly 5 minutes shows yellow, and at exactly the SLA it shows yellow; one second past the SLA shows red. Owned by Task 4.
5. With `prefers-reduced-motion` set, the orb does not pulse. Owned by Task 3.

---

### Task 1: Tokens, Theme, and Fonts

**Files:**
- Create: `app/theme.css`, `lib/ui/format.ts`
- Modify: `app/globals.css` (import the theme), `app/layout.tsx` (font and viewport)
- Test: `tests/ui/theme.test.ts`, `tests/ui/format.test.ts`

**Interfaces:**
- Consumes: Plan 01 `app/layout.tsx`, `app/globals.css`
- Produces:
  - `app/theme.css` with the tokens above as `@theme` variables.
  - `formatINR(amount: number): string` in `lib/ui/format.ts`, returning Indian grouping (`₹1,22,500.00`). Uses `Intl.NumberFormat('en-IN')`, rounds to 2 decimals.
  - `app/layout.tsx` exports `viewport` with `width: 'device-width'`, `initialScale: 1`, `viewportFit: 'cover'`, and `themeColor: '#0B1A36'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ui/format.test.ts
import { formatINR } from '@/lib/ui/format';

test('uses Indian digit grouping', () => {
  expect(formatINR(122500)).toBe('₹1,22,500.00');
});

test('two decimals for shares like ₹220.50', () => {
  expect(formatINR(220.5)).toBe('₹220.50');
});

test('zero renders as ₹0.00', () => {
  expect(formatINR(0)).toBe('₹0.00');
});
```

```ts
// tests/ui/theme.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'app/theme.css'), 'utf8');

test('theme defines the core colour tokens', () => {
  for (const token of ['--color-bg', '--color-surface', '--color-accent', '--color-sla-red', '--color-orb-a']) {
    expect(css).toContain(token);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ui`
Expected: FAIL, "Cannot find module '@/lib/ui/format'" and "ENOENT app/theme.css".

- [ ] **Step 3: Implement**

- `lib/ui/format.ts`: `formatINR` as specified. Round with `round2` from Plan 01 `lib/pricing.ts` before formatting.
- `app/theme.css`: `@theme { ... }` block with every token in the table.
- `app/globals.css`: `@import "./theme.css";` then `body { background: var(--color-bg); color: var(--color-text); }`.
- `app/layout.tsx`: load Inter via `next/font/google`, apply its class to `<body>`, export `viewport` as specified.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui && npm run build`
Expected: both tests pass (6 total in the two files); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/theme.css app/globals.css app/layout.tsx lib/ui tests/ui
git commit -m "feat: add design tokens, Indian INR formatting, and viewport setup

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: App Shell and Responsive Layout

**Files:**
- Create: `components/ui/AppShell.tsx`, `components/ui/ScreenColumns.tsx`
- Test: `tests/ui/AppShell.test.tsx`

**Interfaces:**
- Consumes: tokens (Task 1)
- Produces:
  - `AppShell(props: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }): JSX.Element`. Header with a menu button (Lucide `Menu`, `aria-label="Open menu"`), the title, the subtitle (restaurant and locality, muted), and an optional right slot (Lucide `MoreVertical` by default). Content area max-width 430 px on phones.
  - `ScreenColumns(props: { primary: ReactNode; secondary: ReactNode }): JSX.Element`. Single column below 1024 px (primary then secondary). Two columns from 1024 px: primary left, secondary right, sticky on the right.

Layout uses Tailwind breakpoints only (`lg:` is 1024 px). No JS width checks.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/AppShell.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/ui/AppShell';
import { ScreenColumns } from '@/components/ui/ScreenColumns';

test('header shows title, subtitle, and an accessible menu button', () => {
  render(<AppShell title="AUTONOMOUS FOOD OS" subtitle="Toit Brewpub, Indiranagar"><p>body</p></AppShell>);
  expect(screen.getByText('AUTONOMOUS FOOD OS')).toBeInTheDocument();
  expect(screen.getByText('Toit Brewpub, Indiranagar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  expect(screen.getByText('body')).toBeInTheDocument();
});

test('ScreenColumns renders primary before secondary in the DOM', () => {
  const { container } = render(<ScreenColumns primary={<div>tickets</div>} secondary={<div>bill</div>} />);
  const text = container.textContent ?? '';
  expect(text.indexOf('tickets')).toBeLessThan(text.indexOf('bill'));
});
```

Testing Library is installed here: `npm i -D @testing-library/react @testing-library/jest-dom jsdom`, and `vitest.config.ts` gets `setupFiles: ['tests/setup.ts']` with `import '@testing-library/jest-dom/vitest'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/AppShell.test.tsx`
Expected: FAIL, "Cannot find module '@/components/ui/AppShell'".

- [ ] **Step 3: Implement the two components**

Use `sticky top-0` header with the surface colour and safe-area top padding. `ScreenColumns` uses `grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4`, and the secondary column uses `lg:sticky lg:top-4 lg:self-start`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/AppShell.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add components/ui tests/ui/AppShell.test.tsx tests/setup.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add app shell and responsive two-column layout

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Voice Orb (Presentational)

**Files:**
- Create: `components/voice/VoiceOrb.tsx`
- Test: `tests/ui/VoiceOrb.test.tsx`

**Interfaces:**
- Consumes: tokens (Task 1)
- Produces:
  - `type OrbState = 'idle' | 'listening' | 'speaking'`
  - `VoiceOrb(props: { state: OrbState; level?: number /* 0..1, default 0 */; label?: string }): JSX.Element`. Renders a 180 px circular gradient ring (`conic-gradient` from `--color-orb-a/b/c`) with a dark centre. Label defaults to "VOICE AGENT ACTIVE" when state is not idle, otherwise "TAP TO SPEAK". The ring scale follows `level` (1.0 to 1.12). Plan 04 replaces `level` with the real audio level; the prop shape does not change.
  - `data-testid="voice-orb"` on the root, and `data-state` set to the state.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/VoiceOrb.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { VoiceOrb } from '@/components/voice/VoiceOrb';

test('shows the active label and data-state when listening', () => {
  render(<VoiceOrb state="listening" />);
  expect(screen.getByText('VOICE AGENT ACTIVE')).toBeInTheDocument();
  expect(screen.getByTestId('voice-orb')).toHaveAttribute('data-state', 'listening');
});

test('idle shows the tap-to-speak label', () => {
  render(<VoiceOrb state="idle" />);
  expect(screen.getByText('TAP TO SPEAK')).toBeInTheDocument();
});

test('level is clamped to the 1.0 to 1.12 scale range (Review Focus 5 setup)', () => {
  render(<VoiceOrb state="speaking" level={5} />);
  const scale = getComputedStyle(screen.getByTestId('voice-orb-ring')).getPropertyValue('--orb-scale');
  expect(Number(scale)).toBeLessThanOrEqual(1.12);
});

test('pulse animation is disabled under reduced motion (Review Focus 5)', () => {
  // Assert the ring has the class 'motion-safe:animate-pulse' and no unconditional animate-pulse class.
  render(<VoiceOrb state="listening" />);
  const ring = screen.getByTestId('voice-orb-ring');
  expect(ring.className).toContain('motion-safe:animate-pulse');
  expect(ring.className).not.toMatch(/(^|\s)animate-pulse(\s|$)/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/VoiceOrb.test.tsx`
Expected: FAIL, "Cannot find module '@/components/voice/VoiceOrb'".

- [ ] **Step 3: Implement**

Clamp `level` to `[0, 1]` and map to scale `1 + 0.12 * level`. Set `--orb-scale` as an inline style. Use Tailwind's `motion-safe:animate-pulse` for the ring. Framer Motion is not needed for this component.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/VoiceOrb.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add components/voice tests/ui/VoiceOrb.test.tsx
git commit -m "feat: add presentational voice orb with reduced-motion support

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Filter Chips and Ticket Cards

**Files:**
- Create: `components/ui/FilterChip.tsx`, `components/kds/TicketCard.tsx`, `components/kds/TicketStrip.tsx`, `lib/kds/sla.ts`
- Test: `tests/ui/FilterChip.test.tsx`, `tests/kds/sla.test.ts`, `tests/ui/TicketCard.test.tsx`

**Interfaces:**
- Consumes: tokens (Task 1); the ticket status and SLA rule from tech decisions (decision 3)
- Produces:
  - `FilterChip(props: { label: string; pressed: boolean; tone?: 'accent' | 'neutral'; onToggle: () => void }): JSX.Element`. Renders a `<button aria-pressed>` pill, min height 44 px. `tone="accent"` shows a green dot (used for "Pure Veg"). Label values from the reference: "Pure Veg", "Jain", "Halal", "Mild Spicy".
  - `slaState(elapsedMinutes: number, slaMinutes: number): 'green' | 'yellow' | 'red'`. Green when `elapsedMinutes < 5`; yellow when `5 <= elapsedMinutes <= slaMinutes`; red when `elapsedMinutes > slaMinutes`. Tests in `tests/kds/sla.test.ts`.
  - `slaMinutesFor(order: 'DINE_IN' | 'DELIVERY'): number`: 8 or 12.
  - `TicketCard(props: { ticketNumber: number; station: string; status: 'queued' | 'in_prep' | 'ready' | 'served' | 'voided'; elapsedMinutes: number; orderOrigin: 'DINE_IN' | 'DELIVERY'; tableLabel?: string; items: string[] }): JSX.Element`. Shows "Ticket #01", station, status text, elapsed time, and a coloured dot from `slaState`. Dot colour uses the SLA tokens, never hex.
  - `TicketStrip(props: { children: ReactNode }): JSX.Element`. Horizontal scroll on phones (`overflow-x-auto snap-x`), wrapping grid on laptops (`lg:grid lg:grid-cols-3 lg:overflow-visible`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/kds/sla.test.ts
import { slaState, slaMinutesFor } from '@/lib/kds/sla';

test('green under 5 minutes', () => {
  expect(slaState(4.99, 8)).toBe('green');
});

test('yellow at exactly 5 minutes and at exactly the SLA (Review Focus 4)', () => {
  expect(slaState(5, 8)).toBe('yellow');
  expect(slaState(8, 8)).toBe('yellow');
});

test('red one second past the SLA (Review Focus 4)', () => {
  expect(slaState(8 + 1 / 60, 8)).toBe('red');
});

test('SLA is 8 minutes dine-in and 12 minutes delivery', () => {
  expect(slaMinutesFor('DINE_IN')).toBe(8);
  expect(slaMinutesFor('DELIVERY')).toBe(12);
});
```

```tsx
// tests/ui/FilterChip.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChip } from '@/components/ui/FilterChip';

test('chip reports pressed state and toggles on click', () => {
  const onToggle = vi.fn();
  render(<FilterChip label="Jain" pressed={false} onToggle={onToggle} />);
  const chip = screen.getByRole('button', { name: 'Jain' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(chip);
  expect(onToggle).toHaveBeenCalledTimes(1);
});
```

```tsx
// tests/ui/TicketCard.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { TicketCard } from '@/components/kds/TicketCard';

test('shows ticket number, station, status, and elapsed time', () => {
  render(<TicketCard ticketNumber={1} station="TANDOOR" status="in_prep" elapsedMinutes={4} orderOrigin="DINE_IN" tableLabel="Table 07" items={['1x Paneer Tikka (Jain)']} />);
  expect(screen.getByText('Ticket #01')).toBeInTheDocument();
  expect(screen.getByText('TANDOOR')).toBeInTheDocument();
  expect(screen.getByText(/4m/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/kds tests/ui/FilterChip.test.tsx tests/ui/TicketCard.test.tsx`
Expected: FAIL, "Cannot find module" for each new module.

- [ ] **Step 3: Implement**

- `lib/kds/sla.ts`: the two functions as specified.
- `FilterChip.tsx`: `<button type="button" aria-pressed>`; pressed uses `bg-[var(--color-accent)] text-[var(--color-accent-ink)]`, unpressed uses `bg-[var(--color-surface)]`. Min height 44 px.
- `TicketCard.tsx`: `rounded-[var(--radius-card)] bg-[var(--color-surface)] p-3 min-w-[160px] snap-start`. Dot uses `bg-[var(--color-sla-green|yellow|red)]`.
- `TicketStrip.tsx` as specified.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/kds tests/ui/FilterChip.test.tsx tests/ui/TicketCard.test.tsx`
Expected: all pass (4 + 1 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/FilterChip.tsx components/kds lib/kds tests/kds tests/ui/FilterChip.test.tsx tests/ui/TicketCard.test.tsx
git commit -m "feat: add filter chips, SLA colour rule, and ticket cards

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bill Panel

**Files:**
- Create: `components/billing/BillPanel.tsx`
- Test: `tests/ui/BillPanel.test.tsx`

**Interfaces:**
- Consumes: `formatINR` (Task 1), `gstOn` from Plan 01 `lib/pricing.ts`
- Produces:
  - `BillPanel(props: { subtotal: number; gstRate?: number /* default 0.05 */; shareAmount?: number; onSplit: () => void; onActions: () => void }): JSX.Element`. Shows subtotal, GST (5%, from `gstOn`), total, a "Split" button and an "Actions" button. The per-share amount is shown only when provided. The payment button lives in `ActionBar` (Task 6), not here.
  - The panel shows `Total: ₹<total>` at the top right and `Total: ₹<subtotal>` at the bottom left, matching the reference.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/BillPanel.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { BillPanel } from '@/components/billing/BillPanel';

test('shows subtotal, 5% GST, and total with Indian grouping (Review Focus 3)', () => {
  render(<BillPanel subtotal={122500} onSplit={() => {}} onActions={() => {}} />);
  expect(screen.getAllByText('₹1,22,500.00').length).toBeGreaterThan(0);
  expect(screen.getByText('₹6,125.00')).toBeInTheDocument();
  expect(screen.getByText('₹1,28,625.00')).toBeInTheDocument();
});

test('split and actions buttons fire their handlers', () => {
  const onSplit = vi.fn(); const onActions = vi.fn();
  render(<BillPanel subtotal={800} onSplit={onSplit} onActions={onActions} />);
  fireEvent.click(screen.getByRole('button', { name: 'Split' }));
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  expect(onSplit).toHaveBeenCalledTimes(1);
  expect(onActions).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/BillPanel.test.tsx`
Expected: FAIL, "Cannot find module '@/components/billing/BillPanel'".

- [ ] **Step 3: Implement**

Compute GST with `gstOn(subtotal, gstRate)` and total as `round2(subtotal + gst)`. Card uses the surface token; numbers use `tabular-nums`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/BillPanel.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add components/billing tests/ui/BillPanel.test.tsx
git commit -m "feat: add bill panel with 5% GST and Indian INR formatting

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bottom Action Bar with Safe Area

**Files:**
- Create: `components/ui/ActionBar.tsx`
- Test: `tests/ui/ActionBar.test.tsx`

**Interfaces:**
- Consumes: tokens (Task 1)
- Produces:
  - `ActionBar(props: { primaryLabel: string; onPrimary: () => void; primaryDisabled?: boolean; secondaryLabel?: string; onSecondary?: () => void }): JSX.Element`. Fixed to the bottom of the viewport on phones (`fixed inset-x-0 bottom-0`), with `padding-bottom: env(safe-area-inset-bottom)`. The primary button is full width, accent colour, 52 px tall, uppercase label as in the reference. The secondary button is outlined. On laptops (`lg:`) the bar becomes static at the bottom of the secondary column (`lg:static`).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/ActionBar.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionBar } from '@/components/ui/ActionBar';

test('primary and secondary buttons render and fire', () => {
  const onPrimary = vi.fn(); const onSecondary = vi.fn();
  render(<ActionBar primaryLabel="PAY MY SHARE VIA DYNAMIC UPI (₹220.50)" onPrimary={onPrimary} secondaryLabel="CALL STEWARD" onSecondary={onSecondary} />);
  fireEvent.click(screen.getByRole('button', { name: /PAY MY SHARE/ }));
  fireEvent.click(screen.getByRole('button', { name: 'CALL STEWARD' }));
  expect(onPrimary).toHaveBeenCalledTimes(1);
  expect(onSecondary).toHaveBeenCalledTimes(1);
});

test('primary is disabled when primaryDisabled is set', () => {
  render(<ActionBar primaryLabel="PAY" onPrimary={() => {}} primaryDisabled />);
  expect(screen.getByRole('button', { name: 'PAY' })).toBeDisabled();
});

test('bar has the safe-area padding class (Review Focus 2)', () => {
  const { container } = render(<ActionBar primaryLabel="PAY" onPrimary={() => {}} />);
  expect((container.firstElementChild as HTMLElement).className).toContain('pb-[env(safe-area-inset-bottom)]');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/ActionBar.test.tsx`
Expected: FAIL, "Cannot find module '@/components/ui/ActionBar'".

- [ ] **Step 3: Implement**

Root element gets `pb-[env(safe-area-inset-bottom)]`. Add a spacer in `AppShell` (Task 2) so content is not hidden behind the fixed bar on phones.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/ActionBar.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ActionBar.tsx tests/ui/ActionBar.test.tsx components/ui/AppShell.tsx
git commit -m "feat: add bottom action bar with iPhone safe-area padding

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dine-In Screen Composition (Presentational)

**Files:**
- Create: `components/dine/DineInScreen.tsx`
- Test: `tests/ui/DineInScreen.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–6 components
- Produces:
  - `DineInScreen(props: DineInScreenProps): JSX.Element` where `DineInScreenProps = { restaurantName: string; locality: string; orbState: OrbState; transcript: string; filters: { key: string; label: string; tone?: 'accent' | 'neutral'; pressed: boolean }[]; tickets: TicketCardProps[]; bill: { subtotal: number; shareAmount?: number }; onToggleFilter: (key: string) => void; onSplit: () => void; onActions: () => void; onPay: () => void; onCallSteward: () => void }`.
  - Layout: phone is one column (shell, orb, transcript, chips, ticket strip, bill, action bar). Laptop (`lg:`) uses `ScreenColumns`: orb, transcript, chips and tickets on the left; bill on the right.
  - This component does not fetch data. Plan 03 supplies the props from the database and server actions.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/DineInScreen.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { DineInScreen } from '@/components/dine/DineInScreen';

const props = {
  restaurantName: 'AUTONOMOUS FOOD OS',
  locality: 'Toit Brewpub, Indiranagar',
  orbState: 'listening' as const,
  transcript: 'Bhaiya, I found 3 Jain appetizers: Paneer Tikka, Crispy Corn...',
  filters: [
    { key: 'pure_veg', label: 'Pure Veg', tone: 'accent' as const, pressed: true },
    { key: 'jain', label: 'Jain', pressed: false },
  ],
  tickets: [{ ticketNumber: 1, station: 'TANDOOR', status: 'in_prep' as const, elapsedMinutes: 4, orderOrigin: 'DINE_IN' as const, items: ['1x Paneer Tikka'] }],
  bill: { subtotal: 882, shareAmount: 220.5 },
  onToggleFilter: vi.fn(), onSplit: vi.fn(), onActions: vi.fn(), onPay: vi.fn(), onCallSteward: vi.fn(),
};

test('renders the reference sections in order', () => {
  const { container } = render(<DineInScreen {...props} />);
  const text = container.textContent ?? '';
  expect(text.indexOf('VOICE AGENT ACTIVE')).toBeLessThan(text.indexOf('Jain appetizers'));
  expect(text.indexOf('Jain appetizers')).toBeLessThan(text.indexOf('Ticket #01'));
  expect(text.indexOf('Ticket #01')).toBeLessThan(text.indexOf('PAY MY SHARE'));
});

test('payment and steward buttons fire their handlers', () => {
  render(<DineInScreen {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /PAY MY SHARE/ }));
  fireEvent.click(screen.getByRole('button', { name: 'CALL STEWARD' }));
  expect(props.onPay).toHaveBeenCalledTimes(1);
  expect(props.onCallSteward).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/DineInScreen.test.tsx`
Expected: FAIL, "Cannot find module '@/components/dine/DineInScreen'".

- [ ] **Step 3: Implement**

Compose the Task 2–6 components. The bill's share amount feeds the primary button label as `PAY MY SHARE VIA DYNAMIC UPI (₹220.50)` when present, otherwise `PAY`. The transcript sits in a surface card under the orb.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/DineInScreen.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add components/dine tests/ui/DineInScreen.test.tsx
git commit -m "feat: compose dine-in screen from shared components

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 8: PWA Manifest and Icons

**Files:**
- Create: `app/manifest.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`
- Test: `tests/ui/manifest.test.ts`

**Interfaces:**
- Consumes: theme colours (Task 1)
- Produces: `app/manifest.ts` default export `MetadataRoute.Manifest` with `name: 'Autonomous Food OS'`, `short_name: 'Food OS'`, `start_url: '/'`, `display: 'standalone'`, `background_color: '#0B1A36'`, `theme_color: '#0B1A36'`, and icons at 192, 512, and maskable 512.

Icons are placeholders until the owner supplies a logo. Generate them as plain navy squares with a white "F" so the install prompt works in the meantime.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/manifest.test.ts
import manifest from '@/app/manifest';

test('manifest is installable in standalone mode with the navy theme', () => {
  const m = manifest();
  expect(m.display).toBe('standalone');
  expect(m.theme_color).toBe('#0B1A36');
  expect(m.icons?.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/manifest.test.ts`
Expected: FAIL, "Cannot find module '@/app/manifest'".

- [ ] **Step 3: Implement**

Create `app/manifest.ts` and the three placeholder PNG icons (generate with `sharp` or a small script; do not commit a large binary).

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/manifest.test.ts && npm run build`
Expected: test passes; build lists `/manifest.webmanifest`.

- [ ] **Step 5: Commit**

```bash
git add app/manifest.ts public/icons tests/ui/manifest.test.ts
git commit -m "feat: add installable PWA manifest with placeholder icons

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Responsive Screenshot Check

**Files:**
- Create: `tests/e2e/layout.spec.ts`
- Uses: Playwright from Plan 07 Task 10.

**Interfaces:**
- Consumes: `/dev/dine-in-preview` route rendering `DineInScreen` with fixture props (a preview page added in this task at `app/dev/dine-in-preview/page.tsx`, returning 404 when `NODE_ENV === 'production'`).
- Produces: screenshots at 390×844 (phone) and 1366×768 (laptop) saved to `test-results/`, plus two assertions: no horizontal page scroll at 320 px, and the payment button's bottom edge is within the viewport.

- [ ] **Step 1: Write the failing spec**

```ts
// tests/e2e/layout.spec.ts
import { test, expect } from '@playwright/test';

test('no horizontal page scroll at 320 px (Review Focus 1)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/dev/dine-in-preview');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('payment button is fully on screen at 390×844 (Review Focus 2)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev/dine-in-preview');
  const box = await page.getByRole('button', { name: /PAY/ }).boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);
});

test('laptop shows two columns at 1366×768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/dev/dine-in-preview');
  await page.screenshot({ path: 'test-results/laptop.png', fullPage: true });
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="screen-columns"]')!).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/e2e/layout.spec.ts`
Expected: FAIL with a 404 on `/dev/dine-in-preview`.

- [ ] **Step 3: Implement the preview page and test hooks**

`app/dev/dine-in-preview/page.tsx` renders `DineInScreen` with the Task 7 fixture props and returns `notFound()` in production. `ScreenColumns` gets `data-testid="screen-columns"`.

- [ ] **Step 4: Verify**

Run: `npx playwright test tests/e2e/layout.spec.ts`
Expected: 3 passed. Open `test-results/laptop.png` and confirm two columns.

- [ ] **Step 5: Commit**

```bash
git add app/dev tests/e2e/layout.spec.ts components/ui/ScreenColumns.tsx
git commit -m "test: add responsive layout checks for phone and laptop widths

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

## Acceptance for Plan 08

- `npx vitest run tests/ui tests/kds` passes.
- `npx playwright test tests/e2e/layout.spec.ts` passes.
- `/dev/dine-in-preview` looks like the reference at 390×844 (phone) and splits into two columns at 1366×768.
- Owner can change every colour by editing `app/theme.css` only.
- Plans 02, 03, and 05 import these components instead of building their own.

## Open Items for the Owner

- Logo and icons (Task 8 uses placeholder icons).
- Final colours and typeface (Task 1 uses approximations from the reference image).
- Plan 03 must adopt `DineInScreen` for Route 1 and `TicketCard` for Route 3; Plan 02 uses `AppShell` and `ActionBar`.
