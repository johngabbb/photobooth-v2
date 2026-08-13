"use client";

import { useMemo, useState } from "react";
import { CardCanvas } from "@/components/CardCanvas";
import {
  Field,
  PrimaryButton,
  BorderPicker,
  FilterPicker,
  Segmented,
  ThemePicker,
  todayLabel,
} from "@/components/Controls";
import { cardFilename, downloadCard } from "@/lib/download";
import {
  BORDERS,
  FILTERS,
  PHOTO_COUNTS,
  THEMES,
  findBorder,
  findFilter,
  findTheme,
  layoutFor,
} from "@/lib/layouts";
import { placeholderShots } from "@/lib/placeholders";
import { useBrandMark } from "@/lib/useBrandMark";
import type { CardMode, RenderInput, Shot } from "@/lib/types";

/**
 * Phase 0 harness: exercises every layout, theme, and photo count against the real
 * renderer using synthetic photos. No camera, no session — this exists to get the
 * geometry and export pipeline right before either lands.
 */

/**
 * Preview bitmap scale. Higher than it needs to be on purpose: the canvas is sized
 * down by CSS to fit the viewport, so rendering extra pixels keeps it crisp on tall
 * screens and on high-DPI displays.
 */
const PREVIEW_SCALE = 0.6;
const EXPORT_SCALE = 1; // 300 DPI

export function CardStudio() {
  const [mode, setMode] = useState<CardMode>("duo");
  const [count, setCount] = useState<number>(4);
  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [borderId, setBorderId] = useState(BORDERS[0].id);
  const [filterId, setFilterId] = useState(FILTERS[0].id);
  const [mirror, setMirror] = useState(false);
  const [caption, setCaption] = useState(todayLabel);
  const [busy, setBusy] = useState(false);

  // Safe to build during render: this component never runs on the server.
  const shots: Shot[] = useMemo(() => placeholderShots(count), [count]);

  const layout = useMemo(() => layoutFor(mode, count), [mode, count]);
  const theme = useMemo(() => findTheme(themeId), [themeId]);
  const mark = useBrandMark();

  const base: Omit<RenderInput, "scale"> = useMemo(
    () => ({
      layout,
      theme,
      content: { caption },
      shots,
      mirror,
      logo: mark,
      border: findBorder(borderId).motif,
      filter: findFilter(filterId).css,
    }),
    [layout, theme, caption, shots, mirror, mark, borderId, filterId],
  );

  const preview: RenderInput = useMemo(
    () => ({ ...base, scale: PREVIEW_SCALE }),
    [base],
  );

  async function download() {
    setBusy(true);
    try {
      await downloadCard({ ...base, scale: EXPORT_SCALE }, cardFilename(layout.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    // `min-h-0` on both the grid and the preview column is what actually makes the
    // no-scroll layout work: without it a flex/grid child refuses to shrink below
    // its content's intrinsic size and pushes the page taller than the viewport.
    <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 gap-6 px-6 py-5 lg:grid-cols-[1fr_18rem] lg:gap-8">
      <div className="flex min-h-0 flex-col items-center justify-center gap-3">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <CardCanvas
            input={preview}
            className="min-h-0 max-h-full max-w-full rounded-xl shadow-2xl shadow-ink/20 ring-1 ring-ink/10"
          />
        </div>
        <p className="shrink-0 font-mono text-[11px] text-ink/50">
          {layout.physical} &middot; {layout.canvas.w}&times;{layout.canvas.h}px &middot; 300 DPI
        </p>
      </div>

      <aside className="pane-scroll flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
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
          <ThemePicker value={themeId} onChange={setThemeId} />
        </Field>

        <Field label="Border">
          <BorderPicker value={borderId} onChange={setBorderId} theme={theme} />
        </Field>

        <Field label="Filter">
          <FilterPicker value={filterId} onChange={setFilterId} />
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

        <PrimaryButton onClick={download} disabled={busy || shots.length === 0}>
          {busy ? "Rendering…" : "Download PNG"}
        </PrimaryButton>

        <p className="shrink-0 text-[11px] leading-relaxed text-ink/45">
          Phase 0 — placeholder photos. The preview runs the same
          <code className="mx-1 font-mono">renderCard</code>
          that produces the download, so they cannot drift apart.
        </p>
      </aside>
    </div>
  );
}

