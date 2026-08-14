"use client";

import { useState } from "react";
import { NAME_MAX, cleanName, readName, writeName } from "@/lib/session/identity";

/**
 * "What should we call you?", asked once, over the room.
 *
 * Deliberately the *only* place it is asked. Creating and joining could each have had
 * their own field, but the second person usually arrives by QR straight to
 * `/room/CODE` and passes through neither — so those fields would have been a
 * second implementation of a question this one has to ask anyway.
 *
 * Required: there is no dismiss and the button stays disabled until something has
 * been typed. The room is deliberately left visible behind it — you can see the
 * cameras and the code you are about to join — but the backdrop covers the viewport,
 * so nothing under it can be clicked until the question is answered.
 */
export function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  // Pre-filled from the last answer, so a returning visitor confirms rather than
  // retypes. Lazy initial state, not an effect: the room is client-only.
  const [name, setName] = useState(readName);
  const valid = cleanName(name).length > 0;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-ink/45 p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const clean = cleanName(name);
          writeName(clean);
          onSubmit(clean);
        }}
        className="notice-pop-in flex w-full max-w-xs flex-col gap-4 rounded-2xl border border-ink/10 bg-cream p-6 shadow-2xl shadow-ink/30"
      >
        <div className="text-center">
          <h2 className="text-lg font-semibold text-ink">What should we call you?</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink/55">
            The other person sees this in the room and when you start a shoot. It is
            not printed on the card.
          </p>
        </div>

        <input
          value={name}
          // Only the length is enforced as you type. Collapsing whitespace here would
          // stop you typing a space between two words at all; that happens on submit.
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          maxLength={NAME_MAX}
          autoFocus
          autoComplete="nickname"
          spellCheck={false}
          aria-label="Your name"
          placeholder="Your name"
          className="w-full rounded-xl border-2 border-ink/15 bg-paper px-4 py-2.5 text-center text-base font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink/25 focus:border-pumpkin"
        />

        <button
          type="submit"
          disabled={!valid}
          className="rounded-full bg-pumpkin px-5 py-3 text-sm font-semibold text-cream shadow-lg shadow-pumpkin/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Enter the room
        </button>
      </form>
    </div>
  );
}
