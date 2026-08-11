import { AppHeader } from "@/components/AppHeader";
import { JoinForm } from "@/components/JoinForm";

export const metadata = { title: "Join a session — pamkin photo bee" };

export default function JoinPage() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <AppHeader current="home" />
      <JoinForm />
    </main>
  );
}
