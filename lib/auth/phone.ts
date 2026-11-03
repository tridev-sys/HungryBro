const MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;

export function normalizeIndianMobile(input: string): string | null {
  const m = input.replace(/[\s-]/g, '').match(MOBILE);
  return m ? `+91${m[1]}` : null;
}
