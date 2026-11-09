// @vitest-environment jsdom
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MenuList } from '@/components/order/MenuList';

const categories = [{
  name: 'Mains',
  items: [
    { id: 'p1', name: 'Paneer', description: null, priceInr: 122500, dietary: 'pure_veg', spiceLevel: 1, categoryName: 'Mains' },
  ],
}];

beforeEach(() => window.localStorage.clear());

test('shows the INR price with Indian grouping and a card per item', () => {
  render(<MenuList restaurantId="r1" restaurantName="Menu House" categories={categories} />);
  expect(screen.getByText('₹1,22,500.00')).toBeInTheDocument();
  expect(screen.getByText('Paneer')).toBeInTheDocument();
});

test('add and remove change the quantity and the cart total', () => {
  render(<MenuList restaurantId="r1" restaurantName="Menu House" categories={categories} />);
  const card = screen.getByText('Paneer').closest('li') as HTMLElement;
  expect(within(card).getByLabelText('Quantity of Paneer')).toHaveTextContent('0');
  fireEvent.click(within(card).getByRole('button', { name: 'Add Paneer' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Add Paneer' }));
  expect(within(card).getByLabelText('Quantity of Paneer')).toHaveTextContent('2');
  expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('₹2,45,000.00');
  fireEvent.click(within(card).getByRole('button', { name: 'Remove Paneer' }));
  expect(within(card).getByLabelText('Quantity of Paneer')).toHaveTextContent('1');
});

test('the cart survives a remount (held in localStorage)', () => {
  const first = render(<MenuList restaurantId="r1" restaurantName="Menu House" categories={categories} />);
  fireEvent.click(within(screen.getByText('Paneer').closest('li') as HTMLElement).getByRole('button', { name: 'Add Paneer' }));
  first.unmount();
  render(<MenuList restaurantId="r1" restaurantName="Menu House" categories={categories} />);
  expect(within(screen.getByText('Paneer').closest('li') as HTMLElement).getByLabelText('Quantity of Paneer')).toHaveTextContent('1');
});
