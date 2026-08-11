import { AppHeader } from "@/components/AppHeader";
import CardStudioMount from "@/components/CardStudioMount";

export const metadata = {
  title: "Card studio — pamkin photo bee",
};

export default function StudioPage() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="studio" />
      <CardStudioMount />
    </main>
  );
}
