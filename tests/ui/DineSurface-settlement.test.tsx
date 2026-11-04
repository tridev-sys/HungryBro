// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react';
import { DineSurface, SETTLEMENT_POLL_MS, type DineSurfaceProps } from '@/components/dine/DineSurface';
import { refreshSettlementAction } from '@/app/dine/[restaurantId]/[tableNumber]/actions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/app/dine/[restaurantId]/[tableNumber]/actions', () => ({
  cartUpdateAction: vi.fn(),
  refreshSettlementAction: vi.fn(),
  requestSplitAction: vi.fn(),
}));

const ORDER_ID = '00000000-0000-4000-8000-0000000000cc';
const SESSION_ID = '00000000-0000-4000-8000-0000000000dd';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((msg: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>); }
}

function props(overrides: Partial<DineSurfaceProps> = {}): DineSurfaceProps {
  return {
    restaurantId: '11111111-1111-4111-8111-111111111111',
    restaurantName: 'Meghna Foods',
    ratingLabel: 'No ratings yet',
    tableNumber: '4',
    signature: null,
    session: { status: 'payment_pending', subtotal: 100, total: 118 },
    tickets: [],
    menu: [],
    ratingOrderRefId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.mocked(refreshSettlementAction).mockReset();
  vi.mocked(refreshSettlementAction).mockResolvedValue({ status: 'payment_pending', paidShares: 0, totalShares: 1 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the fallback settlement poll runs at 1000 ms or faster, not 4000 ms', () => {
  expect(SETTLEMENT_POLL_MS).toBeLessThanOrEqual(1000);
});

test('a settlement event on the diner stream refreshes the view at once, without waiting for the poll', async () => {
  render(<DineSurface {...props()} />);
  const source = FakeEventSource.instances.at(-1)!;
  expect(source.url).toBe('/api/dine/stream');

  // Within the first tick of the 4 s window nothing has polled yet.
  await act(async () => { vi.advanceTimersByTime(100); });
  expect(refresh).not.toHaveBeenCalled();

  await act(async () => {
    source.emit({ type: 'session.settled', restaurantId: props().restaurantId, sessionId: SESSION_ID });
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('after a settlement event the rating prompt appears from the refreshed server state', async () => {
  const { rerender } = render(<DineSurface {...props()} />);
  const source = FakeEventSource.instances.at(-1)!;
  expect(screen.queryByRole('dialog')).toBeNull();

  await act(async () => {
    source.emit({ type: 'session.settled', restaurantId: props().restaurantId, sessionId: SESSION_ID });
  });
  expect(refresh).toHaveBeenCalledTimes(1);

  // The refresh re-renders the server page with the closed session and the diner's ratable order.
  rerender(<DineSurface {...props({
    session: { status: 'closed', subtotal: 100, total: 118 },
    ratingOrderRefId: ORDER_ID,
  })} />);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('while payment is pending the settlement is checked every SETTLEMENT_POLL_MS', async () => {
  render(<DineSurface {...props()} />);
  await act(async () => { vi.advanceTimersByTime(SETTLEMENT_POLL_MS); });
  expect(refreshSettlementAction).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(SETTLEMENT_POLL_MS); });
  expect(refreshSettlementAction).toHaveBeenCalledTimes(2);
});
