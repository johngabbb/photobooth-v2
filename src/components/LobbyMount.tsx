"use client";

import dynamic from "next/dynamic";

/** Client-only: the lobby needs `getUserMedia`, `BroadcastChannel`, and a canvas. */
const Lobby = dynamic(() => import("./Lobby").then((m) => m.Lobby), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink/40">
      Joining room…
    </div>
  ),
});

export default function LobbyMount({ code }: { code: string }) {
  return <Lobby code={code} />;
}
