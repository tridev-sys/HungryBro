// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CheckoutView } from '@/components/order/CheckoutView';
import { addOne, emptyCart, writeStoredCart } from '@/lib/delivery-customer/cart';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const RESTAURANT = '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a11';
const ITEM = '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a12';

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  push.mockReset();
  writeStoredCart(window.localStorage, addOne(emptyCart(), RESTAURANT, { id: ITEM, name: 'Paneer', priceInr: 250.5 }));
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.97, longitude: 77.64 } } as GeolocationPosition) },
  });
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/orders/quote') return json({ subtotalInr: 250.5, gstInr: 12.53, totalInr: 263.03, lines: [] });
    if (url === '/api/delivery/intent') return json({ auctionId: '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a13' }, 201);
    if (url === '/api/orders') return json({ orderId: 'o-1', status: 'pending_payment', totalInr: 263.03, provider: 'razorpay', upiIntentUrl: 'upi://pay', reused: false }, 201);
    return json({ error: 'unexpected' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

test('shows the server-quoted total and places the order through intent then orders', async () => {
  render(<CheckoutView />);
  expect(await screen.findByText('₹263.03')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Place order and pay' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/order/o-1'));

  const urls = fetchMock.mock.calls.map((c) => c[0]);
  expect(urls.indexOf('/api/delivery/intent')).toBeLessThan(urls.indexOf('/api/orders'));

  const orderCall = fetchMock.mock.calls.find((c) => c[0] === '/api/orders')!;
  const body = JSON.parse((orderCall[1] as RequestInit).body as string);
  expect(body.restaurantId).toBe(RESTAURANT);
  expect(body.auctionId).toBe('6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a13');
  expect(body.lines).toEqual([{ menuItemId: ITEM, quantity: 1 }]);
  expect(JSON.stringify(body)).not.toMatch(/price|unitPrice|total/i);
  expect(typeof body.clientKey).toBe('string');
  expect(window.localStorage.getItem('fos-cart-v1')).toBeNull();
});

test('location denied: nothing is sent and the diner is asked to allow location', async () => {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1 } as GeolocationPositionError) },
  });
  render(<CheckoutView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Place order and pay' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Allow location');
  expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain('/api/orders');
});
