/**
 * Core domain types for the Pamkin and Bee photobooth.
 *
 * The geometry here is deliberately declarative: a Layout describes *what* a card
 * is, and `src/lib/render.ts` derives every rectangle from it. Adding a new photo
 * count or card format is a data change, never a new code path.
 */

/** The two participants. Roles are fixed labels, not user identities. */
export type Role = "pamkin" | "bee";

export const ROLES: readonly Role[] = ["pamkin", "bee"] as const;

/**
 * How a single slot divides between the two people.
 *
 * Because both cameras fire on the same countdown, every slot in a duo card holds
 * both people — there is no "A's frame vs B's frame". This picks the seam.
 */
export type SplitMode = "none" | "vertical" | "horizontal";

/** Card format: one camera or two. */
export type CardMode = "solo" | "duo";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A card format. All dimensions are *design pixels* at 300 DPI, so a 2x6 inch
 * strip is 600x1800. The renderer multiplies by a scale factor at export time.
 */
export interface Layout {
  id: string;
  /** Shown in the picker. */
  name: string;
  /** Human-readable physical size, e.g. `2" x 6"`. */
  physical: string;
  mode: CardMode;
  /** Number of shots, i.e. number of slots down the card. */
  slots: number;
  split: SplitMode;
  canvas: { w: number; h: number };
  padding: Inset;
  /** Vertical space between slots. */
  gap: number;
  /** Space between the two halves of a split slot. */
  splitGap: number;
  /** Reserved strip at the bottom for the title and date. */
  footer: number;
  /** Corner radius on each photo half. */
  radius: number;
}

/** Colours for a rendered card. Kept separate from Layout so themes and formats compose freely. */
export interface CardTheme {
  id: string;
  name: string;
  /** Card stock behind the photos. */
  paper: string;
  /** Title, date, and any text. */
  ink: string;
  /** Thin rule under each photo half; set to `null` to omit. */
  accent: string | null;
}

/**
 * One captured moment. Both roles are captured at the same instant, but a half may
 * be `null` while a session is mid-flight or in solo mode.
 */
export type Shot = Partial<Record<Role, CanvasImageSource | null>>;

export interface CardContent {
  /**
   * Free text in the footer, under the mark. Usually a date.
   *
   * There is deliberately no title field: the logo *is* the wordmark, so printing
   * "pamkin photo bee" beside it said the same thing twice.
   */
  caption: string;
}

export interface RenderInput {
  layout: Layout;
  theme: CardTheme;
  content: CardContent;
  shots: Shot[];
  /**
   * Mirror each half horizontally. Selfie previews are mirrored because people
   * expect their own reflection; the printed output usually should not be.
   */
  mirror: boolean;
  /**
   * The bee-on-pumpkin mark, drawn in the footer beside the title. Optional so the
   * renderer stays usable before the image has loaded — the card simply centres its
   * text instead.
   */
  logo?: CanvasImageSource | null;
  /** Multiplier over the layout's design pixels. 1 = 300 DPI. */
  scale: number;
}
