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
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end sm:px-0"
    >
      {notices.map((n) => (
        <div
          key={n.id}
          className="notice-in max-w-full rounded-full border border-ink/10 bg-paper/95 px-4 py-2 text-sm font-medium text-ink/80 shadow-lg shadow-ink/15 backdrop-blur"
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}
