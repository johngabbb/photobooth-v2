"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Transient announcements about the other person: they arrived, they started the
 * shoot, they cancelled it.
 *
 * Only things you would otherwise miss. The room already shows presence as a dot and
 * the countdown as a giant digit — this is for the moment *between* those, where
 * something changed on the other device and your own screen has not caught up yet.
 * Your own actions are deliberately never announced back to you: you just did them.
 */

export interface Notice {
  id: number;
  text: string;
  /** Playing its exit animation, still mounted so the animation can finish. */
  leaving: boolean;
}

/** How long a notice stays up. Long enough to read mid-pose, short enough to ignore. */
const TTL_MS = 4200;
/** Must match the `notice-vanish` animation in globals.css. */
const EXIT_MS = 300;
/** Older ones fall off rather than stacking down the screen. */
const MAX = 3;

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  const notify = useCallback((text: string) => {
    const id = nextId.current++;
    setNotices((prev) => [...prev, { id, text, leaving: false }].slice(-MAX));

    // Two stages, because a notice cannot animate out of a DOM it has already left:
    // it is flagged first and removed a beat later, once the exit has played.
    timers.current.push(
      window.setTimeout(() => {
        setNotices((prev) =>
          prev.map((n) => (n.id === id ? { ...n, leaving: true } : n)),
        );
        timers.current.push(
          window.setTimeout(() => {
            setNotices((prev) => prev.filter((n) => n.id !== id));
          }, EXIT_MS),
        );
      }, TTL_MS),
    );
  }, []);

  // Leaving the room mid-notice would otherwise leave a timer holding a setState.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(window.clearTimeout);
  }, []);

  return { notices, notify };
}

/**
 * Fixed rather than in the layout: the page never scrolls (D10) and every pane is
 * already sized to the viewport, so there is no row to give this without taking it
 * from the cameras.
 */
export function Notices({ notices }: { notices: Notice[] }) {
  return (
    <div
      // Announced to screen readers, since the whole point is a change you did not
      // make. `pointer-events-none` keeps it from stealing a tap meant for the
      // controls underneath — including the header links it floats over.
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-3 px-4"
    >
      {notices.map((n) => (
        // Shaped like `PrimaryButton` and in its accent colour, but a lighter mix of
        // it — see `.notice-pill` in globals.css, which owns the fill.
        <div
          key={n.id}
          data-leaving={n.leaving || undefined}
          className="notice-pill max-w-full rounded-full px-5 py-3 text-center text-sm font-semibold text-ink shadow-lg shadow-pumpkin/30"
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}
