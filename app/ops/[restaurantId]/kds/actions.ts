'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { getPool } from '@/lib/db/client';
import { resolveActor } from '@/lib/auth/actor';
import { bumpItem, bumpTicket } from '@/lib/kds/board';
import { publishKdsEvent } from '@/lib/kds/events';
import type { TicketView } from '@/lib/kds/ticket-view';

const ItemSchema = z.object({
  restaurantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  itemIndex: z.number().int().min(0),
});
const TicketSchema = z.object({ restaurantId: z.string().uuid(), ticketId: z.string().uuid() });

async function signedInActor() {
  const actor = await resolveActor(getPool(), (await cookies()).toString());
  if (!actor) throw new Error('UNAUTHORIZED');
  return actor;
}

async function announce(restaurantId: string, ticket: TicketView): Promise<void> {
  await publishKdsEvent({ type: 'ticket.updated', restaurantId, sessionId: ticket.sessionId, ticket })
    .catch((err: unknown) => console.error('kds publish failed', err));
}

export async function bumpItemAction(input: unknown): Promise<TicketView> {
  const parsed = ItemSchema.parse(input);
  const ticket = await bumpItem(getPool(), await signedInActor(), parsed);
  await announce(parsed.restaurantId, ticket);
  return ticket;
}

export async function bumpTicketAction(input: unknown): Promise<TicketView> {
  const parsed = TicketSchema.parse(input);
  const ticket = await bumpTicket(getPool(), await signedInActor(), parsed);
  await announce(parsed.restaurantId, ticket);
  return ticket;
}
