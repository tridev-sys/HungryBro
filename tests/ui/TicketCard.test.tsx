// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { TicketCard } from '@/components/kds/TicketCard';

test('shows ticket number, station, status, and elapsed time', () => {
  render(<TicketCard ticketNumber={1} station="TANDOOR" status="in_prep" elapsedMinutes={4} orderOrigin="DINE_IN" tableLabel="Table 07" items={['1x Paneer Tikka (Jain)']} />);
  expect(screen.getByText('Ticket #01')).toBeInTheDocument();
  expect(screen.getByText('TANDOOR')).toBeInTheDocument();
  expect(screen.getByText(/4m/)).toBeInTheDocument();
});
