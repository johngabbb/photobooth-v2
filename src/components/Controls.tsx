"use client";

import { THEMES } from "@/lib/layouts";

/** Shared control primitives, so the booth and the studio cannot drift apart. */

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-ink/45">
        {label}
      </span>
      {children}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg bg-ink/5 p-1 disabled:opacity-50">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
            value === o.value
              ? "bg-paper text-ink shadow-sm"
              : "text-ink/55 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-label={t.name}
          aria-pressed={value === t.id}
          title={t.name}
          className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-cream transition ${
            value === t.id ? "ring-ink" : "ring-transparent hover:ring-ink/25"
          }`}
          style={{ background: t.paper, boxShadow: `inset 0 0 0 3px ${t.ink}22` }}
        />
      ))}
    </div>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-full bg-pumpkin px-5 py-3 text-sm font-semibold text-cream shadow-lg shadow-pumpkin/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Today, formatted for the card caption. */
export function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
