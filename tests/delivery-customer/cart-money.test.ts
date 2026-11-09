import { formatINR } from '@/lib/ui/format';
import {
  addOne, cartSubtotal, emptyCart, MAX_LINE_QUANTITY, quantityOf, readStoredCart, removeOne, writeStoredCart,
} from '@/lib/delivery-customer/cart';

const item = (id: string, priceInr: number) => ({ id, name: `Item ${id}`, priceInr });

describe('formatINR (Indian grouping, two decimals)', () => {
  test('groups lakhs the Indian way', () => {
    expect(formatINR(122500)).toBe('₹1,22,500.00');
  });
  test('small and paise amounts', () => {
    expect(formatINR(180)).toBe('₹180.00');
    expect(formatINR(0.1 + 0.2)).toBe('₹0.30');
  });
});

describe('cart reducer', () => {
  test('adds, increments and removes one unit at a time', () => {
    let c = addOne(emptyCart(), 'r1', item('a', 100));
    c = addOne(c, 'r1', item('a', 100));
    expect(quantityOf(c, 'a')).toBe(2);
    c = removeOne(c, 'a');
    expect(quantityOf(c, 'a')).toBe(1);
    c = removeOne(c, 'a');
    expect(quantityOf(c, 'a')).toBe(0);
    expect(c.lines).toEqual([]);
  });

  test('caps a line at MAX_LINE_QUANTITY', () => {
    let c = emptyCart();
    for (let i = 0; i < MAX_LINE_QUANTITY + 5; i++) c = addOne(c, 'r1', item('a', 100));
    expect(quantityOf(c, 'a')).toBe(MAX_LINE_QUANTITY);
  });

  test('a cart holds one restaurant: adding from another restaurant starts a new cart', () => {
    const c = addOne(addOne(emptyCart(), 'r1', item('a', 100)), 'r2', item('b', 50));
    expect(c.restaurantId).toBe('r2');
    expect(quantityOf(c, 'a')).toBe(0);
    expect(quantityOf(c, 'b')).toBe(1);
  });

  test('subtotal is the sum of price times quantity, rounded to paise', () => {
    let c = addOne(emptyCart(), 'r1', item('a', 99.99));
    c = addOne(c, 'r1', item('a', 99.99));
    c = addOne(c, 'r1', item('b', 0.1));
    expect(cartSubtotal(c)).toBe(200.08);
  });

  test('stored cart round-trips and bad stored data reads as empty', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const c = addOne(emptyCart(), 'r1', item('a', 100));
    writeStoredCart(storage, c);
    expect(readStoredCart(storage)).toEqual(c);
    store.set('fos-cart-v1', '{not json');
    expect(readStoredCart(storage)).toEqual(emptyCart());
  });
});
