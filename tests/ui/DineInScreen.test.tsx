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

test('ticket section has a level-2 heading above the level-3 ticket titles', () => {
  render(<DineInScreen {...props} />);
  expect(screen.getByRole('heading', { level: 2, name: 'Active tickets' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 3, name: 'Ticket #01' })).toBeTruthy();
});
