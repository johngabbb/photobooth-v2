"use client";

import { useEffect, useState } from "react";
import { BRAND_ASSETS } from "./brand";

/**
 * Load the brand mark for stamping onto a card.
 *
 * `renderCard` treats the logo as optional, so the first paint simply omits it and
 * the mark appears once decoded — no blocking, no layout shift.
 */
export function useBrandMark(): HTMLImageElement | null {
  const [mark, setMark] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setMark(img);
    img.src = BRAND_ASSETS.mark;
    return () => {
      img.onload = null;
    };
  }, []);

  return mark;
}
