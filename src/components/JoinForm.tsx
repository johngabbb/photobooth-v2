"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NameField, useNameInput } from "@/components/NameField";
import { CODE_LENGTH, isValidCode, normalizeCode } from "@/lib/session/code";

export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { name, setName, commit, valid: named } = useNameInput();

  const valid = isValidCode(code);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError(`Room codes are ${CODE_LENGTH} characters.`);
      return;
    }
    // Stored before navigating, so the room finds a name already waiting and does
    // not ask a second time.
    commit();
    router.push(`/room/${code}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-ink">Join a session</h1>
        <p className="mt-1.5 text-sm text-ink/55">
          Enter the code shown on the other person&rsquo;s screen.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col items-center gap-4">
        <input
          value={code}
          // Normalising on every keystroke means O/0 and I/1 mix-ups are fixed as the
          // user types, rather than becoming an error they have to work out.
          onChange={(e) => {
            setCode(normalizeCode(e.target.value).slice(0, CODE_LENGTH));
            setError(null);
          }}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Room code"
          placeholder="-----"
          className="w-64 rounded-xl border-2 border-ink/15 bg-paper px-4 py-3 text-center font-mono text-3xl font-bold tracking-[0.3em] text-ink outline-none placeholder:text-ink/20 focus:border-pumpkin"
        />

        {error && <p className="text-xs text-pumpkin">{error}</p>}

        <div className="w-64">
          <NameField value={name} onChange={setName} />
        </div>

        <button
          type="submit"
          disabled={!valid || !named}
          className="rounded-full bg-pumpkin px-8 py-3 text-sm font-semibold text-cream shadow-lg shadow-pumpkin/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Join room
        </button>
      </form>
    </div>
  );
}
