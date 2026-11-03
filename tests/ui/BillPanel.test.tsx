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
