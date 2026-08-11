"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Largest box of a given aspect ratio that fits the observed container.
 *
 * Measured rather than expressed in CSS, because CSS cannot express it here. A card
 * canvas gets aspect-correct scaling free from its bitmap's intrinsic ratio, but
 * there is no equivalent for a box wrapping video elements plus overlays:
 *
 * - `aspect-ratio` on a bare div has no intrinsic size to scale from — one axis wins
 *   and the ratio breaks.
 * - An `<svg>` spacer looks like the canvas trick but is not. Its `width`/`height`
 *   are *presentation attributes*: they become CSS declarations, so `max-width`
 *   clamps the width and leaves the height alone. A canvas's attributes set its
 *   bitmap instead, which is why only the canvas has an intrinsic ratio.
 * - Percentage `max-height` resolves against the parent's height, so any auto-height
 *   wrapper in the chain silently turns it into `none`.
 *
 * See docs/decisions.md D14 — this shipped broken once by looking like it worked.
 */
export function useFitBox(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const w = Math.min(width, height * ratio);
      setSize({ width: Math.round(w), height: Math.round(w / ratio) });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();

    return () => observer.disconnect();
  }, [ratio]);

  return { ref, size };
}
