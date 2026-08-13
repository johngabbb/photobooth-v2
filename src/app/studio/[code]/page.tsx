import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import CardStudioMount from "@/components/CardStudioMount";
import { isValidCode, normalizeCode } from "@/lib/session/code";

/**
 * `/studio/[code]` — the studio holding a card that came out of a room.
 *
 * The code is not what carries the photographs; those ride in memory (see
 * `lib/handoff.ts`). It is here so the URL says which room the card came from, and
 * so a reload — which loses the handoff — can still offer a way back to that room
 * rather than stranding you on a page of placeholders.
 */
export default async function StudioCodePage({
  params,
}: PageProps<"/studio/[code]">) {
  // Next 16: params is a Promise.
  const { code } = await params;
  const normalized = normalizeCode(code);

  if (!isValidCode(normalized)) notFound();

  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="studio" />
      <CardStudioMount code={normalized} />
    </main>
  );
}
