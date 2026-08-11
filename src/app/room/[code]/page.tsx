import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import LobbyMount from "@/components/LobbyMount";
import { isValidCode, normalizeCode } from "@/lib/session/code";

export default async function RoomPage({ params }: PageProps<"/room/[code]">) {
  // Next 16: params is a Promise.
  const { code } = await params;
  const normalized = normalizeCode(code);

  if (!isValidCode(normalized)) notFound();

  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="room" />
      <LobbyMount code={normalized} />
    </main>
  );
}
