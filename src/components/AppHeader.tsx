import Image from "next/image";
import Link from "next/link";
import { APP_NAME, BRAND_ASSETS } from "@/lib/brand";

/**
 * Compact horizontal lockup. The full logo is portrait, so a nav bar pairs the
 * square mark with the wordmark rather than shrinking the lockup until the wordmark
 * is unreadable.
 */
export function AppHeader({
  current,
}: {
  current: "home" | "room" | "solo" | "studio";
}) {
  return (
    <header className="flex shrink-0 items-center gap-3.5 border-b border-ink/10 bg-paper/70 px-6 py-4">
      <Link href="/" className="flex items-center gap-3.5">
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
      </Link>

      <nav className="ml-auto flex items-center gap-1 text-xs">
        <NavLink href="/" label="Home" active={current === "home"} />
        {/* Points at `/room`, never at a code: the nav is on every page, and a link
            that minted a room on each click would litter abandoned codes. */}
        <NavLink href="/room" label="Room" active={current === "room"} />
        <NavLink href="/solo" label="Solo" active={current === "solo"} />
        <NavLink href="/studio" label="Studio" active={current === "studio"} />
      </nav>
    </header>
  );
}

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 transition ${
        active ? "bg-ink/8 font-semibold text-ink" : "text-ink/45 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
