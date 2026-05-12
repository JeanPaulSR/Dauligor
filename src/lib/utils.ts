import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')     // Replace spaces with -
    .replace(/[^\w-]+/g, '')   // Remove all non-word chars
    .replace(/--+/g, '-');    // Replace multiple - with single -
}

/**
 * Produce an ID matching Foundry's `foundry.utils.randomID()` shape:
 * exactly 16 characters drawn from `[A-Za-z0-9]`. dnd5e 5.x's
 * PseudoDocument / DataModel validators reject any other length or
 * character set on activity / effect / profile `_id` fields ("must
 * be a valid 16-character alphanumeric ID"), so anywhere we author
 * a document id that will eventually round-trip to Foundry has to
 * use this rather than the previous `Math.random().toString(36).slice(2, 18)`
 * trick (which produced shorter IDs when the random float happened
 * to start with `0.0…`).
 *
 * Browser-safe — uses `crypto.getRandomValues` for entropy when
 * available (modern browsers + Node), falls back to `Math.random`
 * for older runtimes. The character alphabet matches Foundry's
 * `_generateId` definition.
 */
const FOUNDRY_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function makeFoundryId(length: number = 16): string {
  const alphabetLength = FOUNDRY_ID_ALPHABET.length;
  let out = "";
  const c = typeof globalThis !== "undefined"
    ? (globalThis as any).crypto
    : null;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(length);
    c.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      out += FOUNDRY_ID_ALPHABET.charAt(bytes[i] % alphabetLength);
    }
    return out;
  }
  // Cryptographically-weak fallback. Still produces a 16-char
  // alphanumeric string, which is what the Foundry validator
  // actually checks.
  for (let i = 0; i < length; i++) {
    out += FOUNDRY_ID_ALPHABET.charAt(Math.floor(Math.random() * alphabetLength));
  }
  return out;
}
