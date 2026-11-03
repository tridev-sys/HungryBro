import { renderOrderTicket, ESC_POS, type PrintableOrder } from '@/lib/printing/escpos';

const order: PrintableOrder = {
  orderNumber: 'K-1042', station: 'Tandoor', tableNumber: 'T7', placedAt: '2026-11-03T12:30:00+05:30',
  items: [{ name: 'Butter Naan', quantity: 2, modifiers: ['extra butter'] }, { name: 'Dal Tadka', quantity: 1, modifiers: [] }],
  notes: 'less oil',
};

test('starts with INIT and ends with partial cut and feed', () => {
  const out = renderOrderTicket(order);
  expect(out.subarray(0, 2).equals(ESC_POS.INIT)).toBe(true);
  expect(out.subarray(out.length - 4).equals(ESC_POS.CUT_PARTIAL)).toBe(true);
  expect(out.indexOf(ESC_POS.FEED_3)).toBeGreaterThan(0);
});

test('emits bold on and off around the order number', () => {
  const out = renderOrderTicket(order);
  const at = out.indexOf(Buffer.from('K-1042'));
  expect(at).toBeGreaterThan(0);
  expect(out.subarray(0, at).lastIndexOf(ESC_POS.BOLD_ON)).toBeGreaterThan(-1);
  expect(out.subarray(at).indexOf(ESC_POS.BOLD_OFF)).toBeGreaterThan(0);
});

test('item lines, modifiers, table, station, and notes appear as text', () => {
  const text = renderOrderTicket(order).toString('latin1');
  expect(text).toContain('2 x Butter Naan\n');
  expect(text).toContain('  extra butter\n');
  expect(text).toContain('1 x Dal Tadka\n');
  expect(text).toContain('Table T7');
  expect(text).toContain('Tandoor');
  expect(text).toContain('less oil');
  expect(text).toContain('12:30');
});

test('replaces non-ASCII characters with ? and keeps the output deterministic', () => {
  const o = { ...order, items: [{ name: 'Paneer ₹ Tikka é', quantity: 1, modifiers: [] }] };
  const a = renderOrderTicket(o);
  expect(a.toString('latin1')).toContain('1 x Paneer ? Tikka ?');
  expect(a.equals(renderOrderTicket(o))).toBe(true);
});

test('omits the table line for delivery tickets', () => {
  const text = renderOrderTicket({ ...order, tableNumber: undefined }).toString('latin1');
  expect(text).not.toContain('Table');
});
