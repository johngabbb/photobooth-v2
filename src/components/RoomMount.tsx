"use client";

import dynamic from "next/dynamic";

/** Client-only: the room needs `getUserMedia`, a canvas, and the realtime channel. */
const Room = dynamic(() => import("./Room").then((m) => m.Room), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink/40">
      Joining room…
    </div>
  ),
});

/** `code` is null on `/room`: the room renders, but with no session joined yet. */
export default function RoomMount({ code }: { code: string | null }) {
  return <Room code={code} />;
}
