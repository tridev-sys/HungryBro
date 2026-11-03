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
