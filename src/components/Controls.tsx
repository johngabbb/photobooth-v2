"use client";

import { useEffect, useRef } from "react";
import { BRAND } from "@/lib/brand";
import { BORDERS, FILTERS, THEMES, findBorder, findFilter, findTheme } from "@/lib/layouts";
import { drawBackdrop, drawFilterSample, drawMotif } from "@/lib/render";
import type { BorderMotif, CardBackdrop, CardTheme } from "@/lib/types";

/**
 * The theme's border ornament, drawn by the card renderer itself so the swatch can
 * never show something the card does not.
 *
 * Dimmed while selected: the tick sits on top of it, and a white check over a full
 * strength bee is unreadable.
 */
function MotifSwatch({
  motif,
  size,
  dim,
}: {
  motif: BorderMotif;
  size: number;
  dim: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = dim ? 0.35 : 1;
    drawMotif(ctx, motif, size / 2, size / 2, size);
  }, [motif, size, dim]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="col-start-1 row-start-1"
      style={{ width: size, height: size }}
    />
  );
}

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

/**
 * Theme swatches.
 *
 * The white tick is the only mark on the selected swatch — no encircling ring, by
 * request. The name below the row carries the rest of the signal, which is what
 * the light papers (cream, wing) rely on since a white tick barely reads on them.
 *
 * If a ring is ever wanted back, draw it with `outline`, not Tailwind's `ring`:
 * ring compiles to a `box-shadow` and each swatch already sets one inline for its
 * inset border, so an inline style beats the class and the ring never renders.
 */
/**
 * The theme's backdrop, painted by the card renderer at swatch size.
 *
 * Curtain and Film strip both reduce to a near-black `paper`, so a flat swatch would
 * make them indistinguishable from Ink and from each other. This shows the actual
 * scene, scaled down.
 */
function BackdropSwatch({
  backdrop,
  size,
}: {
  backdrop: CardBackdrop;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The band is the card's side padding as a fraction of its width — roughly a
    // twenty-fifth — scaled up here so the sprockets stay visible at 36px.
    drawBackdrop(ctx, backdrop, size, size, size * 0.2);
  }, [backdrop, size]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="col-start-1 row-start-1 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Photo looks. The swatch is a filtered sample rather than a colour, so the row
 * shows what each option does instead of asking you to guess from its name.
 */
export function FilterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = findFilter(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.id === value;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange(f.id)}
              aria-label={f.name}
              aria-pressed={active}
              title={f.name}
              className="grid h-9 w-9 place-items-center overflow-hidden rounded-full outline-offset-2 transition duration-200 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-ink/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
              style={{ boxShadow: `inset 0 0 0 3px ${BRAND.ink}22` }}
            >
              <FilterSwatch css={f.css} size={36} dim={active} />
              {active && (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="theme-tick col-start-1 row-start-1 h-4 w-4 self-center justify-self-center"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <span className="text-xs text-ink/50">{selected.name}</span>
    </div>
  );
}

function FilterSwatch({
  css,
  size,
  dim,
}: {
  css: string | null;
  size: number;
  dim: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = dim ? 0.45 : 1;
    drawFilterSample(ctx, css, size);
  }, [css, size, dim]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="col-start-1 row-start-1 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = findTheme(value);

  return (
    <div className="flex flex-col gap-2">
      {/* Wraps: there are more themes than fit one row of a 20rem panel. */}
      <div className="flex flex-wrap gap-2">
        {THEMES.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              aria-label={t.name}
              aria-pressed={active}
              title={t.name}
              className="grid h-9 w-9 place-items-center rounded-full outline-offset-2 transition duration-200 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-ink/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
              style={{
                backgroundColor: t.paper,
                boxShadow: `inset 0 0 0 3px ${t.ink}22`,
              }}
            >
              {t.backdrop && <BackdropSwatch backdrop={t.backdrop} size={36} />}
              {active && (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="theme-tick col-start-1 row-start-1 h-4 w-4 self-center justify-self-center"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <span className="text-xs text-ink/50">{selected.name}</span>
    </div>
  );
}

/**
 * Border ornaments, chosen on top of the colour theme rather than baked into it.
 *
 * Each option previews on the *current* theme's paper, so the swatches answer the
 * question actually being asked — what this ornament looks like on the card you
 * already picked — instead of on some fixed stock.
 */
export function BorderPicker({
  value,
  onChange,
  theme,
}: {
  value: string;
  onChange: (id: string) => void;
  theme: CardTheme;
}) {
  const selected = findBorder(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {BORDERS.map((b) => {
          const active = b.id === value;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onChange(b.id)}
              aria-label={b.name}
              aria-pressed={active}
              title={b.name}
              className="grid h-9 w-9 place-items-center rounded-full outline-offset-2 transition duration-200 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-ink/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
              style={{
                backgroundColor: theme.paper,
                boxShadow: `inset 0 0 0 3px ${theme.ink}22`,
              }}
            >
              {b.motif && <MotifSwatch motif={b.motif} size={26} dim={active} />}
              {active && (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="theme-tick col-start-1 row-start-1 h-4 w-4 self-center justify-self-center"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <span className="text-xs text-ink/50">{selected.name}</span>
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
