// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RatingModal } from '@/components/ratings/RatingModal';
import { DineSurface, type DineSurfaceProps } from '@/components/dine/DineSurface';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/dine/[restaurantId]/[tableNumber]/actions', () => ({
  cartUpdateAction: vi.fn(),
  refreshSettlementAction: vi.fn(),
  requestSplitAction: vi.fn(),
}));

const ORDER_ID = '00000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  // The closed-session view opens a live stream; jsdom has no EventSource.
  vi.stubGlobal('EventSource', class { close() {} onmessage = null; });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function modalProps(overrides: Partial<React.ComponentProps<typeof RatingModal>> = {}) {
  return {
    orderRefId: ORDER_ID,
    restaurantName: 'Meghna Foods',
    onClose: vi.fn(),
    ...overrides,
  };
}

test('the modal shows five star radios and the four tags', () => {
  render(<RatingModal {...modalProps()} />);
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  for (let n = 1; n <= 5; n++) {
    expect(screen.getByRole('radio', { name: n === 1 ? '1 star' : `${n} stars` })).toBeInTheDocument();
  }
  for (const tag of ['Authentic Taste', 'Fast Prep', 'Piping Hot', 'True Jain Spec']) {
    expect(screen.getByRole('button', { name: tag })).toHaveAttribute('aria-pressed', 'false');
  }
});

test('submitting posts order, score and tags to /api/ratings and shows the saved message', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ ratingId: 'r1' }) });
  vi.stubGlobal('fetch', fetchMock);
  const onSubmitted = vi.fn();
  render(<RatingModal {...modalProps({ onSubmitted })} />);

  fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Piping Hot' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));

  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Your rating for this order is saved.');
  expect(onSubmitted).toHaveBeenCalledTimes(1);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/ratings');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    order_ref_id: ORDER_ID,
    rating_score: 4,
    review_tags: ['Piping Hot'],
  });
});

test('a rejected rating shows the message for the error code in the response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'WINDOW_EXPIRED' }) }));
  render(<RatingModal {...modalProps()} />);
  fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The 2-second rating window for this order has closed.');
  expect(screen.queryByRole('status')).toBeNull();
});

const surfaceProps = (ratingOrderRefId: string | null): DineSurfaceProps => ({
  restaurantId: '00000000-0000-4000-8000-000000000001',
  restaurantName: 'Meghna Foods',
  ratingLabel: 'No ratings yet',
  tableNumber: '3',
  signature: null,
  session: { status: 'closed', subtotal: 400, total: 420 },
  tickets: [],
  menu: [],
  ratingOrderRefId,
});

test('the closed-session view shows no rating form without a completed order', () => {
  render(<DineSurface {...surfaceProps(null)} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByText('Rate your experience (verified order)')).toBeNull();
});

test('the closed-session view mounts the rating modal for a completed order', () => {
  render(<DineSurface {...surfaceProps(ORDER_ID)} />);
  const dialog = screen.getByRole('dialog', { name: 'Rate your experience (verified order)' });
  expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
});
