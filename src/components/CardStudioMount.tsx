"use client";

import dynamic from "next/dynamic";

/**
 * Mounts the studio client-side only.
 *
 * Nothing in the booth is server-renderable: the renderer needs a canvas, the
 * placeholders need `document`, and from Phase 1 the camera needs `getUserMedia`.
 * Opting out of SSR here means components downstream can read browser APIs during
 * render without hydration mismatches or `typeof window` guards scattered around.
 *
 * `ssr: false` is only permitted inside a Client Component, which is why this thin
 * wrapper exists rather than the dynamic import living in `page.tsx`.
 */
const CardStudio = dynamic(
  () => import("./CardStudio").then((m) => m.CardStudio),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink/40">
        Loading studio…
      </div>
    ),
  },
);

export default function CardStudioMount() {
  return <CardStudio />;
}
