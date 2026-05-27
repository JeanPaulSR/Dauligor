import { MODULE_ID } from "./constants.js";

/**
 * Deterministic Foundry document `_id` derivation from a stable
 * Dauligor sourceId.
 *
 * Foundry document IDs are 16-character base62 strings (A-Z, a-z,
 * 0-9). Calling `foundryIdFromSourceId("spell-fireball")` always
 * returns the same 16-char string, so:
 *
 *   1. Dragging the same Dauligor entity onto two different actors
 *      produces items with identical `_id` — supports idempotent
 *      `Item.create({_id, ...})` calls.
 *   2. `@UUID[Item.<id>]` references in compendium content survive
 *      re-imports without rewriting.
 *   3. Phase 4 batch-status freshness checks can key on `_id` instead
 *      of round-tripping the sourceId flag.
 *
 * Hash: SHA-256(MODULE_ID + ':' + sourceId), big-endian first 96
 * bits, base62-encoded to exactly 16 chars. 96 bits = ~5.7e28
 * possible outputs; collision probability across the Dauligor
 * entity space (a few thousand items) is astronomically low.
 *
 * Async because `crypto.subtle` is async by design — there is no
 * synchronous SHA-256 in the browser/Foundry runtime. Callers that
 * need synchronous access (e.g. inside a `dragstart` handler, which
 * cannot await) should pre-warm the cache on hover via
 * `prewarmFoundryId` and read back synchronously via
 * `getCachedFoundryId`.
 *
 * @param {string} sourceId — semantic source ID, e.g. "spell-fireball"
 * @returns {Promise<string|null>} 16-char Foundry `_id`, or null when
 *   input is empty/non-string.
 */
export async function foundryIdFromSourceId(sourceId) {
  if (!sourceId || typeof sourceId !== "string") return null;
  const seed = `${MODULE_ID}:${sourceId}`;
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(seed));
  return encodeBase62(new Uint8Array(buffer));
}

// ─── Per-session cache for sync-readable drag handlers ──────────────
//
// `dragstart` cannot `await` — so any drag flow that needs the
// deterministic id has to have the value computed BEFORE the user
// initiates the drag. The standard pattern: hover fires a
// `prewarmFoundryId` (async; runs alongside the tooltip fetch),
// caches the result, and `dragstart` reads from `getCachedFoundryId`
// synchronously.
//
// Cache is process-local — survives across React renders but resets
// on world reload. That's fine: hash inputs are deterministic, so
// re-warming costs ~1ms per entry.

const idCache = new Map();

/**
 * Synchronously read a previously-warmed Foundry id for a sourceId.
 * Returns null when the id hasn't been pre-computed yet.
 *
 * @param {string} sourceId
 * @returns {string|null}
 */
export function getCachedFoundryId(sourceId) {
  return idCache.get(sourceId) ?? null;
}

/**
 * Pre-warm the cache for a sourceId. Idempotent — repeated calls
 * for the same input return the cached value without re-hashing.
 *
 * Hover-handler use:
 *   element.addEventListener("mouseenter", () => {
 *     prewarmFoundryId(sourceId);
 *   });
 *   element.addEventListener("dragstart", (event) => {
 *     const id = getCachedFoundryId(sourceId);
 *     // ...use id in drag payload
 *   });
 *
 * @param {string} sourceId
 * @returns {Promise<string|null>}
 */
export async function prewarmFoundryId(sourceId) {
  if (!sourceId) return null;
  if (idCache.has(sourceId)) return idCache.get(sourceId);
  const id = await foundryIdFromSourceId(sourceId);
  if (id) idCache.set(sourceId, id);
  return id;
}

// ─── Internal: bytes → 16-char base62 ───────────────────────────────

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function encodeBase62(bytes) {
  // Take first 12 bytes = 96 bits. 62^16 ≈ 4.77e28, just enough to
  // represent any 95-bit value uniquely; padding to 16 chars below.
  let num = 0n;
  for (let i = 0; i < 12; i++) num = (num << 8n) | BigInt(bytes[i]);
  let out = "";
  while (out.length < 16) {
    out = BASE62[Number(num % 62n)] + out;
    num /= 62n;
  }
  return out.slice(-16);
}
