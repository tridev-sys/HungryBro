'use client';

import { DineInScreen } from '@/components/dine/DineInScreen';

const noop = () => {};

/** Fixture props for the layout checks. Handlers are no-ops. */
export function PreviewScreen() {
  return (
    <DineInScreen
      restaurantName="AUTONOMOUS FOOD OS"
      locality="Toit Brewpub, Indiranagar"
      orbState="listening"
      transcript="Bhaiya, I found 3 Jain appetizers: Paneer Tikka, Crispy Corn..."
      filters={[
        { key: 'pure_veg', label: 'Pure Veg', tone: 'accent', pressed: true },
        { key: 'jain', label: 'Jain', pressed: false },
        { key: 'halal', label: 'Halal', pressed: false },
        { key: 'mild_spicy', label: 'Mild Spicy', pressed: false },
      ]}
      tickets={[
        { ticketNumber: 1, station: 'TANDOOR', status: 'in_prep', elapsedMinutes: 4, orderOrigin: 'DINE_IN', tableLabel: 'Table 07', items: ['1x Paneer Tikka (Jain)'] },
        { ticketNumber: 2, station: 'WOK', status: 'queued', elapsedMinutes: 6, orderOrigin: 'DINE_IN', tableLabel: 'Table 07', items: ['1x Crispy Corn'] },
        { ticketNumber: 3, station: 'BAR', status: 'ready', elapsedMinutes: 9, orderOrigin: 'DINE_IN', tableLabel: 'Table 07', items: ['2x Masala Chai'] },
      ]}
      bill={{ subtotal: 882, shareAmount: 220.5 }}
      onToggleFilter={noop}
      onSplit={noop}
      onActions={noop}
      onPay={noop}
      onCallSteward={noop}
    />
  );
}
