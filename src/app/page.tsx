import CardStudioMount from "@/components/CardStudioMount";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-ink/10 px-6 py-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Pamkin <span className="text-pumpkin">and</span> Bee
        </h1>
        <p className="mt-2 text-sm text-ink/55">
          Card studio — layouts, themes, and export
        </p>
      </header>
      <CardStudioMount />
    </main>
  );
}
