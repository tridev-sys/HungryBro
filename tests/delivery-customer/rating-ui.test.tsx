// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RatingPanel } from '@/components/order/RatingPanel';

const ORDER_REF = '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a14';

afterEach(() => { vi.unstubAllGlobals(); });

test('shows stars only for a delivered, unrated order', () => {
  const { rerender } = render(<RatingPanel orderRefId={ORDER_REF} status="in_kitchen" rated={false} />);
  expect(screen.queryByRole('group', { name: 'Rate your order' })).toBeNull();
  rerender(<RatingPanel orderRefId={ORDER_REF} status="delivered" rated={true} />);
  expect(screen.queryByRole('group', { name: 'Rate your order' })).toBeNull();
  rerender(<RatingPanel orderRefId={ORDER_REF} status="delivered" rated={false} />);
  expect(screen.getByRole('group', { name: 'Rate your order' })).toBeInTheDocument();
});

test('posts the chosen score for the order reference', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ratingId: 'r1' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<RatingPanel orderRefId={ORDER_REF} status="delivered" rated={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }));
  await waitFor(() => expect(screen.getByText('Thanks for rating your order.')).toBeInTheDocument());
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/ratings');
  expect(JSON.parse(init.body as string)).toEqual({ order_ref_id: ORDER_REF, rating_score: 4, review_tags: [] });
});

test('an expired window is explained, not hidden', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'WINDOW_EXPIRED' }), { status: 422 })));
  render(<RatingPanel orderRefId={ORDER_REF} status="delivered" rated={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('rating window for this order has closed');
});
