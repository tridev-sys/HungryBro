// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { HomeMenu } from '@/components/home/HomeMenu';

test('signed-out home: headline, Order delivery, Dine in, Sign in', () => {
  render(<HomeMenu signedIn={false} name={null} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Autonomous Food OS' })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Home' });
  expect(within(nav).getByRole('link', { name: 'Order delivery' })).toHaveAttribute('href', '/order');
  expect(within(nav).getByRole('link', { name: 'Dine in' })).toHaveAttribute('href', '/dine');
  expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/login');
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});

test('signed-in home: greeting, Order delivery, Dine in, My account, Sign out', () => {
  render(<HomeMenu signedIn={true} name="Asha" />);
  expect(screen.getByRole('heading', { level: 1, name: 'Hi, Asha' })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Home' });
  expect(within(nav).getByRole('link', { name: 'Order delivery' })).toHaveAttribute('href', '/order');
  expect(within(nav).getByRole('link', { name: 'Dine in' })).toHaveAttribute('href', '/dine');
  expect(within(nav).getByRole('link', { name: 'My account' })).toHaveAttribute('href', '/profile/settings');
  expect(within(nav).queryByRole('link', { name: 'Sign in' })).toBeNull();
  const form = screen.getByRole('button', { name: 'Sign out' }).closest('form')!;
  expect(form).toHaveAttribute('action', '/api/auth/sign-out');
  expect(form).toHaveAttribute('method', 'post');
});

test('signed-in home without a name greets politely', () => {
  render(<HomeMenu signedIn={true} name={null} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Hi, there' })).toBeInTheDocument();
});
