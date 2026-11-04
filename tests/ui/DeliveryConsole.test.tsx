// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryConsole from '@/app/delivery/_components/DeliveryConsole';

const SAMPLE = 'Biryani under 800 in 30 mins to Indiranagar';

describe('DeliveryConsole coordinate inputs', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      status: 500,
      json: async () => ({ error: 'Request failed' }),
      headers: { get: () => null },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders labelled latitude and longitude inputs with DeliveryIntentSchema bounds', () => {
    render(<DeliveryConsole />);
    const lat = screen.getByLabelText('Latitude') as HTMLInputElement;
    const lng = screen.getByLabelText('Longitude') as HTMLInputElement;
    expect(lat).toHaveAttribute('min', '-90');
    expect(lat).toHaveAttribute('max', '90');
    expect(lng).toHaveAttribute('min', '-180');
    expect(lng).toHaveAttribute('max', '180');
  });

  it('shows a visible message for latitude 250 and does not submit', async () => {
    render(<DeliveryConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Dinner for 3/), { target: { value: SAMPLE } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '77.6408' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find kitchens' }));

    const message = await screen.findByText('Latitude must be between -90 and 90');
    expect(message).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText('Latitude')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a visible message for longitude 181 and does not submit', async () => {
    render(<DeliveryConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Dinner for 3/), { target: { value: SAMPLE } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '12.9719' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '181' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find kitchens' }));

    expect(await screen.findByText('Longitude must be between -180 and 180')).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits a valid latitude and longitude as client_coordinates', async () => {
    render(<DeliveryConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Dinner for 3/), { target: { value: SAMPLE } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '12.9' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '77.6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find kitchens' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/delivery/intent');
    const body = JSON.parse(String(init.body));
    expect(body.intent.client_coordinates).toEqual({ lat: 12.9, lng: 77.6 });
    expect(screen.queryByText(/must be between/)).toBeNull();
  });
});
