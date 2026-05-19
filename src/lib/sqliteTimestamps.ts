// =============================================================================
// SQLite timestamp helpers
// =============================================================================
//
// D1 stores datetime columns (proposed_at, reviewed_at, created_at,
// updated_at, etc.) using SQLite's `CURRENT_TIMESTAMP` default, which
// emits values like `"2026-05-19 21:17:23"` in UTC.
//
// The catch: `new Date("2026-05-19 21:17:23")` in browsers parses
// that as LOCAL time, NOT UTC — the same string interpreted as
// "9:17 PM local" instead of "9:17 PM UTC". For users in any
// timezone other than UTC, every displayed timestamp ends up off by
// their offset (typically 5–8 hours wrong).
//
// `parseSqliteUtc` converts to ISO 8601 (replace space with `T`,
// append `Z`) so JS parses as UTC. The returned `Date` then renders
// correctly in the user's local time via `toLocaleString()` /
// `toLocaleDateString()` / etc.
// =============================================================================

/**
 * Parse a SQLite `CURRENT_TIMESTAMP`-style string (UTC, "YYYY-MM-DD
 * HH:MM:SS") into a Date. Returns null for null / empty / unparseable
 * input. Also accepts already-ISO strings (containing 'T' or 'Z') as
 * passthrough — useful for legacy rows that landed via other paths.
 */
export function parseSqliteUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  // Already-ISO strings keep working unchanged.
  if (/T/.test(raw) || /Z$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ"
  const d = new Date(raw.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC SQLite string → user-local locale-formatted string. */
export function formatSqliteLocal(
  raw: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = parseSqliteUtc(raw);
  if (!d) return '';
  return options ? d.toLocaleString(undefined, options) : d.toLocaleString();
}
