"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { cardFilename, downloadCard, downloadStory } from "@/lib/download";
import { stageCard } from "@/lib/handoff";
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
import { XL_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import type { RenderInput, Shot } from "@/lib/types";

/**
 * The single-device photobooth.
 *
 * Deliberately the same component as `Room` minus the second person: same schedule,
 * same three-column shape, same live card, same handoff to the studio. Only the
 * things that genuinely need a peer — presence, the room code, clock sync, the
 * broadcast of settings — are absent. Anything that behaves differently here does so
 * because being alone actually changes it, not because the two were built at
 * different times.
 *
 * The capture loop is driven by an **absolute timestamp** rather than a chain of
 * relative `setTimeout`s. Late frames self-correct instead of accumulating drift, and
 * every shot is scheduled up front (D21) — the same shape the room needs to keep two
 * devices in step.
 */

const COUNTDOWN_MS = 3000;
/** Pause after a shot so you can see what you got before the next countdown. */
const BETWEEN_MS = 1400;
const FLASH_MS = 200;
const PREVIEW_SCALE = 0.6;

export function Booth() {
  const camera = useCamera();
  const mark = useBrandMark();
  const router = useRouter();

  const [count, setCount] = useState(4);
  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [borderId, setBorderId] = useState(BORDERS[0].id);
  const [filterId, setFilterId] = useState(FILTERS[0].id);
  const [caption, setCaption] = useState(todayLabel);
  const [shots, setShots] = useState<Shot[]>(() => emptyShots(4));
  // Which export is rendering, not just whether one is: both buttons look the same,
  // so a shared boolean would put "Rendering…" on the one you did not press.
  const [busy, setBusy] = useState<"card" | "story" | null>(null);

  /** A shoot has begun. Settings lock; the card becomes the thing on screen. */
  const [started, setStarted] = useState(false);
  /**
   * A capture is queued and has not fired yet.
   *
   * This is what puts the camera back on screen for a retake. Without it the booth
   * stays on the finished card — every slot is still full — and the `<video>` is not
   * mounted at all, so the retake captures nothing and the shot never changes.
   */
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  /**
   * Always mirrored, matching the room. The stage shows you a mirror while you pose,
   * so a card that matches it is the least surprising result. Un-mirroring is a
   * studio job — an edit to a finished photograph rather than a capture setting — and
   * the studio does it per photo, which a single checkbox here never could.
   */
  const mirror = true;

  // Mirrors of state the capture loop reads. The loop runs from a rAF callback and
  // must see the latest values without being torn down and rebuilt each frame.
  const shotsRef = useRef<Shot[]>(shots);
  /** Captures scheduled but not yet fired. */
  const scheduleRef = useRef<{ shot: number; at: number }[]>([]);

  const layout = useMemo(() => layoutFor("solo", count), [count]);
  const theme = useMemo(() => findTheme(themeId), [themeId]);
  const border = useMemo(() => findBorder(borderId).motif, [borderId]);
  const filter = useMemo(() => findFilter(filterId).css, [filterId]);

  const slot = useMemo(() => {
    const r = slotRects(layout)[0];
    return { w: r.w, h: r.h };
  }, [layout]);

  const putShot = useCallback((index: number, image: CanvasImageSource) => {
    const next = shotsRef.current.map((s, i) => (i === index ? { pamkin: image } : s));
    shotsRef.current = next;
    setShots(next);
  }, []);

  // --- capture ------------------------------------------------------------

  const fire = useCallback(
    (index: number) => {
      setFlash(true);
      window.setTimeout(() => setFlash(false), FLASH_MS);

      const video = camera.videoRef.current;
      const frame = video ? captureFrame(video) : null;
      if (!frame) return;

      putShot(index, frame);
    },
    [camera.videoRef, putShot],
  );

  const scheduleCapture = useCallback((shot: number, delayMs: number) => {
    scheduleRef.current = [
      ...scheduleRef.current.filter((s) => s.shot !== shot),
      { shot, at: Date.now() + delayMs },
    ].sort((a, b) => a.at - b.at);
    setStarted(true);
    setPending(true);
  }, []);

  // The scheduler. Ticks on rAF purely to animate the countdown; the decision to fire
  // is a comparison against wall-clock time, not a count of elapsed frames — so a
  // stalled tab cannot desynchronise it.
  useEffect(() => {
    if (!pending) return;

    let raf = 0;
    const tick = () => {
      const next = scheduleRef.current[0];
      if (!next) {
        // Queue drained. Stop the loop rather than spinning a rAF through the whole
        // review, and hand the stage back to the finished card.
        setRemaining(null);
        setPending(false);
        return;
      }

      const ms = next.at - Date.now();
      setRemaining(ms);

      if (ms <= 0) {
        scheduleRef.current = scheduleRef.current.slice(1);
        fire(next.shot);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pending, fire]);

  // --- controls -----------------------------------------------------------

  const startSession = useCallback(() => {
    const fresh = emptyShots(count);
    shotsRef.current = fresh;
    setShots(fresh);

    // Every shot scheduled up front, each carrying its own absolute instant, so a
    // late frame cannot push the rest of the strip back.
    for (let i = 0; i < count; i++) {
      scheduleCapture(i, COUNTDOWN_MS + i * (COUNTDOWN_MS + BETWEEN_MS));
    }
  }, [count, scheduleCapture]);

  const retake = useCallback(
    (shot: number) => scheduleCapture(shot, COUNTDOWN_MS),
    [scheduleCapture],
  );

  const startOver = useCallback(() => {
    scheduleRef.current = [];
    const fresh = emptyShots(count);
    shotsRef.current = fresh;
    setShots(fresh);
    setStarted(false);
    setPending(false);
    setRemaining(null);
  }, [count]);

  const changeCount = useCallback((n: number) => {
    setCount(n);
    const fresh = emptyShots(n);
    shotsRef.current = fresh;
    setShots(fresh);
  }, []);

  // --- derived ------------------------------------------------------------

  const base: Omit<RenderInput, "scale"> = useMemo(
    () => ({
      layout,
      theme,
      content: { caption },
      shots,
      mirror,
      logo: mark,
      border,
      filter,
    }),
    [layout, theme, caption, shots, mirror, mark, border, filter],
  );

  const preview: RenderInput = useMemo(
    () => ({ ...base, scale: PREVIEW_SCALE }),
    [base],
  );

  function openInStudio() {
    stageCard({
      shots,
      mode: layout.mode,
      count,
      themeId,
      borderId,
      filterId,
      caption,
      mirror,
    });
    router.push("/studio");
  }

  async function save() {
    setBusy("card");
    try {
      await downloadCard({ ...base, scale: 1 }, cardFilename(layout.id));
    } finally {
      setBusy(null);
    }
  }

  async function saveStory() {
    setBusy("story");
    try {
      await downloadStory(base, cardFilename(layout.id, "story"));
    } finally {
      setBusy(null);
    }
  }

  const ready = camera.status === "ready";
  const filled = shots.filter((s) => s.pamkin).length;
  /**
   * Reviewing rather than the room's `complete && !pending`.
   *
   * With nobody else to wait for, the queue draining *is* the end of the shoot. The
   * two read the same in the normal flow — every slot fills — but this one has no
   * dead end if a frame fails to capture: the retake buttons appear either way,
   * instead of being locked behind a completeness test that can no longer pass.
   */
  const reviewing = started && !pending;
  // From `xl` the card has a column of its own, so the stage never swaps — you keep
  // watching the camera while the finished card sits beside it. Narrower than that
  // there is no room for both, and the stage still hands over when the card is done.
  const wide = useMediaQuery(XL_QUERY);
  const cardInStage = reviewing && !wide;

  const countdown =
    remaining !== null && remaining <= COUNTDOWN_MS
      ? Math.max(0, Math.ceil(remaining / 1000))
      : null;

  return (
    // On a phone the two rows must be given an explicit share. Left to auto sizing the
    // controls' content wins and squeezes the stage to ~150px — unusable for framing a
    // face. 3fr/2fr keeps the camera dominant and lets the controls scroll.
    <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-rows-[3fr_2fr] gap-4 px-4 py-3 lg:grid-cols-[1fr_20rem] lg:grid-rows-1 lg:gap-8 lg:px-6 lg:py-5 xl:max-w-none xl:grid-cols-[20rem_1fr_22rem] xl:gap-10 2xl:grid-cols-[22rem_1fr_30rem] 2xl:gap-14">
      {/* Camera first in the DOM because on a phone it must take row 1, the 3fr one.
          The `xl:order-*` classes below move it to the middle column on wide screens
          without disturbing that. */}
      <div className="flex min-h-0 flex-col items-center justify-center gap-3 xl:order-2">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {cardInStage ? (
            <CardCanvas
              input={preview}
              className="min-h-0 max-h-full max-w-full rounded-xl shadow-2xl shadow-ink/20 ring-1 ring-ink/10"
            />
          ) : (
            <CameraStage
              camera={camera}
              slot={slot}
              filter={filter}
              countdown={countdown}
              flash={flash}
              onStart={camera.start}
            />
          )}
        </div>

        <p className="shrink-0 font-mono text-[11px] text-ink/50">
          {/* Describes whatever is actually on the stage. Keyed off `pending` rather
              than `started`, because at `xl` the stage goes back to being a live
              camera once the shoot ends — counting photos there would caption a
              viewfinder with a tally that has stopped moving. */}
          {cardInStage
            ? `${layout.physical} · ${layout.canvas.w}×${layout.canvas.h}px · 300 DPI`
            : pending
              ? `Photo ${Math.min(filled + 1, count)} of ${count}`
              : `Live preview of one ${layout.physical} slot`}
        </p>

        {/* Anchored under the camera rather than in the controls pane, which scrolls —
            the one control you reach for should never be scrolled off. `shrink-0`
            keeps it at full height and lets the stage above absorb the space. */}
        {!started && (
          <div className="shrink-0">
            <PrimaryButton onClick={startSession} disabled={!ready}>
              {ready ? `Take ${count} photos` : "Enable the camera first"}
            </PrimaryButton>
          </div>
        )}
      </div>

      {/* `overflow-y-auto` makes this a scroll box on *both* axes, so the theme
          swatches' hover scale would be clipped at the edges. `px-1` gives it room. */}
      <aside className="pane-scroll flex min-h-0 flex-col gap-5 overflow-y-auto px-1 xl:order-1">
        {/* Properties of a shoot that has not happened yet, so they lock once it has —
            the same rule as the room, where changing the count mid-strip would leave
            the two devices holding different cards. */}
        {!started && (
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
          </>
        )}

        {reviewing ? (
          <>
            <Field label="Caption">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-pumpkin"
              />
            </Field>

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

            <PrimaryButton onClick={save} disabled={busy !== null}>
              {busy === "card" ? "Rendering…" : "Download Photo"}
            </PrimaryButton>
            {/* Same card, matted into 1080x1920 — a 2:3 card cannot be reshaped to
                9:16 without cropping it or distorting the photographs. */}
            <PrimaryButton onClick={saveStory} disabled={busy !== null}>
              {busy === "story" ? "Rendering…" : "IG Story Copy"}
            </PrimaryButton>
            {/* Carries the photographs themselves, not a copy — the studio draws the
                same canvases through the same renderer, so nothing is re-encoded and
                the card cannot change on the way over. It is also the only place a
                single photo can be flipped on its own. */}
            <SecondaryButton onClick={openInStudio}>Edit in studio</SecondaryButton>
            <SecondaryButton onClick={startOver}>Start over</SecondaryButton>
          </>
        ) : (
          <StatusPanel
            capturing={pending}
            ready={ready}
            countdown={countdown}
            onCancel={startOver}
          />
        )}

        {/* Below `xl` the card rides at the foot of this pane, which already scrolls
            (D10 — the page itself never does). Scroll past the controls and the
            template is there, filling in as shots land. Suppressed once the stage has
            taken the card over, so it is never on screen twice. */}
        {!wide && !cardInStage && (
          <div className="flex shrink-0 flex-col items-center gap-2 pb-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-ink/45">
              Your card
            </span>
            <CardCanvas
              input={preview}
              className="max-h-[60vh] max-w-full rounded-xl shadow-lg shadow-ink/15 ring-1 ring-ink/10"
            />
          </div>
        )}
      </aside>

      {/* The card's own column, from `xl` only. Below that it is not rendered at all,
          which keeps the aside as the second grid item on a phone. */}
      {wide && (
        <div className="flex min-h-0 flex-col items-center justify-center gap-3 xl:order-3">
          <CardCanvas
            input={preview}
            className="min-h-0 max-h-full max-w-full rounded-xl shadow-2xl shadow-ink/20 ring-1 ring-ink/10"
          />
          <p className="shrink-0 font-mono text-[11px] text-ink/50">
            {layout.physical} · {filled}/{count} filled
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Status only — the start button lives under the camera, not in this pane.
 *
 * The room's equivalent spends most of its lines on the other person: are they here,
 * is their camera on, are the clocks synced. None of that exists alone, so this says
 * the one thing left worth saying and offers the way out of a running shoot.
 */
function StatusPanel({
  capturing,
  ready,
  countdown,
  onCancel,
}: {
  capturing: boolean;
  ready: boolean;
  countdown: number | null;
  onCancel: () => void;
}) {
  if (capturing) {
    return (
      <>
        <div className="rounded-xl border border-ink/10 bg-paper/60 p-3">
          <p className="text-sm font-medium text-ink/80">
            {countdown === 0 ? "Hold it…" : "Look at the camera."}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
            Every shot is already scheduled — the strip fills in as they fire.
          </p>
        </div>
        {/* The room has no equivalent: there, stopping would mean telling the other
            device to stop too. Alone, walking away mid-strip is routine. */}
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-paper/60 p-3">
      <p className="text-sm font-medium text-ink/80">
        {ready ? "Ready when you are." : "Turn your camera on."}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
        {ready
          ? "Three-second countdown before each shot, with a short pause between. Everything happens on this device — nothing is uploaded."
          : "The booth needs the camera to frame a shot. Nothing leaves this device."}
      </p>
    </div>
  );
}
