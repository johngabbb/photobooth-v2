"use client";

import type { CardMode, Shot } from "./types";

/**
 * A finished card, handed from the room to the studio across a navigation.
 *
 * Module state, deliberately. The shots are live canvases and images — the same
 * objects `renderCard` draws — so there is nothing to serialise and nothing to
 * decode on the other side. Client-side navigation keeps this module loaded, so the
 * handoff survives the route change without touching storage.
 *
 * The trade is that a hard reload of `/studio` loses it and falls back to the
 * synthetic placeholders. That is the right failure: writing megabytes of base64
 * into `sessionStorage` to survive a refresh nobody performs would also be the first
 * time this app ever persisted a photograph, which `frames.ts` goes out of its way
 * to avoid.
 */
export interface CardHandoff {
  shots: Shot[];
  mode: CardMode;
  count: number;
  themeId: string;
  borderId: string;
  filterId: string;
  caption: string;
  mirror: boolean;
}

let pending: CardHandoff | null = null;

/** Park a card for the studio to pick up. Replaces anything already waiting. */
export function stageCard(card: CardHandoff) {
  pending = card;
}

/**
 * The card waiting for the studio, if any.
 *
 * Does not clear on read: React may run a lazy initialiser more than once, and a
 * consuming read would hand the photographs to the first call and `null` to the
 * second.
 */
export function readCard(): CardHandoff | null {
  return pending;
}

/** Drop the parked card — used when the studio is done with it. */
export function clearCard() {
  pending = null;
}
