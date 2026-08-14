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
}

/** How long a notice stays up. Long enough to read mid-pose, short enough to ignore. */
const TTL_MS = 4200;
/** Older ones fall off rather than stacking up the side of the screen. */
const MAX = 3;

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  const notify = useCallback((text: string) => {
    const id = nextId.current++;
    setNotices((prev) => [...prev, { id, text }].slice(-MAX));
    timers.current.push(
      window.setTimeout(() => {
        setNotices((prev) => prev.filter((n) => n.id !== id));
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
 * One puff of the cloud.
 *
 * The silhouette is a pill with circles straddling its edges, all in the same opaque
 * fill so the overlaps leave no seam. Every dimension is in `em` and every position a
 * percentage, so the cloud keeps its shape whatever the text inside it is — an SVG
 * path would have to be redrawn for each width.
 */
function Puff({ className }: { className: string }) {
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
      // `top-8` rather than a tighter offset: the tallest puff stands ~1.35em clear of
      // the body it rides on, and at the start of the drift-in it is higher still, so
      // anything less clips the cloud against the top of the window.
      // `gap-7` for the same reason: the puffs of the cloud below would otherwise
      // ride up into the base of the one above, and two clouds would read as one.
      className="pointer-events-none fixed inset-x-0 top-8 z-50 flex flex-col items-center gap-7 px-4"
    >
      {notices.map((n) => (
        // The pumpkin fill is `PrimaryButton`'s, so a notice speaks in the one accent
        // colour the room already uses.
        <div key={n.id} className="notice-cloud relative max-w-full text-sm">
          {/* Bumps along the top only; the base stays flat. Scalloping the underside
              too was tried and reads as fuzz rather than as a cloud. Sizes descend
              left to right off the tall one at 23%, which is what keeps five circles
              from looking like a row of identical teeth. */}
          <Puff className="-top-[0.85em] left-[6%] h-[1.9em] w-[1.9em]" />
          <Puff className="-top-[1.35em] left-[23%] h-[2.7em] w-[2.7em]" />
          <Puff className="-top-[1.05em] left-[45%] h-[2.25em] w-[2.25em]" />
          <Puff className="-top-[0.8em] left-[65%] h-[1.85em] w-[1.85em]" />
          <Puff className="-top-[0.6em] right-[6%] h-[1.55em] w-[1.55em]" />
          {/* Last in the DOM so the body paints over the puffs' lower halves and the
              text sits clear of all of them. `min-w` stops a two-word notice from
              pulling the five bumps into one blob. */}
          <div className="relative min-w-[11em] rounded-full bg-pumpkin px-7 py-3.5 text-center font-semibold text-cream">
            {n.text}
          </div>
        </div>
      ))}
    </div>
  );
}
