import { AppHeader } from "@/components/AppHeader";
import { Landing } from "@/components/Landing";

export default function HomePage() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="home" />
      <Landing />
    </main>
  );
}
