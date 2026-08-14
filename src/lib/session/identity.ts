/**
 * What this device's owner is called.
 *
 * Kept separate from `Presence` because it outlives any one room: the name is asked
 * for once and remembered, so a second session — or a reload in the middle of the
 * first — does not ask again. `localStorage`, not `sessionStorage`, for exactly that
 * reason; the host claim next door is per-tab by design, a person is not.
 *
 * A name is never required. Everything that displays one falls back to the role label
 * (`Pamkin` / `Bee`), which is what the room said before names existed, so an empty
 * name degrades to the old behaviour rather than to a blank.
 */

const KEY = "pamkin:name";

/**
 * Long enough for a first name or a handle, short enough to sit in a presence row
 * and a notice without wrapping.
 */
export const NAME_MAX = 16;

/** Tidy a typed name: one space between words, no edges, capped. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/**
 * The stored name, or `""` if this device has never been asked.
 *
 * Guarded because storage throws rather than returning null in a few real
 * configurations — Safari's private mode historically, and any browser with
 * cookies-and-site-data blocked. A booth that will not open because it cannot
 * remember a nickname would be a poor trade.
 */
export function readName(): string {
  try {
    return cleanName(localStorage.getItem(KEY) ?? "");
  } catch {
    return "";
  }
}

export function writeName(name: string): void {
  const clean = cleanName(name);
  try {
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    /* See `readName`. The name still works for this page's lifetime. */
  }
}
