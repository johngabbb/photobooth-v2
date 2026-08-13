"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CardCanvas } from "@/components/CardCanvas";
import { SessionActions } from "@/components/SessionActions";
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
import { readCard } from "@/lib/handoff";
import { placeholderShots } from "@/lib/placeholders";
import { useBrandMark } from "@/lib/useBrandMark";
import { halfKey } from "@/lib/render";
import type { CardMode, RenderInput, Role, Shot } from "@/lib/types";

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

export function CardStudio({ code }: { code: string | null }) {
  // Read once, at mount. A card is waiting here only when the room handed one over;
  // otherwise the studio behaves exactly as before, on synthetic photos.
  const [handoff] = useState(readCard);

  const [mode, setMode] = useState<CardMode>(handoff?.mode ?? "duo");
  const [count, setCount] = useState<number>(handoff?.count ?? 4);
  const [themeId, setThemeId] = useState(handoff?.themeId ?? THEMES[0].id);
  const [borderId, setBorderId] = useState(handoff?.borderId ?? BORDERS[0].id);
  const [filterId, setFilterId] = useState(handoff?.filterId ?? FILTERS[0].id);
  /**
   * Starting orientation for every photo. No control sets this any more — the room
   * hands over what it captured with, and from here mirroring is per photo.
   */
  const mirror = handoff?.mirror ?? false;
  /** Photos flipped against the global default, keyed by `halfKey`. */
  const [flips, setFlips] = useState<Record<string, boolean>>({});
  const [caption, setCaption] = useState(() => handoff?.caption ?? todayLabel());
  const [busy, setBusy] = useState(false);

  const fromRoom = Boolean(handoff);

  /** Flip one photograph. Ignores empty slots — there is nothing there to mirror. */
  function flipPhoto(slot: number, role: Role) {
    if (!shots[slot]?.[role]) return;
    const key = halfKey(slot, role);
    setFlips((prev) => ({ ...prev, [key]: !(prev[key] ?? mirror) }));
  }

  // Safe to build during render: this component never runs on the server.
  const synthetic: Shot[] = useMemo(() => placeholderShots(count), [count]);
  /**
   * Real photographs re-cut to the current count. Asking for more slots than were
   * shot leaves the extras empty rather than inventing pictures that never existed —
   * and an empty slot already draws as a placeholder, filter and all.
   */
  const captured: Shot[] = useMemo(
    () => Array.from({ length: count }, (_, i) => handoff?.shots[i] ?? {}),
    [handoff, count],
  );
  const shots = handoff ? captured : synthetic;

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
      mirrorOverrides: flips,
      logo: mark,
      border: findBorder(borderId).motif,
      filter: findFilter(filterId).css,
    }),
    [layout, theme, caption, shots, mirror, flips, mark, borderId, filterId],
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
            onPickPhoto={flipPhoto}
            className="min-h-0 max-h-full max-w-full rounded-xl shadow-2xl shadow-ink/20 ring-1 ring-ink/10"
          />
        </div>
        <p className="shrink-0 font-mono text-[11px] text-ink/50">
          {layout.physical} &middot; {layout.canvas.w}&times;{layout.canvas.h}px &middot; 300 DPI
        </p>
      </div>

      <aside className="pane-scroll flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
        {/* Format and count are properties of a shoot that already happened, so a
            card arriving from the room locks them. Everything below is presentation
            and stays editable. */}
        <Field label="Card">
          <Segmented
            options={[
              { value: "duo", label: "Two people" },
              { value: "solo", label: "Solo" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as CardMode)}
            disabled={fromRoom}
          />
        </Field>

        <Field label="Photos">
          <Segmented
            options={PHOTO_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(count)}
            onChange={(v) => setCount(Number(v))}
            disabled={fromRoom}
          />
          {fromRoom && (
            <p className="text-[11px] leading-relaxed text-ink/45">
              Fixed by the shoot — these photos were taken as {count} on a{" "}
              {layout.physical} card.
            </p>
          )}
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


        <p className="text-[11px] leading-relaxed text-ink/45">
          Hover a photo on the card and click to mirror just that one.
        </p>

        {/* Downloading is only offered for a real card. On the bare studio the
            photos are synthetic, so the useful action is not "save this" but "go
            make one" — the same three routes in as the landing page. */}
        {fromRoom ? (
          <PrimaryButton onClick={download} disabled={busy || shots.length === 0}>
            {busy ? "Rendering…" : "Download PNG"}
          </PrimaryButton>
        ) : (
          <SessionActions showSolo />
        )}

        {/* A reload drops the handoff but keeps the code in the URL, which is the
            one case where we can still point somewhere useful. */}
        {code && !fromRoom && (
          <Link
            href={`/room/${code}`}
            className="text-center text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline"
          >
            Back to room {code}
          </Link>
        )}

        <p className="shrink-0 text-[11px] leading-relaxed text-ink/45">
          {fromRoom
            ? "Your photos from the room. Every option here still applies — reload this page and it falls back to placeholders."
            : "Placeholder photos, so you can try every layout and theme before shooting. The preview runs the same renderCard that produces a download."}
        </p>
      </aside>
    </div>
  );
}

