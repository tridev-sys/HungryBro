/** The fos_table_session cookie: a 64-hex session token. Returns null for anything else. */
export const TABLE_SESSION_COOKIE = 'fos_table_session';

export function readTableSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === TABLE_SESSION_COOKIE) {
      const value = rest.join('=');
      return /^[0-9a-f]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}
