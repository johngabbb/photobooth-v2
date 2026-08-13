/**
 * Brand constants, sampled from the logo artwork.
 *
 * These exist as plain hex because the canvas renderer cannot read CSS custom
 * properties — see docs/decisions.md D7. They mirror the `@theme` block in
 * `src/app/globals.css`; change both together.
 *
 * Values were measured per-region out of `public/brand/photobee.png` rather than
 * picked by eye, so a card rendered on canvas and the surrounding UI use the exact
 * same oranges and yellows. Method is recorded in docs/brand.md.
 */
import type { Role } from "./types";

export const BRAND = {
  /** Linework and body text. */
  ink: "#1E1F18",
  /** Pumpkin body, and the bee's cheeks. */
  pumpkin: "#FA8730",
  /** Bee body and stripes. */
  honey: "#FCC44D",
  /** The leaf. Deeper and more olive than it looks at a glance. */
  leaf: "#598718",
  /** Wings — a cool off-white, not pure white. */
  wing: "#E0EFEE",
  /** Derived: page background. */
  cream: "#FFF4E2",
  /** Derived: raised surfaces and card stock. */
  paper: "#FFFCF6",
} as const;

/**
 * Card stocks that are not in the logo.
 *
 * Deliberately separate from BRAND: every value there was measured out of
 * `photobee.png`, and these were chosen. Folding them in would quietly make that
 * claim false for whoever reads it next. Mirrored in `globals.css` all the same —
 * D7 applies to any colour that exists in both places.
 */
export const STOCK = {
  /** A pale strawberry pink. */
  strawberry: "#FFC0CB",
  /**
   * Mint. Picked at the strawberry's lightness rather than by eye, so the two sit
   * together as a pair rather than one shouting over the other.
   */
  mint: "#AAF0D1",
} as const;

/**
 * Palettes for the procedural backdrops. Sampled off the reference photographs
 * rather than the logo, so like STOCK they live outside BRAND.
 */
export const SPECIAL = {
  /** Deepest point of a curtain fold — very nearly black. */
  curtainShadow: "#240407",
  /** Where the light catches the velvet. */
  curtainLight: "#A9121A",
  /** Film base. Not pure black; stock never is. */
  filmBase: "#0B0B0C",
  /** Sprocket holes and the frame edge. */
  filmHole: "#F5F5F3",
} as const;

/** Product name, as it appears in the logo wordmark. */
export const APP_NAME = "pamkin photo bee";

/** Blend two `#rrggbb` values. `t` is how far to travel from `a` toward `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => {
    const va = (na >> shift) & 255;
    const vb = (nb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  const n = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${n.toString(16).padStart(6, "0").toUpperCase()}`;
}

/**
 * Surface for a photo that is not there yet, per role.
 *
 * Mixed from the sampled palette toward the card stock rather than picked by eye,
 * so these stay tied to the logo colours and follow if BRAND ever moves. They sit
 * well back from full saturation on purpose: a waiting slot should read as absence,
 * not as a photograph that has already arrived.
 *
 * `line` keeps the source colour at full strength — it is only ever drawn at low
 * alpha, and needs the saturation to stay visible against the pale fill.
 */
export const PLACEHOLDER_TINTS: Record<Role, PlaceholderTint> = {
  pamkin: {
    from: mixHex(BRAND.pumpkin, BRAND.cream, 0.62),
    to: mixHex(BRAND.pumpkin, BRAND.cream, 0.42),
    line: BRAND.pumpkin,
  },
  bee: {
    from: mixHex(BRAND.honey, BRAND.cream, 0.62),
    to: mixHex(BRAND.honey, BRAND.cream, 0.42),
    line: BRAND.honey,
  },
};

export interface PlaceholderTint {
  /** Gradient start, top-left. */
  from: string;
  /** Gradient end, bottom-right. */
  to: string;
  /** Full-strength source colour, for linework drawn over the fill. */
  line: string;
}

/**
 * Font stack for text drawn onto a card.
 *
 * Concrete families only. Canvas `font` strings do not get the CSS fallback
 * treatment you might expect: an unresolvable first entry like `ui-sans-serif` can
 * drop the whole declaration to the platform default, which on some renderers is a
 * serif. Naming real families keeps card typography predictable everywhere.
 */
export const CARD_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, ' +
  '"Ubuntu Sans", "DejaVu Sans", sans-serif';

export const BRAND_ASSETS = {
  /** Bee-on-pumpkin mark, square, transparent. */
  mark: "/brand/photobee-mark.png",
  /** Mark plus wordmark, portrait. */
  logo: "/brand/photobee-logo.png",
  /** Wordmark alone. */
  wordmark: "/brand/photobee-wordmark.png",
} as const;
