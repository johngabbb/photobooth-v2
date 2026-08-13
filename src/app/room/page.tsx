import { AppHeader } from "@/components/AppHeader";
import RoomMount from "@/components/RoomMount";

/**
 * `/room` with no code — the room itself, before a session exists.
 *
 * Not a separate landing screen: it is the same booth, with the code-and-QR panel
 * showing Create / Join instead. The nav can point here safely because arriving does
 * not mint a room; only pressing Create does. A link that generated a code on every
 * click would litter abandoned rooms and host claims.
 */
export default function RoomIndexPage() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="room" />
      <RoomMount code={null} />
    </main>
  );
}
