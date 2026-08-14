"use client";

import { useState } from "react";
import { NAME_MAX, cleanName, readName, writeName } from "@/lib/session/identity";

/**
 * "What should we call you?", in the two shapes the app needs it.
 *
 * `NameField` sits inline on the way into a room — beside Create, beside Join — so
 * the answer is already stored by the time the room mounts. `NamePrompt` is the
 * safety net for everyone who never passes either: a QR code goes straight to
 * `/room/CODE`, which is the *usual* way the second person arrives.
 *
 * Both write through `identity.ts`, so answering once anywhere is answering for good.
 */

const PLACEHOLDER = "Your name";

/** Shared field. `value`/`onChange` are lifted so the caller can gate its button. */
export function NameField({
  value,
  onChange,
  label = "What should we call you?",
  autoFocus = false,
}: {
  value: string;
  onChange: (name: string) => void;
  label?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-ink/55 uppercase">
        {label}
      </span>
      <input
        value={value}
        // Cleaned on the way out rather than on each keystroke: collapsing spaces as
        // someone types stops them typing a space at all.
        onChange={(e) => onChange(e.target.value.slice(0, NAME_MAX))}
        maxLength={NAME_MAX}
        autoFocus={autoFocus}
        autoComplete="nickname"
        spellCheck={false}
        placeholder={PLACEHOLDER}
        className="w-full rounded-xl border-2 border-ink/15 bg-paper px-4 py-2.5 text-center text-base font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink/25 focus:border-pumpkin"
      />
    </label>
  );
}

/**
 * Remembers the last answer so a returning visitor only has to press the button.
 * Lazy initial state rather than an effect: every caller mounts client-side.
 */
export function useNameInput() {
  const [name, setName] = useState(readName);
  /** Store and hand back the tidied name, or `""` if it was only whitespace. */
  const commit = () => {
    const clean = cleanName(name);
    writeName(clean);
    return clean;
  };
  return { name, setName, commit, valid: cleanName(name).length > 0 };
}

/**
 * The room's own ask, for someone who arrived by link or QR.
 *
 * Deliberately not a hard gate on the session: the room has already joined and the
 * camera is already warming up behind this. Presence simply carries an empty name
 * until the prompt is answered, and everything displays the role label meanwhile —
 * so dismissing it costs nothing but the personalisation.
 */
export function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const { name, setName, commit, valid } = useNameInput();

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(commit());
        }}
        className="flex w-full max-w-xs flex-col gap-4 rounded-2xl border border-ink/10 bg-cream p-6 shadow-2xl shadow-ink/25"
      >
        <div className="text-center">
          <h2 className="text-lg font-semibold text-ink">Who&rsquo;s joining?</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink/55">
            The other person sees this name on the shot list and when you start a
            shoot. Only they see it — it is not printed on the card.
          </p>
        </div>

        <NameField value={name} onChange={setName} label="Call me" autoFocus />

        <button
          type="submit"
          disabled={!valid}
          className="rounded-full bg-pumpkin px-5 py-3 text-sm font-semibold text-cream shadow-lg shadow-pumpkin/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          That&rsquo;s me
        </button>
      </form>
    </div>
  );
}
