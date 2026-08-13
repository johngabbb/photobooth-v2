"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraStage } from "@/components/CameraStage";
import { CardCanvas } from "@/components/CardCanvas";
import {
  Field,
  PrimaryButton,
  SecondaryButton,
  BorderPicker,
  FilterPicker,
  Segmented,
  ThemePicker,
  todayLabel,
} from "@/components/Controls";
import { useCamera } from "@/lib/camera";
import { captureFrame, emptyShots } from "@/lib/capture";
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
import { slotRects } from "@/lib/render";
import { useBrandMark } from "@/lib/useBrandMark";
import type { RenderInput, Shot } from "@/lib/types";

/**
 * Phase 1: a complete single-device photobooth.
 *
 * The capture loop is driven by an **absolute timestamp** (`captureAt`) rather than
 * a chain of relative `setTimeout`s. On one device that is merely tidy — late frames
 * self-correct instead of accumulating drift. It matters in Phase 3: synchronising
 * two devices means broadcasting exactly this timestamp and letting each device
 * schedule against its own clock, so the loop is already the right shape.
 */

const COUNTDOWN_MS = 3000;
/** Pause after a shot so you can see what you got before the next countdown. */
const BETWEEN_MS = 1400;
const FLASH_MS = 200;
const PREVIEW_SCALE = 0.6;

type Phase = "setup" | "running" | "review";

export function Booth() {
  const camera = useCamera();
  const mark = useBrandMark();

  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState(4);
  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [borderId, setBorderId] = useState(BORDERS[0].id);
  const [filterId, setFilterId] = useState(FILTERS[0].id);
  const [caption, setCaption] = useState(todayLabel);
  // Default on: the preview is mirrored, so mirroring the output means the card
  // matches what you were looking at while posing.
  const [mirror, setMirror] = useState(true);
  const [shots, setShots] = useState<Shot[]>(() => emptyShots(4));
  const [busy, setBusy] = useState(false);

  const [captureAt, setCaptureAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [flash, setFlash] = useState(false);

  // Mirrors of state the capture loop reads. The loop runs from a rAF callback and
  // must see the latest values without being torn down and rebuilt each frame.
  const shotsRef = useRef(shots);
  const queueRef = useRef<number[]>([]);

  const layout = useMemo(() => layoutFor("solo", count), [count]);
  const theme = useMemo(() => findTheme(themeId), [themeId]);
  const slot = useMemo(() => {
    const r = slotRects(layout)[0];
    return { w: r.w, h: r.h };
  }, [layout]);

  const setShotsBoth = useCallback((next: Shot[]) => {
    shotsRef.current = next;
    setShots(next);
  }, []);

  const capture = useCallback(() => {
    const video = camera.videoRef.current;
    const frame = video ? captureFrame(video) : null;

    setFlash(true);
    window.setTimeout(() => setFlash(false), FLASH_MS);

    const index = queueRef.current.shift();
    if (index === undefined) {
      setCaptureAt(null);
      setPhase("review");
      return;
    }

    const next = [...shotsRef.current];
    next[index] = { pamkin: frame };
    shotsRef.current = next;
    setShots(next);

    if (queueRef.current.length > 0) {
      setCaptureAt(Date.now() + BETWEEN_MS + COUNTDOWN_MS);
    } else {
      setCaptureAt(null);
      setPhase("review");
    }
  }, [camera.videoRef]);

  // The scheduler. Ticks on rAF purely to animate the countdown; the decision to
  // fire is a comparison against wall-clock time, not a count of elapsed frames —
  // so a stalled tab cannot desynchronise it.
  useEffect(() => {
    if (phase !== "running" || captureAt === null) return;

    let raf = 0;
    const tick = () => {
      const ms = captureAt - Date.now();
      setRemaining(ms);
      if (ms <= 0) {
        capture();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, captureAt, capture]);

  const startSession = useCallback(() => {
    const fresh = emptyShots(count);
    shotsRef.current = fresh;
    setShots(fresh);
    queueRef.current = Array.from({ length: count }, (_, i) => i);
    setPhase("running");
    setCaptureAt(Date.now() + COUNTDOWN_MS);
  }, [count]);

  const retake = useCallback((index: number) => {
    queueRef.current = [index];
    setPhase("running");
    setCaptureAt(Date.now() + COUNTDOWN_MS);
  }, []);

  const cancel = useCallback(() => {
    queueRef.current = [];
    setCaptureAt(null);
    setPhase("setup");
  }, []);

  const changeCount = useCallback(
    (n: number) => {
      setCount(n);
      setShotsBoth(emptyShots(n));
    },
    [setShotsBoth],
  );

  const startOver = useCallback(() => {
    setShotsBoth(emptyShots(count));
    setPhase("setup");
  }, [count, setShotsBoth]);

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

  async function save() {
    setBusy(true);
    try {
      await downloadCard({ ...base, scale: 1 }, cardFilename(layout.id));
    } finally {
      setBusy(false);
    }
  }

  const countdown =
    phase === "running" && captureAt !== null && remaining <= COUNTDOWN_MS
      ? Math.max(0, Math.ceil(remaining / 1000))
      : null;

  const taken = shots.filter((s) => s.pamkin).length;
  const ready = camera.status === "ready";

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 gap-6 px-6 py-5 lg:grid-cols-[1fr_18rem] lg:gap-8">
      <div className="flex min-h-0 flex-col items-center justify-center gap-3">
        {/* The stage gets its own flex-1 box: `max-h-full` inside resolves against
            the space left over after the caption, not the whole column. */}
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {phase === "review" ? (
          <CardCanvas
            input={preview}
            className="min-h-0 max-h-full max-w-full rounded-xl shadow-2xl shadow-ink/20 ring-1 ring-ink/10"
          />
        ) : (
          <CameraStage
            camera={camera}
            slot={slot}
            countdown={countdown}
            flash={flash}
            onStart={camera.start}
          />
        )}
        </div>

        <p className="shrink-0 font-mono text-[11px] text-ink/50">
          {phase === "running"
            ? `Photo ${Math.min(taken + 1, count)} of ${count}`
            : `${layout.physical} · ${layout.canvas.w}×${layout.canvas.h}px · 300 DPI`}
        </p>
      </div>

      {/* `overflow-y-auto` makes this a scroll box on *both* axes, so the theme
          swatches' hover scale would be clipped at the edges. `px-1` gives it room. */}
      <aside className="pane-scroll flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
        {phase === "setup" && (
          <>
            <Field label="Photos">
              <Segmented
                options={PHOTO_COUNTS.map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
                value={String(count)}
                onChange={(v) => changeCount(Number(v))}
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

            <PrimaryButton onClick={startSession} disabled={!ready}>
              {ready ? `Take ${count} photos` : "Enable the camera first"}
            </PrimaryButton>

            <p className="text-[11px] leading-relaxed text-ink/45">
              Three-second countdown before each shot, with a short pause between.
              Everything happens on this device — nothing is uploaded.
            </p>
          </>
        )}

        {phase === "running" && (
          <>
            <Field label="Progress">
              <div className="flex gap-1.5">
                {shots.map((s, i) => (
                  <span
                    key={i}
                    className={`h-2 flex-1 rounded-full transition ${
                      s.pamkin ? "bg-pumpkin" : "bg-ink/10"
                    }`}
                  />
                ))}
              </div>
            </Field>

            <p className="text-sm text-ink/60">
              {countdown === 0 ? "Hold it…" : "Get ready — look at the camera."}
            </p>

            <SecondaryButton onClick={cancel}>Cancel</SecondaryButton>
          </>
        )}

        {phase === "review" && (
          <>
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
                className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-pumpkin"
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

            <Field label="Retake">
              <div className="flex flex-wrap gap-2">
                {shots.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => retake(i)}
                    disabled={!ready}
                    className="h-9 w-9 rounded-lg border border-ink/15 text-sm font-medium text-ink/70 transition hover:border-pumpkin hover:text-pumpkin disabled:opacity-40"
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </Field>

            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? "Rendering…" : "Download PNG"}
            </PrimaryButton>
            <SecondaryButton onClick={startOver}>Start over</SecondaryButton>
          </>
        )}
      </aside>
    </div>
  );
}
