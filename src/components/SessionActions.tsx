"use client";

import Link from "next/link";
import { useCreateSession } from "@/lib/session/useCreateSession";

/** The two ways into a room from the landing page: create one, or join one. */
export function SessionActions({ showSolo = false }: { showSolo?: boolean }) {
  const { create, creating } = useCreateSession();

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={create}
        disabled={creating}
        className="rounded-full bg-pumpkin px-8 py-3.5 text-base font-semibold text-cream shadow-lg shadow-pumpkin/30 transition duration-200 ease-out enabled:hover:-translate-y-0.5 enabled:hover:shadow-xl enabled:hover:shadow-pumpkin/45 enabled:hover:brightness-105 enabled:active:translate-y-0 enabled:active:shadow-md focus-visible:ring-2 focus-visible:ring-pumpkin focus-visible:ring-offset-2 focus-visible:ring-offset-cream focus-visible:outline-none motion-reduce:transition-none motion-reduce:enabled:hover:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {creating ? "Creating room…" : "Start a session"}
      </button>

      <Link
        href="/join"
        className="rounded-full border border-ink/15 px-6 py-2.5 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
      >
        Join with a code
      </Link>

      {showSolo && (
        <Link
          href="/solo"
          className="mt-1 text-xs text-ink/45 underline-offset-4 hover:text-ink hover:underline"
        >
          Or use the booth on your own
        </Link>
      )}
    </div>
  );
}
