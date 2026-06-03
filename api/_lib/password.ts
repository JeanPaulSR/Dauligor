// Native password hashing for self-rolled auth (the Firebase Auth exit).
//
// scrypt via @noble/hashes — pure JS, no native addons, so it runs identically
// in Node (local dev / Express) and in the Cloudflare Workers runtime (Pages
// Functions). Randomness and base64 come from Web Crypto + btoa/atob, both of
// which are globals in Node 18+ and Workers.
//
// Stored format is a self-describing PHC-ish string so the cost parameters can
// be tuned later WITHOUT a data migration — verifyPassword() reads N/r/p back
// out of each stored hash, and a rehash-on-login can transparently upgrade old
// hashes. See docs/_drafts/auth-cloudflare-migration-plan-2026-05-31.html.
//
//   scrypt$<N>$<r>$<p>$<salt-b64>$<dk-b64>

import { scryptAsync } from "@noble/hashes/scrypt.js";

// Interactive-login cost. Peak memory ≈ 128 · N · r · p bytes ≈ 33 MB at these
// values — comfortably inside the Workers 128 MB ceiling — and a few hundred ms
// of CPU per verify, which is fine for a low-traffic, high-trust app. N must be
// a power of two.
const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DK_LEN = 32;
const SALT_LEN = 16;
const SCHEME = "scrypt";

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Constant-time compare so a verify never leaks how many leading bytes matched.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Hash a plaintext password into a self-describing scrypt string suitable for
 * storage in `users.password_hash`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const dk = await scryptAsync(password.normalize("NFKC"), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: DK_LEN,
  });
  return [SCHEME, SCRYPT_N, SCRYPT_R, SCRYPT_P, toB64(salt), toB64(dk)].join("$");
}

/**
 * Verify a plaintext password against a stored scrypt string. Returns false for
 * any malformed/missing hash rather than throwing, so callers can treat it as a
 * plain boolean gate.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromB64(parts[4]);
    expected = fromB64(parts[5]);
  } catch {
    return false;
  }
  const dk = await scryptAsync(password.normalize("NFKC"), salt, {
    N,
    r,
    p,
    dkLen: expected.length,
  });
  return timingSafeEqual(dk, expected);
}
