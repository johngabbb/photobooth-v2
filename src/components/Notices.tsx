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
 * A cloud's end.
 *
 * The bumps along the top are a repeating background (`.notice-cloud` in
 * globals.css) so their *number* grows with the text rather than the gaps between
 * them — which is what a fixed set of puffs got wrong: short notices bunched, long
 * ones spread into flat stretches. A repeat has to stop somewhere though, and it
 * stops mid-bump, leaving a straight cut. These two circles are anchored to the ends
 * in `em` — not at a percentage, so they hold position at any width — and cover it.
 */
function Cap({ className }: { className: string }) {
  return <span aria-hidden className={`absolute rounded-full bg-pumpkin ${className}`} />;
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
      // controls underneath.
      aria-live="polite"
      // `top-24` clears `AppHeader`, which is 89px tall on every breakpoint (a 56px
      // mark plus its padding and rule). Anything less and the cloud sits on the logo.
      className="pointer-events-none fixed inset-x-0 top-24 z-50 flex flex-col items-center gap-7 px-4"
    >
      {notices.map((n) => (
        // The pumpkin fill is `PrimaryButton`'s, so a notice speaks in the one accent
        // colour the room already uses.
        <div
          key={n.id}
          data-leaving={n.leaving || undefined}
          className="notice-cloud relative max-w-full text-sm"
        >
          <Cap className="-top-[1.05em] left-[0.5em] h-[2.3em] w-[2.3em]" />
          <Cap className="-top-[0.85em] right-[0.5em] h-[1.95em] w-[1.95em]" />
          {/* Last in the DOM so the body paints over the bumps' lower halves and the
              text sits clear of all of them. `min-w` stops a two-word notice from
              being too narrow to fit a full bump between its end caps. */}
          <div className="relative min-w-[11em] rounded-full bg-pumpkin px-7 py-3.5 text-center font-semibold text-cream">
            {n.text}
          </div>
        </div>
      ))}
    </div>
  );
}
