import Image from "next/image";
import Link from "next/link";
import { APP_NAME, BRAND_ASSETS } from "@/lib/brand";

/**
 * Compact horizontal lockup. The full logo is portrait, so a nav bar pairs the
 * square mark with the wordmark rather than shrinking the lockup until the wordmark
 * is unreadable.
 *
 * On a phone the wordmark is dropped entirely. Four nav links plus the mark already
 * fill a 390px bar, and nothing here can shrink to make room: the links are text and
 * the mark is square. Left in, the wordmark simply overlapped "Home". The mark alone
 * still identifies the app — and the landing page prints the full lockup anyway, so
 * nothing is lost that a visitor has not already seen.
 */
export function AppHeader({
  current,
}: {
  current: "home" | "room" | "solo" | "studio";
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-ink/10 bg-paper/70 px-4 py-4 sm:gap-3.5 sm:px-6">
      <Link href="/" className="flex shrink-0 items-center gap-3.5">
        <Image
          src={BRAND_ASSETS.mark}
          alt=""
          width={626}
          height={626}
          priority
          className="h-14 w-14 shrink-0"
        />
        {/* Both images are decorative; the link is named by the label below instead.
            Putting the name on the wordmark's `alt` would have taken it away exactly
            when the wordmark is hidden, leaving an unlabelled link on phones. */}
        <Image
          src={BRAND_ASSETS.wordmark}
          alt=""
          width={581}
          height={269}
          priority
          className="hidden h-8 w-auto sm:block"
        />
        <span className="sr-only">{APP_NAME}</span>
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
      // Tighter pill on the narrowest phones. Four links at the roomier padding
      // needed 339px of a 320px bar, and the page is not allowed to scroll (D10).
      className={`rounded-full px-2 py-1.5 transition sm:px-3 ${
        active ? "bg-ink/8 font-semibold text-ink" : "text-ink/45 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
