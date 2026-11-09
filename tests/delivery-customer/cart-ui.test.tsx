// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { CartView } from '@/components/order/CartView';
import { writeStoredCart, addOne, emptyCart } from '@/lib/delivery-customer/cart';

beforeEach(() => window.localStorage.clear());

test('shows the stored cart lines and a checkout link', async () => {
  const c = addOne(addOne(emptyCart(), 'r1', { id: 'p1', name: 'Paneer', priceInr: 250.5 }), 'r1', { id: 'p1', name: 'Paneer', priceInr: 250.5 });
  writeStoredCart(window.localStorage, c);
  render(<CartView />);
  expect(await screen.findByText('Paneer')).toBeInTheDocument();
  expect(screen.getByText('× 2')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Continue to checkout' })).toHaveAttribute('href', '/order/checkout');
});

test('an empty cart says so and has no checkout link', () => {
  render(<CartView />);
  expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Continue to checkout' })).toBeNull();
});
