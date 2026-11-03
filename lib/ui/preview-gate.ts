/**
 * Dev preview pages (e.g. /dev/dine-in-preview) are served only when the
 * explicit flag ENABLE_DEV_PREVIEW is exactly "1". Anything else, including
 * unset, means the page returns 404. Production never sets the flag.
 */
export function isPreviewEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.ENABLE_DEV_PREVIEW === '1';
}
