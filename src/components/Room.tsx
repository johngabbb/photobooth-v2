"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PairStage } from "@/components/PairStage";
import { CardCanvas } from "@/components/CardCanvas";
import { QrCode } from "@/components/QrCode";
import {
  Field,
  PrimaryButton,
  SecondaryButton,
  Segmented,
  ThemePicker,
  todayLabel,
} from "@/components/Controls";
import { useCamera } from "@/lib/camera";
import { captureFrame, emptyShots } from "@/lib/capture";
import { cardFilename, downloadCard } from "@/lib/download";
import { PHOTO_COUNTS, findTheme, layoutFor } from "@/lib/layouts";
import { slotRects } from "@/lib/render";
import { useBrandMark } from "@/lib/useBrandMark";
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

const ROLE_LABEL: Record<Role, string> = { pamkin: "Pamkin", bee: "Bee" };

export function Room({ code }: { code: string }) {
  const session = useSession(code);
  const camera = useCamera();
  const mark = useBrandMark();

  const [origin] = useState(() => window.location.origin);
  const joinUrl = `${origin}/room/${code}`;

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
  const [mirror, setMirror] = useState(true);
  const [busy, setBusy] = useState(false);

  const shotsRef = useRef<Shot[]>(shots);
  /** Captures scheduled but not yet fired, in this device's local clock. */
  const scheduleRef = useRef<{ shot: number; at: number }[]>([]);

  const {
    role,
    isHost,
    peer,
    settings,
    setCameraReady,
    onCapture,
    onPeerFrame,
    onReset,
    scheduleCapture,
    sendFrame,
    reset,
  } = session;

  const count = settings.count;
  const layout = useMemo(() => layoutFor("duo", count), [count]);
  const theme = useMemo(() => findTheme(settings.themeId), [settings.themeId]);

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
    const next = shotsRef.current.map((s, i) =>
      i === shot ? { ...s, [who]: image } : s,
    );
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
    onCapture((shot, at) => {
      scheduleRef.current = [
        ...scheduleRef.current.filter((s) => s.shot !== shot),
        { shot, at },
      ].sort((a, b) => a.at - b.at);
      setStarted(true);
      setPending(true);
    });
    return () => onCapture(null);
  }, [onCapture]);

  useEffect(() => {
    onPeerFrame((shot, who, image) => putHalf(shot, who, image));
    return () => onPeerFrame(null);
  }, [onPeerFrame, putHalf]);

  useEffect(() => {
    onReset(() => {
      scheduleRef.current = [];
      const fresh = emptyShots(shotsRef.current.length);
      shotsRef.current = fresh;
      setShots(fresh);
      setStarted(false);
      setPending(false);
      setRemaining(null);
    });
    return () => onReset(null);
  }, [onReset]);

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
    }),
    [layout, theme, caption, shots, mirror, mark],
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

  const filled = shots.filter((s) => s.pamkin && s.bee).length;
  const complete = started && shots.length === count && filled === count;
  // A queued capture always wins the stage, so a retake shows the camera and its
  // countdown instead of leaving you photographed blind behind the finished card.
  const showCard = complete && !pending;
  // The scheduler sets `remaining` to null once nothing is queued, so this reads
  // "every shutter has fired, but not every half has arrived" without touching a ref
  // during render.
  const waitingForPeer = started && !complete && !pending;

  const bothReady = cameraReady && Boolean(peer?.cameraReady);
  const canStart = bothReady && Boolean(peer?.clockSynced) && isHost;

  const countdown =
    remaining !== null && remaining <= COUNTDOWN_MS
      ? Math.max(0, Math.ceil(remaining / 1000))
      : null;

  return (
    // On a phone the two rows must be given an explicit share. Left to auto sizing the
    // controls' content wins and squeezes the stage to ~150px — unusable for framing a
    // face. 3fr/2fr keeps the camera dominant and lets the controls scroll.
    <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-rows-[3fr_2fr] gap-4 px-4 py-3 lg:grid-cols-[1fr_20rem] lg:grid-rows-1 lg:gap-6 lg:px-6 lg:py-5">
      <div className="flex min-h-0 flex-col items-center justify-center gap-3">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {showCard ? (
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
          {showCard
            ? `${layout.physical} · ${layout.canvas.w}×${layout.canvas.h}px · 300 DPI`
            : started
              ? `Photo ${Math.min(filled + 1, count)} of ${count}`
              : `You are ${ROLE_LABEL[role]} · live preview of one ${layout.physical} slot`}
        </p>
      </div>

      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto">
        {session.transportKind === "local" && (
          <div className="rounded-xl border border-honey/60 bg-honey/15 p-3">
            <p className="text-xs font-semibold text-ink/80">Same-browser mode</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink/60">
              No Supabase credentials, so the room runs over{" "}
              <code>BroadcastChannel</code> — other tabs in this browser only. See
              docs/setup.md.
            </p>
          </div>
        )}

        {!started && (
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
        )}

        <Field label="Who's here">
          <div className="flex flex-col gap-2">
            <PeerRow
              label={`${ROLE_LABEL[role]} (you)`}
              present
              ready={cameraReady}
              host={isHost}
              synced={session.clock.synced}
            />
            <PeerRow
              label={ROLE_LABEL[role === HOST_ROLE ? GUEST_ROLE : HOST_ROLE]}
              present={Boolean(peer)}
              ready={Boolean(peer?.cameraReady)}
              host={peer?.role === HOST_ROLE}
              synced={Boolean(peer?.clockSynced)}
            />
          </div>
        </Field>

        {!started && (
          <>
            <Field label={isHost ? "Photos" : "Photos (set by host)"}>
              <Segmented
                options={PHOTO_COUNTS.map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
                value={String(count)}
                onChange={(v) => session.updateSettings({ count: Number(v) })}
                disabled={!isHost}
              />
            </Field>

            <Field label={isHost ? "Theme" : "Theme (set by host)"}>
              <div className={isHost ? "" : "pointer-events-none opacity-60"}>
                <ThemePicker
                  value={settings.themeId}
                  onChange={(id) => session.updateSettings({ themeId: id })}
                />
              </div>
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

            <label className="flex items-center gap-3 text-sm text-ink/80">
              <input
                type="checkbox"
                checked={mirror}
                onChange={(e) => setMirror(e.target.checked)}
                className="h-4 w-4 accent-pumpkin"
              />
              Mirror photos
            </label>

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

            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? "Rendering…" : "Download PNG"}
            </PrimaryButton>
            {isHost && <SecondaryButton onClick={reset}>Start over</SecondaryButton>}
            {!isHost && (
              <p className="text-[11px] leading-relaxed text-ink/45">
                You have the same card as Pamkin — download your own copy. Retakes and
                starting over are the host&rsquo;s to trigger.
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
            isHost={isHost}
            canStart={canStart}
            count={count}
            onStart={startSession}
            rttMs={session.clock.rttMs}
            synced={session.clock.synced}
          />
        )}
      </aside>
    </div>
  );
}

function StatusPanel({
  started,
  waitingForPeer,
  peerPresent,
  bothReady,
  peerSynced,
  isHost,
  canStart,
  count,
  onStart,
  rttMs,
  synced,
}: {
  started: boolean;
  waitingForPeer: boolean;
  peerPresent: boolean;
  bothReady: boolean;
  peerSynced: boolean;
  isHost: boolean;
  canStart: boolean;
  count: number;
  onStart: () => void;
  rttMs: number;
  synced: boolean;
}) {
  if (started) {
    return (
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
        <p className="text-sm font-medium text-ink/80">
          {blocker ?? "Ready when you are."}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
          {blocker === "Syncing clocks…"
            ? "Measuring the delay between your devices so both shutters fire together."
            : blocker
              ? "Share the code or QR above. Each of you needs your own camera on."
              : isHost
                ? "One countdown, both cameras. Every photo has both of you in it."
                : "Pamkin starts the countdown."}
        </p>
        {synced && rttMs > 0 && (
          <p className="mt-1.5 font-mono text-[10px] text-ink/35">
            clock synced · {Math.round(rttMs)}ms round trip
          </p>
        )}
      </div>

      {isHost && (
        <PrimaryButton onClick={onStart} disabled={!canStart}>
          {canStart ? `Take ${count} photos together` : "Waiting…"}
        </PrimaryButton>
      )}
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
