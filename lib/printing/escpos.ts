// Pure ESC/POS renderer for kitchen tickets. No I/O; see sender.ts for the TCP path.

export interface PrintableOrder {
  orderNumber: string;
  station: string;
  tableNumber?: string;
  placedAt: string; // ISO 8601, rendered as HH:MM in Asia/Kolkata
  items: { name: string; quantity: number; modifiers: string[] }[];
  notes?: string;
}

export const ESC_POS = {
  INIT: Buffer.from([0x1b, 0x40]), // ESC @
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]), // ESC E 1
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  FEED_3: Buffer.from([0x1b, 0x64, 0x03]), // ESC d 3
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x42, 0x00]), // GS V 66 0
};

// Anything outside printable ASCII (including control characters, which covers LF
// inside a value) becomes '?'.
function sanitize(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '?');
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '??:??';
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function renderOrderTicket(order: PrintableOrder): Buffer {
  const parts: Buffer[] = [];
  const line = (text: string) => parts.push(Buffer.from(`${sanitize(text)}\n`, 'latin1'));

  parts.push(ESC_POS.INIT, ESC_POS.ALIGN_CENTER, ESC_POS.BOLD_ON);
  line('KITCHEN TICKET');
  parts.push(ESC_POS.BOLD_OFF, ESC_POS.ALIGN_LEFT);

  parts.push(ESC_POS.BOLD_ON);
  line(`Order ${order.orderNumber}`);
  parts.push(ESC_POS.BOLD_OFF);

  if (order.tableNumber !== undefined) line(`Table ${order.tableNumber}`);
  line(`Station: ${order.station}`);
  line(`Time: ${timeLabel(order.placedAt)}`);

  for (const item of order.items) {
    line(`${item.quantity} x ${item.name}`);
    for (const modifier of item.modifiers) line(`  ${modifier}`);
  }

  if (order.notes) line(`Note: ${order.notes}`);

  parts.push(ESC_POS.FEED_3, ESC_POS.CUT_PARTIAL);
  return Buffer.concat(parts);
}
