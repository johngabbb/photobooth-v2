"use client";

import dynamic from "next/dynamic";

/**
 * Mounts the booth client-side only.
 *
 * Nothing here is server-renderable: the renderer needs a canvas, and the booth
 * needs `getUserMedia`. See docs/decisions.md D4.
 */
const Booth = dynamic(() => import("./Booth").then((m) => m.Booth), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink/40">
      Loading booth…
    </div>
  ),
});

export default function BoothMount() {
  return <Booth />;
}
