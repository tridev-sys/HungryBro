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
