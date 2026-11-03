// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { TicketStrip } from '@/components/kds/TicketStrip';

test('ticket strip is a named, keyboard-focusable scroll region', () => {
  render(<TicketStrip><article>Ticket</article></TicketStrip>);
  const region = screen.getByRole('region', { name: 'Active tickets' });
  expect(region.getAttribute('tabindex')).toBe('0');
  expect(region.className).toContain('overflow-x-auto');
});
