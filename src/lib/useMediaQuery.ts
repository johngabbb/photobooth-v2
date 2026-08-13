"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * `useSyncExternalStore` rather than an effect that calls `setState`: the React 19
 * lint rules reject the latter (see CLAUDE.md), and this shape has no intermediate
 * render where the value is wrong.
 *
 * Use it only where a breakpoint changes *what is rendered*. Anything that is purely
 * visual belongs in a Tailwind `lg:` / `xl:` variant, which costs no JavaScript and
 * cannot desynchronise from the CSS.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Never reached: every consumer mounts client-only through `ssr: false`. Present
    // so the hook is safe if that ever changes.
    () => false,
  );
}

/** The Tailwind `xl` breakpoint, where a third column becomes affordable. */
export const XL_QUERY = "(min-width: 80rem)";
