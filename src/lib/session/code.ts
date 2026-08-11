/**
 * Room codes.
 *
 * Crockford's Base32 alphabet: no I, L, O, or U. The first three are dropped because
 * they are indistinguishable from 1 and 0 when read off a phone screen across a room;
 * U is dropped so the generator cannot spell anything unfortunate.
 *
 * The point of Crockford specifically is that it defines *decoding* too — a typed "O"
 * becomes 0 and a typed "I" or "L" becomes 1, so the confusion is fixed on input
 * instead of being an error the user has to diagnose.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LENGTH = 5;

/** Crypto-random room code. 32^5 ≈ 33.5M — collisions are not a practical concern. */
export function generateCode(length: number = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let out = "";
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

/**
 * Clean up user input: uppercase, resolve the ambiguous glyphs, drop anything else
 * (spaces, dashes, and the stray characters people add when reading aloud).
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("");
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}
