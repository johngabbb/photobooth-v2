import { AppHeader } from "@/components/AppHeader";
import BoothMount from "@/components/BoothMount";

export const metadata = { title: "Solo booth — pamkin photo bee" };

export default function SoloPage() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="solo" />
      <BoothMount />
    </main>
  );
}
