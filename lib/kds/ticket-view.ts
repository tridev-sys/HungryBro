import type { StationCategory, TicketStatus } from '@/types/food-os';

export interface TicketItem {
  lineId: string;
  itemId: string;
  name: string;
  quantity: number;
  preparationNotes: string | null;
  dietaryFlags: string[];
  change: 'ADD' | 'REMOVE' | 'MODIFY';
  bumped: boolean;
}

export interface TicketView {
  id: string;
  ticketNumber: number;
  restaurantId: string;
  sessionId: string | null;
  orderModality: 'DINE_IN' | 'DELIVERY';
  station: StationCategory;
  status: TicketStatus;
  items: TicketItem[];
  firedAt: string;
  bumpedAt: string | null;
}
