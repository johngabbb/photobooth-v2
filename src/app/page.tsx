import Image from "next/image";
import CardStudioMount from "@/components/CardStudioMount";
import { APP_NAME, BRAND_ASSETS } from "@/lib/brand";

export default function Home() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      {/* Compact horizontal lockup. The full logo is portrait, so a nav bar pairs
          the square mark with the wordmark rather than shrinking the lockup until
          the wordmark is unreadable. */}
      <header className="flex shrink-0 items-center gap-3.5 border-b border-ink/10 bg-paper/70 px-6 py-4">
        <Image
          src={BRAND_ASSETS.mark}
          alt=""
          width={626}
          height={626}
          priority
          className="h-14 w-14"
        />
        <Image
          src={BRAND_ASSETS.wordmark}
          alt={APP_NAME}
          width={581}
          height={269}
          priority
          className="h-8 w-auto"
        />
        <span className="ml-auto text-xs text-ink/45">Card studio</span>
      </header>

      <CardStudioMount />
    </main>
  );
}
