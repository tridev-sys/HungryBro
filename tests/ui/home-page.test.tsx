// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

const source = readFileSync(path.resolve(__dirname, '../../app/page.tsx'), 'utf8');

test('home page shows the product name and a one-line description', () => {
  render(<Home />);
  expect(screen.getByRole('heading', { level: 1, name: 'Autonomous Food OS' })).toBeInTheDocument();
  expect(screen.getByText(/order food for delivery or dine in at a table/i)).toBeInTheDocument();
});

test('home page links to delivery, dine-in and sign-in', () => {
  render(<Home />);
  expect(screen.getByRole('link', { name: 'Order delivery' })).toHaveAttribute('href', '/delivery');
  expect(screen.getByRole('link', { name: 'Dine in' })).toHaveAttribute('href', '/dine');
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/login');
});

test('home page source has no hard-coded hex colours or default palette colour classes', () => {
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(source).not.toMatch(
    /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:white|black|red|blue|green|amber|neutral|slate|gray|zinc|emerald|teal|sky|indigo|violet|purple|pink|rose|orange|yellow|lime|cyan|fuchsia|stone)(?:-\d{2,3})?\b/,
  );
});
