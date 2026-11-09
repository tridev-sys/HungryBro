// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { OrderStatus } from '@/components/order/OrderStatus';
import type { OrderStatusView } from '@/lib/delivery-customer/order-status';

const base: OrderStatusView = {
  id: '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a11',
  status: 'pending_payment',
  statusText: 'Waiting for payment',
  restaurantName: 'Menu House',
  totalInr: 526.05,
  lines: [{ name: 'Paneer', quantity: 2, lineTotalInr: 501 }],
  upiIntentUrl: 'upi://pay?pa=merchant%40okaxis&am=526.05',
  orderRefId: null,
  rated: false,
};

test('shows the state, the lines and the INR total', () => {
  render(<OrderStatus initial={base} />);
  expect(screen.getByRole('heading', { name: 'Waiting for payment' })).toBeInTheDocument();
  expect(screen.getByText('Paneer × 2')).toBeInTheDocument();
  expect(screen.getByText('₹526.05')).toBeInTheDocument();
});

test('the UPI pay link is shown only while waiting for payment', () => {
  const { rerender } = render(<OrderStatus initial={base} />);
  expect(screen.getByRole('link', { name: 'Pay with UPI' })).toHaveAttribute('href', base.upiIntentUrl!);
  rerender(<OrderStatus initial={{ ...base, status: 'in_kitchen', statusText: 'Preparing your order', upiIntentUrl: null }} />);
  expect(screen.queryByRole('link', { name: 'Pay with UPI' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Preparing your order' })).toBeInTheDocument();
});
