import { BRAND } from "./brand";
import type { CardBorder, CardTheme, Layout } from "./types";

/**
 * Card formats, in design pixels at 300 DPI.
 *
 * Sizing note (see docs/decisions.md): a classic 2x6 strip split vertically gives
 * each person a 1-inch column, which crops brutally on a 4:3 camera feed. Duo cards
 * therefore default to 4x6, where each half is a comfortable ~1.8 inches. The tall
 * strip stays available for solo mode, where the full width is one person's.
 */

const DUO_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
const SOLO_PADDING = { top: 36, right: 36, bottom: 36, left: 36 };

/** 4" x 6" at 300 DPI. */
const DUO_CANVAS = { w: 1200, h: 1800 };
/** 2" x 6" at 300 DPI. */
const SOLO_CANVAS = { w: 600, h: 1800 };

function duo(slots: number): Layout {
  return {
    id: `duo-${slots}`,
    name: `${slots} photos`,
    physical: '4" x 6"',
    mode: "duo",
    slots,
    split: "vertical",
    canvas: DUO_CANVAS,
    padding: DUO_PADDING,
    gap: 24,
    splitGap: 10,
    footer: 180,
    radius: 14,
  };
}

function solo(slots: number): Layout {
  return {
    id: `solo-${slots}`,
    name: `${slots} photos`,
    physical: '2" x 6"',
    mode: "solo",
    slots,
    split: "none",
    canvas: SOLO_CANVAS,
    padding: SOLO_PADDING,
    gap: 20,
    splitGap: 0,
    footer: 150,
    radius: 12,
  };
}

/** Supported photo counts. Everything downstream derives from this list. */
export const PHOTO_COUNTS = [2, 3, 4] as const;

export type PhotoCount = (typeof PHOTO_COUNTS)[number];

export const LAYOUTS: Layout[] = [
  ...PHOTO_COUNTS.map(duo),
  ...PHOTO_COUNTS.map(solo),
];

export function findLayout(id: string): Layout | undefined {
  return LAYOUTS.find((l) => l.id === id);
}

/** The layout for a given mode and photo count. */
export function layoutFor(mode: Layout["mode"], slots: number): Layout {
  const found = LAYOUTS.find((l) => l.mode === mode && l.slots === slots);
  if (!found) {
    throw new Error(`No ${mode} layout with ${slots} slots`);
  }
  return found;
}

/** Card themes, built from the sampled logo palette so cards match the branding. */
export const THEMES: CardTheme[] = [
  {
    id: "cream",
    name: "Cream",
    paper: BRAND.cream,
    ink: BRAND.ink,
    accent: BRAND.pumpkin,
  },
  {
    id: "honey",
    name: "Honey",
    paper: BRAND.honey,
    ink: BRAND.ink,
    accent: BRAND.ink,
  },
  {
    id: "pumpkin",
    name: "Pumpkin",
    paper: BRAND.pumpkin,
    ink: BRAND.paper,
    accent: BRAND.paper,
  },
  {
    id: "wing",
    name: "Wing",
    paper: BRAND.wing,
    ink: BRAND.ink,
    accent: BRAND.leaf,
  },
  {
    id: "ink",
    name: "Ink",
    paper: BRAND.ink,
    ink: BRAND.paper,
    accent: BRAND.honey,
  },
];

/**
 * Border ornaments, chosen on top of whichever colour theme is active.
 *
 * Data, like everything else here — adding a motif is an entry in this list plus a
 * draw case in `render.ts`, never a branch in the pickers.
 */
export const BORDERS: CardBorder[] = [
  { id: "plain", name: "Plain", motif: null },
  { id: "bee", name: "Bees", motif: "bee" },
  { id: "pamkin", name: "Pamkins", motif: "pamkin" },
  { id: "both", name: "Bees & pamkins", motif: "both" },
];

export function findBorder(id: string): CardBorder {
  return BORDERS.find((b) => b.id === id) ?? BORDERS[0];
}

export function findTheme(id: string): CardTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
