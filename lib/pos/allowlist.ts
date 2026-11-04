// POS provider allow-list. Pure: no I/O and no module-level state.
// POS_PROVIDERS_ENABLED is a comma-separated list of provider names. Unset or blank means no
// POS provider is enabled, so webhooks return 404 and the nightly sync skips every POS restaurant.
export function parsePosProvidersEnabled(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}
