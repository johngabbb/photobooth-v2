"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PairStage } from "@/components/PairStage";
import { CardCanvas } from "@/components/CardCanvas";
import { NamePrompt } from "@/components/NamePrompt";
import { Notices, useNotices } from "@/components/Notices";
import { QrCode } from "@/components/QrCode";
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
import { useRouter } from "next/navigation";
import { useCamera } from "@/lib/camera";
import { useCreateSession } from "@/lib/session/useCreateSession";
import { stageCard } from "@/lib/handoff";
import { XL_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { captureFrame, emptyShots } from "@/lib/capture";
import { cardFilename, downloadCard, downloadStory } from "@/lib/download";
import { PHOTO_COUNTS, findBorder, findFilter, findTheme, layoutFor } from "@/lib/layouts";
import { slotRects } from "@/lib/render";
import { useBrandMark } from "@/lib/useBrandMark";
import { readName } from "@/lib/session/identity";
import { useSession } from "@/lib/session/useSession";
import { GUEST_ROLE, HOST_ROLE } from "@/lib/session/types";
import type { RenderInput, Role, Shot } from "@/lib/types";

/**
 * Phase 3: the two-device booth.
 *
 * The whole trick is that the host never says "shoot now". It broadcasts an
 * *instant* — `captureAt`, expressed on its own clock — and each device converts
 * that into its own clock using the offset measured in `clock.ts`, then schedules
 * against it. A message arriving late does not delay the shutter; it just gives the
 * receiver less warning. That is what keeps the two captures at the same moment
 * rather than one network latency apart.
 *
 * Both devices then run the identical `renderCard`, so each ends up holding the same
 * photocard without either having to send the finished image to the other.
 */

const COUNTDOWN_MS = 3200;
/** Gap between one shot and the next countdown starting. */
const BETWEEN_MS = 1600;
const FLASH_MS = 200;
const PREVIEW_SCALE = 0.6;

/**
 * What each seat is called when nobody has said otherwise.
 *
 * Still the fallback everywhere, not dead code: a peer publishes an empty name until
 * they answer the prompt, and one on an older build never will.
 */
const ROLE_LABEL: Record<Role, string> = { pamkin: "Pamkin", bee: "Bee" };

export function Room({ code }: { code: string | null }) {
  // `""` makes useSession skip joining entirely — no channel, no presence, no clock.
  // That is what lets `/room` render the whole booth before a session exists.
  const session = useSession(code ?? "");
  const camera = useCamera();
  const mark = useBrandMark();
  const router = useRouter();

  const [origin] = useState(() => window.location.origin);
  const joinUrl = code ? `${origin}/room/${code}` : "";
  const { create, creating } = useCreateSession();

  const [started, setStarted] = useState(false);
  /**
   * A capture is queued and has not fired yet.
   *
   * This is what puts the camera back on screen for a retake. Without it the room
   * stays on the finished card — every slot is still full, so `complete` is still
   * true — and the `<video>` element is not mounted at all, which means a retake
   * silently captures nothing and the shot never changes.
   */
  const [pending, setPending] = useState(false);
  const [shots, setShots] = useState<Shot[]>(() => emptyShots(4));
  const [remaining, setRemaining] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [caption, setCaption] = useState(todayLabel);
  // Always mirrored in the room: the stage shows you a mirror while you pose, so the
  // card matching it is the least surprising result. Un-mirroring is a studio job —
  // it is an edit to a finished photo, not a capture setting.
  const mirror = true;
  // Which export is rendering, not just whether one is: both buttons look the same,
  // so a shared boolean would put "Rendering…" on the one you did not press.
  const [busy, setBusy] = useState<"card" | "story" | null>(null);

  const { notices, notify } = useNotices();
  /**
   * The name in use, and whether it has been confirmed *for this room*.
   *
   * Two pieces of state on purpose. A remembered name pre-fills the prompt, but it
   * does not answer it: the question is asked on every entry to a room, because the
   * person at the keyboard is not necessarily the person who answered last time, and
   * because "what are we calling you today" is part of arriving. Skipping it whenever
   * storage happened to hold something meant the prompt was never seen twice.
   */
  const [myName, setMyName] = useState(readName);
  const [named, setNamed] = useState(false);

  const shotsRef = useRef<Shot[]>(shots);
  /** Captures scheduled but not yet fired, in this device's local clock. */
  const scheduleRef = useRef<{ shot: number; at: number }[]>([]);
  /**
   * `started`, readable from the session handlers.
   *
   * They need to know whether a capture is the *first* of a shoot or one more in a
   * running one — a retake schedules a capture too, and announcing "started the
   * shoot" for each would be wrong. Reading the state itself would mean re-registering
   * the handler on every change.
   */
  const startedRef = useRef(false);
  /** The peer whose arrival has been announced, so it is announced exactly once. */
  const announcedRef = useRef<string | null>(null);

  const {
    role,
    isHost,
    peer,
    settings,
    setCameraReady,
    onCapture,
    onPeerFrame,
    onPeerChange,
    onReset,
    setName,
    scheduleCapture,
    sendFrame,
    reset,
  } = session;

  /**
   * Display names, resolved once. A name is only ever a label: `role` still decides
   * which half of the card a photo lands in and which side of the stage you stand on,
   * so nothing below the UI has to know these exist.
   */
  const peerRole = role === HOST_ROLE ? GUEST_ROLE : HOST_ROLE;
  const myLabel = myName || ROLE_LABEL[role];
  const peerLabel = peer?.name || ROLE_LABEL[peerRole];
  const labelFor = useCallback(
    (who: Role) => (who === role ? myLabel : peerLabel),
    [role, myLabel, peerLabel],
  );

  const count = settings.count;
  const layout = useMemo(() => layoutFor("duo", count), [count]);
  const theme = useMemo(() => findTheme(settings.themeId), [settings.themeId]);
  const border = useMemo(() => findBorder(settings.borderId).motif, [settings.borderId]);
  const filter = useMemo(() => findFilter(settings.filterId).css, [settings.filterId]);

  // The stage shows the whole slot now — both halves side by side — so the preview
  // is a live rehearsal of what the card will hold.
  const slot = useMemo(() => {
    const r = slotRects(layout)[0];
    return { w: r.w, h: r.h };
  }, [layout]);

  const cameraReady = camera.status === "ready";
  useEffect(() => {
    setCameraReady(cameraReady);
  }, [cameraReady, setCameraReady]);

  // Hand the local camera to the peer connection once it exists.
  const { publishLocalStream } = session;
  useEffect(() => {
    publishLocalStream(camera.stream);
  }, [camera.stream, publishLocalStream]);

  // Resize the shot array when the host changes the photo count.
  useEffect(() => {
    if (shotsRef.current.length === count) return;
    const fresh = emptyShots(count);
    shotsRef.current = fresh;
    setShots(fresh);
  }, [count]);

  const putHalf = useCallback((shot: number, who: Role, image: CanvasImageSource) => {
    const next = shotsRef.current.map((s, i) => (i === shot ? { ...s, [who]: image } : s));
    shotsRef.current = next;
    setShots(next);
  }, []);

  // --- capture ------------------------------------------------------------

  const fire = useCallback(
    async (shot: number) => {
      setFlash(true);
      window.setTimeout(() => setFlash(false), FLASH_MS);

      const video = camera.videoRef.current;
      const frame = video ? captureFrame(video) : null;
      if (!frame) return;

      // Show our own half immediately; the peer's arrives over the channel.
      putHalf(shot, role, frame);
      await sendFrame(shot, frame);
    },
    [camera.videoRef, putHalf, role, sendFrame],
  );

  // Both devices receive the same `captureAt`, already converted to local time.
  useEffect(() => {
    onCapture((shot, at, from) => {
      if (!startedRef.current && from !== role) {
        notify(`${labelFor(from)} started the shoot`);
      }
      startedRef.current = true;
      scheduleRef.current = [
        ...scheduleRef.current.filter((s) => s.shot !== shot),
        { shot, at },
      ].sort((a, b) => a.at - b.at);
      setStarted(true);
      setPending(true);
    });
    return () => onCapture(null);
  }, [onCapture, role, notify, labelFor]);

  useEffect(() => {
    onPeerFrame((shot, who, image) => putHalf(shot, who, image));
    return () => onPeerFrame(null);
  }, [onPeerFrame, putHalf]);

  useEffect(() => {
    onReset((from) => {
      // A finished card thrown away is "started over"; one abandoned mid-strip is a
      // cancellation. Same message either way, so the wording comes from what was on
      // screen when it landed.
      if (startedRef.current && from !== role) {
        const done = shotsRef.current.every((s) => s.pamkin && s.bee);
        notify(`${labelFor(from)} ${done ? "started over" : "cancelled the shoot"}`);
      }
      startedRef.current = false;
      scheduleRef.current = [];
      const fresh = emptyShots(shotsRef.current.length);
      shotsRef.current = fresh;
      setShots(fresh);
      setStarted(false);
      setPending(false);
      setRemaining(null);
    });
    return () => onReset(null);
  }, [onReset, role, notify, labelFor]);

  useEffect(() => {
    onPeerChange((next, previous) => {
      if (!next) {
        // Only if we said they arrived, so an unnamed passer-by cannot leave a room
        // it was never announced in.
        if (previous && announcedRef.current === previous.peerId) {
          notify(`${previous.name || ROLE_LABEL[previous.role]} left the room`);
        }
        announcedRef.current = null;
        return;
      }

      // Announced when the *name* lands, not when the presence does. They are on the
      // page a few seconds before they have finished saying who they are, and an
      // arrival announced early carries whatever their device last remembered.
      if (announcedRef.current === next.peerId || !next.name) return;
      announcedRef.current = next.peerId;
      // "is here" rather than "joined": the same event fires when you are the one who
      // walked into a room the other person was already sitting in, and there is
      // nothing in a roster that tells the two apart.
      notify(`${next.name} is here`);
    });
    return () => onPeerChange(null);
  }, [onPeerChange, notify]);

  // The scheduler. Fires on wall-clock comparison, not elapsed frames, so a stalled
  // tab cannot drift out of step with the other device.
  useEffect(() => {
    if (!pending) return;

    let raf = 0;
    const tick = () => {
      const next = scheduleRef.current[0];
      if (!next) {
        // Queue drained. Stop the loop rather than spinning a rAF for the whole
        // review, and hand the stage back to the finished card.
        setRemaining(null);
        setPending(false);
        return;
      }

      const ms = next.at - Date.now();
      setRemaining(ms);

      if (ms <= 0) {
        scheduleRef.current = scheduleRef.current.slice(1);
        void fire(next.shot);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pending, fire]);

  // --- host controls ------------------------------------------------------

  const startSession = useCallback(() => {
    const fresh = emptyShots(count);
    shotsRef.current = fresh;
    setShots(fresh);

    // All shots are scheduled up front. Each message carries its own absolute
    // instant, so a delayed or reordered one still fires at the right moment —
    // there is no chain of timeouts to fall behind.
    for (let i = 0; i < count; i++) {
      scheduleCapture(i, COUNTDOWN_MS + i * (COUNTDOWN_MS + BETWEEN_MS), count);
    }
  }, [count, scheduleCapture]);

  const retake = useCallback(
    (shot: number) => scheduleCapture(shot, COUNTDOWN_MS, count),
    [count, scheduleCapture],
  );

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

  const preview: RenderInput = useMemo(() => ({ ...base, scale: PREVIEW_SCALE }), [base]);

  function openInStudio() {
    stageCard({
      shots,
      mode: layout.mode,
      count,
      themeId: settings.themeId,
      borderId: settings.borderId,
      filterId: settings.filterId,
      caption,
      mirror,
    });
    router.push(code ? `/studio/${code}` : "/studio");
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

  const filled = shots.filter((s) => s.pamkin && s.bee).length;
  const complete = started && shots.length === count && filled === count;
  // A queued capture always wins the stage, so a retake shows the camera and its
  // countdown instead of leaving you photographed blind behind the finished card.
  const showCard = complete && !pending;
  // From `xl` the card has a column of its own, so the stage never swaps — you keep
  // watching the cameras while the finished card sits beside them. Narrower than that
  // there is no room for both, and the stage still hands over when the card is done.
  const wide = useMediaQuery(XL_QUERY);
  const cardInStage = showCard && !wide;
  // The scheduler sets `remaining` to null once nothing is queued, so this reads
  // "every shutter has fired, but not every half has arrived" without touching a ref
  // during render.
  const waitingForPeer = started && !complete && !pending;

  const bothReady = cameraReady && Boolean(peer?.cameraReady);
  // Both clocks, not just the guest's: whoever presses start converts its own "now"
  // into host time, so the *presser* has to be synced too. The host is its own
  // reference and reports synced from the start, which leaves this reading exactly as
  // it did when only the host could start.
  const canStart = bothReady && Boolean(peer?.clockSynced) && session.clock.synced;

  const countdown =
    remaining !== null && remaining <= COUNTDOWN_MS
      ? Math.max(0, Math.ceil(remaining / 1000))
      : null;

  return (
    // On a phone the two rows must be given an explicit share. Left to auto sizing the
    // controls' content wins and squeezes the stage to ~150px — unusable for framing a
    // face. 3fr/2fr keeps the camera dominant and lets the controls scroll.
    <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-rows-[3fr_2fr] gap-4 px-4 py-3 lg:grid-cols-[1fr_20rem] lg:grid-rows-1 lg:gap-8 lg:px-6 lg:py-5 xl:max-w-none xl:grid-cols-[20rem_1fr_22rem] xl:gap-10 2xl:grid-cols-[22rem_1fr_30rem] 2xl:gap-14">
      {/* Fixed-position, so both sit outside the grid they are declared in. */}
      <Notices notices={notices} />
      {/* Only with a session: without one there is nobody to be called anything to.
          Every route into a room lands here — created, joined by code, or opened from
          a QR — so this one prompt covers all of them. */}
      {code && !named && (
        <NamePrompt
          onSubmit={(name) => {
            setMyName(name);
            setNamed(true);
            setName(name);
          }}
        />
      )}

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
            <PairStage
              camera={camera}
              role={role}
              slot={slot}
              splitGap={layout.splitGap}
              filter={filter}
              peerStream={session.peerStream}
              peerVideo={session.peerVideo}
              peerPresent={Boolean(peer)}
              countdown={countdown}
              flash={flash}
              onStart={camera.start}
            />
          )}
        </div>
        <p className="shrink-0 font-mono text-[11px] text-ink/50">
          {cardInStage
            ? `${layout.physical} · ${layout.canvas.w}×${layout.canvas.h}px · 300 DPI`
            : started
              ? `Photo ${Math.min(filled + 1, count)} of ${count}`
              : `You are ${myLabel} · live preview of one ${layout.physical} slot`}
        </p>

        {/* Anchored under the cameras rather than in the controls pane, which
            scrolls — the one control you reach for should never be scrolled off.
            `shrink-0` keeps it at full height and lets the stage above absorb the
            space instead. */}
        {/* Either person starts the shoot (D32) — whoever is ready first, rather than
            whoever happened to make the room. */}
        {code && !started && (
          <div className="shrink-0">
            <PrimaryButton onClick={startSession} disabled={!canStart}>
              {canStart ? `Take ${count} photos together` : "Waiting…"}
            </PrimaryButton>
          </div>
        )}
      </div>

      <aside className="pane-scroll flex min-h-0 flex-col gap-5 overflow-y-auto px-1 xl:order-1">
        {code && session.transportKind === "local" && (
          <div className="rounded-xl border border-honey/60 bg-honey/15 p-3">
            <p className="text-xs font-semibold text-ink/80">Same-browser mode</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink/60">
              No Supabase credentials, so the room runs over <code>BroadcastChannel</code> — other
              tabs in this browser only. See docs/setup.md.
            </p>
          </div>
        )}

        {/* Before a session exists this slot offers the two ways to get one; once
            there is a code it becomes the code and QR to share. Same position in the
            panel either way, so the room does not reshuffle under you. */}
        {!started &&
          (code ? (
            <Field label="Room code">
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-3xl font-bold tracking-[0.2em] text-ink">
                    {code}
                  </span>
                  <CopyLink url={joinUrl} />
                </div>
                <QrCode value={joinUrl} size={104} />
              </div>
            </Field>
          ) : (
            <Field label="Session">
              <div className="flex flex-col gap-2">
                <PrimaryButton block onClick={create} disabled={creating}>
                  {creating ? "Creating…" : "Create session"}
                </PrimaryButton>
                <SecondaryButton block onClick={() => router.push("/join")}>
                  Join session
                </SecondaryButton>
                <p className="text-[11px] leading-relaxed text-ink/45">
                  Creating one gives you a code and QR to share. Your camera and card settings work
                  down here in the meantime.
                </p>
              </div>
            </Field>
          ))}

        <Field label="Who's here">
          <div className="flex flex-col gap-2">
            <PeerRow
              label={`${myLabel} (you)`}
              present
              ready={cameraReady}
              host={isHost}
              synced={session.clock.synced}
            />
            <PeerRow
              label={peerLabel}
              present={Boolean(peer)}
              ready={Boolean(peer?.cameraReady)}
              host={peer?.role === HOST_ROLE}
              synced={Boolean(peer?.clockSynced)}
            />
          </div>
        </Field>

        {!started && (
          <>
            {/* Both people can change these — every edit is broadcast as a patch
                and merged on both devices. Retaking one photo is now the only thing
                left that the host alone can do. */}
            <Field label="Photos">
              <Segmented
                options={PHOTO_COUNTS.map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
                value={String(count)}
                onChange={(v) => session.updateSettings({ count: Number(v) })}
              />
            </Field>

            <Field label="Theme">
              <ThemePicker
                value={settings.themeId}
                onChange={(id) => session.updateSettings({ themeId: id })}
              />
            </Field>

            <Field label="Border">
              <BorderPicker
                value={settings.borderId}
                onChange={(id) => session.updateSettings({ borderId: id })}
                theme={theme}
              />
            </Field>

            <Field label="Filter">
              <FilterPicker
                value={settings.filterId}
                onChange={(id) => session.updateSettings({ filterId: id })}
              />
            </Field>
          </>
        )}

        {showCard ? (
          <>
            <Field label="Caption">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-pumpkin"
              />
            </Field>

            {isHost && (
              <Field label="Retake">
                <div className="flex flex-wrap gap-2">
                  {shots.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => retake(i)}
                      className="h-9 w-9 rounded-lg border border-ink/15 text-sm font-medium text-ink/70 transition hover:border-pumpkin hover:text-pumpkin"
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <PrimaryButton onClick={save} disabled={busy !== null}>
              {busy === "card" ? "Rendering…" : "Download Photo"}
            </PrimaryButton>
            {/* Same card, matted into 1080x1920 — a 4x6 card cannot be reshaped to
                9:16 without cropping it or distorting the photographs. */}
            <PrimaryButton onClick={saveStory} disabled={busy !== null}>
              {busy === "story" ? "Rendering…" : "IG Story Copy"}
            </PrimaryButton>
            {/* Carries the photographs themselves, not a copy — the studio draws the
                same canvases through the same renderer, so nothing is re-encoded and
                the card cannot change on the way over. Available to both people:
                each holds their own version of the card. */}
            <SecondaryButton onClick={openInStudio}>Edit in studio</SecondaryButton>
            {/* Same call as Cancel, so it follows the same authority: either person
                may throw the shoot away, on both devices. */}
            <SecondaryButton onClick={reset}>Start over</SecondaryButton>
            {!isHost && (
              <p className="text-[11px] leading-relaxed text-ink/45">
                You have the same card as {peerLabel} — download your own copy. Retaking a single
                photo is the host&rsquo;s to trigger.
              </p>
            )}
          </>
        ) : (
          <StatusPanel
            started={started}
            waitingForPeer={waitingForPeer}
            peerPresent={Boolean(peer)}
            bothReady={bothReady}
            peerSynced={Boolean(peer?.clockSynced)}
            rttMs={session.clock.rttMs}
            synced={session.clock.synced}
            // Either person, like starting (D32). It is the same broadcast `reset` as
            // "Start over" — cancelling has to stop the *other* device too, or its
            // shutters keep firing on the old schedule.
            onCancel={reset}
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

/** Status only — the start button lives under the cameras, not in this pane. */
function StatusPanel({
  started,
  waitingForPeer,
  peerPresent,
  bothReady,
  peerSynced,
  rttMs,
  synced,
  onCancel,
}: {
  started: boolean;
  waitingForPeer: boolean;
  peerPresent: boolean;
  bothReady: boolean;
  peerSynced: boolean;
  rttMs: number;
  synced: boolean;
  onCancel: () => void;
}) {
  if (started) {
    return (
      <>
        <div className="rounded-xl border border-ink/10 bg-paper/60 p-3">
          <p className="text-sm font-medium text-ink/80">
            {waitingForPeer ? "Waiting for the other half…" : "Look at your camera."}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
            {waitingForPeer
              ? "Both shutters fired. The other device's photo is still arriving."
              : "Both cameras fire on the same countdown."}
          </p>
        </div>
        {/* Also the way out of a half that never arrives: until every slot fills,
            `showCard` stays false and "Start over" is not on screen, so without this
            a dropped frame left the room with nothing to press. */}
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </>
    );
  }

  const blocker = !peerPresent
    ? "Waiting for the other person…"
    : !bothReady
      ? "Waiting for both cameras…"
      : !peerSynced
        ? "Syncing clocks…"
        : null;

  return (
    <>
      <div className="rounded-xl border border-ink/10 bg-paper/60 p-3">
        <p className="text-sm font-medium text-ink/80">{blocker ?? "Ready when you are."}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
          {blocker === "Syncing clocks…"
            ? "Measuring the delay between your devices so both shutters fire together."
            : blocker
              ? "Share the code or QR above. Each of you needs your own camera on."
              : "One countdown, both cameras. Either of you can start it, and every photo has both of you in it."}
        </p>
        {synced && rttMs > 0 && (
          <p className="mt-1.5 font-mono text-[10px] text-ink/35">
            clock synced · {Math.round(rttMs)}ms round trip
          </p>
        )}
      </div>
    </>
  );
}

function PeerRow({
  label,
  present,
  ready,
  host,
  synced,
}: {
  label: string;
  present: boolean;
  ready: boolean;
  host: boolean;
  synced: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-ink/10 bg-paper/60 px-3 py-2">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          ready && synced ? "bg-leaf" : present ? "bg-honey" : "bg-ink/15"
        }`}
      />
      <span className="text-sm font-medium text-ink/85">{label}</span>
      {host && (
        <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink/55">
          host
        </span>
      )}
      <span className="ml-auto text-[11px] text-ink/45">
        {!present ? "not here" : !ready ? "no camera" : !synced ? "syncing" : "ready"}
      </span>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard can be blocked; the code and QR are still on screen. */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="self-start rounded-full border border-ink/15 px-3 py-1 text-[11px] font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
    >
      {copied ? "Link copied" : "Copy join link"}
    </button>
  );
}
