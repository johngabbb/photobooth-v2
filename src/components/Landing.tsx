"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BRAND_ASSETS } from "@/lib/brand";
import { generateCode } from "@/lib/session/code";
import { claimHost } from "@/lib/session/useSession";

export function Landing() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  function startSession() {
    setStarting(true);
    const code = generateCode();
    // Claimed before navigating: the room decides host from this, so it must be set
    // before the channel is joined.
    claimHost(code);
    router.push(`/room/${code}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 py-6 text-center">
      <Image
        src={BRAND_ASSETS.logo}
        alt="pamkin photo bee"
        width={581}
        height={864}
        priority
        className="max-h-[38vh] w-auto"
      />

      <p className="max-w-md text-sm leading-relaxed text-ink/60">
        A photobooth for two. Open it on both your phones, and one countdown takes a
        picture on each — every frame has both of you in it.
      </p>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={startSession}
          disabled={starting}
          className="rounded-full bg-pumpkin px-8 py-3.5 text-base font-semibold text-cream shadow-lg shadow-pumpkin/30 transition duration-200 ease-out enabled:hover:-translate-y-0.5 enabled:hover:shadow-xl enabled:hover:shadow-pumpkin/45 enabled:hover:brightness-105 enabled:active:translate-y-0 enabled:active:shadow-md focus-visible:ring-2 focus-visible:ring-pumpkin focus-visible:ring-offset-2 focus-visible:ring-offset-cream focus-visible:outline-none motion-reduce:transition-none motion-reduce:enabled:hover:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {starting ? "Creating room…" : "Start a session"}
        </button>

        <Link
          href="/join"
          className="rounded-full border border-ink/15 px-6 py-2.5 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
        >
          Join with a code
        </Link>

        <Link
          href="/solo"
          className="mt-1 text-xs text-ink/45 underline-offset-4 hover:text-ink hover:underline"
        >
          Or use the booth on your own
        </Link>
      </div>
    </div>
  );
}
