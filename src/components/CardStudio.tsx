"use client";

import { useMemo, useState } from "react";
import { CardCanvas } from "@/components/CardCanvas";
import { PHOTO_COUNTS, THEMES, findTheme, layoutFor } from "@/lib/layouts";
import { placeholderShots } from "@/lib/placeholders";
import { renderToBlob } from "@/lib/render";
import type { CardMode, RenderInput, Shot } from "@/lib/types";

/**
 * Phase 0 harness: exercises every layout, theme, and photo count against the real
 * renderer using synthetic photos. No camera, no session — this exists to get the
 * geometry and export pipeline right before either lands.
 */

const PREVIEW_SCALE = 0.42;
const EXPORT_SCALE = 1; // 300 DPI

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CardStudio() {
  const [mode, setMode] = useState<CardMode>("duo");
  const [count, setCount] = useState<number>(4);
  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [mirror, setMirror] = useState(false);
  const [caption, setCaption] = useState(todayLabel);
  const [busy, setBusy] = useState(false);

  // Safe to build during render: this component never runs on the server.
  const shots: Shot[] = useMemo(() => placeholderShots(count), [count]);

  const layout = useMemo(() => layoutFor(mode, count), [mode, count]);
  const theme = useMemo(() => findTheme(themeId), [themeId]);

  const base: Omit<RenderInput, "scale"> = useMemo(
    () => ({
      layout,
      theme,
      content: { title: "Pamkin and Bee", caption },
      shots,
      mirror,
    }),
    [layout, theme, caption, shots, mirror],
  );

  const preview: RenderInput = useMemo(
    () => ({ ...base, scale: PREVIEW_SCALE }),
    [base],
  );

  async function download() {
    setBusy(true);
    try {
      const blob = await renderToBlob({ ...base, scale: EXPORT_SCALE }, "image/png");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pamkin-and-bee-${layout.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col items-center gap-4">
        <CardCanvas
          input={preview}
          className="w-full max-w-sm rounded-xl shadow-2xl shadow-ink/20 ring-1 ring-ink/10"
        />
        <p className="font-mono text-xs text-ink/50">
          {layout.physical} &middot; {layout.canvas.w}&times;{layout.canvas.h}px &middot; 300 DPI
        </p>
      </div>

      <aside className="flex flex-col gap-7">
        <Field label="Card">
          <Segmented
            options={[
              { value: "duo", label: "Two people" },
              { value: "solo", label: "Solo" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as CardMode)}
          />
        </Field>

        <Field label="Photos">
          <Segmented
            options={PHOTO_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(count)}
            onChange={(v) => setCount(Number(v))}
          />
        </Field>

        <Field label="Theme">
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeId(t.id)}
                aria-label={t.name}
                aria-pressed={themeId === t.id}
                title={t.name}
                className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-paper transition ${
                  themeId === t.id ? "ring-ink" : "ring-transparent hover:ring-ink/25"
                }`}
                style={{ background: t.paper, boxShadow: `inset 0 0 0 3px ${t.ink}22` }}
              />
            ))}
          </div>
        </Field>

        <Field label="Caption">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink outline-none focus:border-pumpkin"
          />
        </Field>

        <label className="flex items-center gap-3 text-sm text-ink/80">
          <input
            type="checkbox"
            checked={mirror}
            onChange={(e) => setMirror(e.target.checked)}
            className="h-4 w-4 accent-pumpkin"
          />
          Mirror photos
        </label>

        <button
          type="button"
          onClick={download}
          disabled={busy || shots.length === 0}
          className="rounded-full bg-pumpkin px-5 py-3 text-sm font-semibold text-cream shadow-lg shadow-pumpkin/30 transition hover:brightness-105 disabled:opacity-50"
        >
          {busy ? "Rendering…" : "Download PNG"}
        </button>

        <p className="text-xs leading-relaxed text-ink/50">
          Phase 0 — placeholder photos. The preview above runs the same
          <code className="mx-1 font-mono">renderCard</code>
          that produces the download, so they cannot drift apart.
        </p>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-ink/45">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-ink/5 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
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
