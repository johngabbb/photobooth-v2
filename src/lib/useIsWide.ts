"use client";

import { useEffect, useState } from "react";

/**
 * Is there room for a side-by-side layout?
 *
 * Matches Tailwind's `lg` breakpoint. This is a real layout decision, not styling:
 * the room measures its stage in JS to fit an aspect ratio, so the *shape* it fits
 * has to change with the breakpoint, and CSS alone cannot tell the measuring code
 * which ratio to use.
 */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1024px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return wide;
}
