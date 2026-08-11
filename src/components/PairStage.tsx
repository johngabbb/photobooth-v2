"use client";

import { useEffect, useRef } from "react";
import { cameraMessage, type Camera } from "@/lib/camera";
import { useFitBox } from "@/lib/useFitBox";
import { useIsWide } from "@/lib/useIsWide";
import { ROLES } from "@/lib/types";
import type { Role } from "@/lib/types";
import type { PeerVideoState } from "@/lib/session/rtc";

/**
 * The two-up preview: a live rehearsal of one card slot.
 *
 * The stage is the shape of a whole slot and splits exactly where the card splits,
 * with each person filling their own half. Framing, cropping, mirroring and the seam
 * all match what `renderCard` will produce, so what you compose is what you get.
 *
 * The peer half degrades to a placeholder when the connection is not up. That is a
 * deliberate limit rather than a failure state: capture never depends on WebRTC, so
 * a room on a hostile network still takes photos — you just cannot see each other
 * while posing.
 *
 * **On a phone the halves are not side by side.** A 4-photo slot is 3:1 wide, so in
 * portrait the two-up stage collapses to about 130px tall — too small to frame a
 * face, and too small to fit the "Enable camera" prompt, which overflowed its box and
 * was clipped. Below `lg` the stage therefore shows *your* half at the half's own
 * ratio, with the other person as an inset. You still see both, and you can actually
 * see yourself.
 */
export function PairStage({
  camera,
  role,
  slot,
  splitGap,
  peerStream,
  peerVideo,
  peerPresent,
  countdown,
  flash,
  onStart,
}: {
  camera: Camera;
  role: Role;
  /** Full slot dimensions; only the ratio is used. */
  slot: { w: number; h: number };
  splitGap: number;
  peerStream: MediaStream | null;
  peerVideo: PeerVideoState;
  peerPresent: boolean;
  countdown: number | null;
  flash: boolean;
  onStart: () => void;
}) {
  const { status, detail, videoRef } = camera;
  const live = status === "ready";
  const failed = [
    "denied",
    "notfound",
    "busy",
    "insecure",
    "unsupported",
    "error",
  ].includes(status);

  const wide = useIsWide();
  // Side by side fits the whole slot; stacked fits one half.
  const halfW = (slot.w - splitGap) / 2;
  const { ref, size } = useFitBox(wide ? slot.w / slot.h : halfW / slot.h);
  const gapPx = wide ? Math.round((size.width * splitGap) / slot.w) || 0 : 0;

  const localHalf = (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-300 ${
          live ? "opacity-100" : "opacity-0"
        }`}
      />

      {status === "idle" && (
        <Overlay>
          <p className="max-w-[15rem] text-xs leading-snug text-cream/70 sm:text-sm">
            Your photos stay on your device.
          </p>
          <button
            type="button"
            onClick={onStart}
            className="rounded-full bg-honey px-5 py-2.5 text-sm font-semibold text-ink shadow-lg transition hover:brightness-105"
          >
            Enable camera
          </button>
        </Overlay>
      )}

      {status === "requesting" && (
        <Overlay>
          <p className="text-xs text-cream/70 sm:text-sm">Waiting for permission…</p>
        </Overlay>
      )}

      {failed && (
        <Overlay>
          <p className="text-xs font-semibold text-cream sm:text-sm">
            {cameraMessage(status).title}
          </p>
          <p className="max-w-[18rem] text-[11px] leading-snug text-cream/65 sm:text-xs">
            {cameraMessage(status).hint}
          </p>
          {detail && (
            <p className="hidden max-w-[18rem] font-mono text-[10px] text-cream/35 sm:block">
              {detail}
            </p>
          )}
          <button
            type="button"
            onClick={onStart}
            className="mt-1 rounded-full bg-honey px-4 py-2 text-xs font-semibold text-ink"
          >
            Try again
          </button>
        </Overlay>
      )}
    </>
  );

  return (
    <div ref={ref} className="flex h-full min-h-0 w-full items-center justify-center">
      <div
        style={{
          width: size.width || undefined,
          height: size.height || undefined,
          gap: gapPx,
        }}
        className="relative flex overflow-hidden rounded-2xl"
      >
        {wide ? (
          /* Halves in ROLES order so the seam matches the rendered card: Pamkin left. */
          ROLES.map((slotRole) =>
            slotRole === role ? (
              <Half key={slotRole}>{localHalf}</Half>
            ) : (
              <Half key={slotRole}>
                <PeerHalf stream={peerStream} state={peerVideo} present={peerPresent} />
              </Half>
            ),
          )
        ) : (
          /* Portrait: your own half fills the stage, the other person insets into a
             corner. Side by side would be ~130px tall on a phone. */
          <Half>
            {localHalf}
            <div className="pointer-events-none absolute bottom-2 right-2 h-1/3 w-1/3 overflow-hidden rounded-xl bg-ink shadow-lg ring-2 ring-cream/25">
              <PeerHalf
                stream={peerStream}
                state={peerVideo}
                present={peerPresent}
                compact
              />
            </div>
          </Half>
        )}

        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="absolute inset-0 bg-ink/25" />
            <span
              key={countdown}
              className={`countdown-digit relative font-bold leading-none text-cream drop-shadow-[0_6px_28px_rgba(0,0,0,0.7)] ${
                countdown > 0 ? "text-[7rem]" : "text-5xl"
              }`}
            >
              {countdown > 0 ? countdown : "smile!"}
            </span>
          </div>
        )}

        <div
          className={`pointer-events-none absolute inset-0 bg-cream transition-opacity ${
            flash ? "opacity-90 duration-0" : "opacity-0 duration-500"
          }`}
        />
      </div>
    </div>
  );
}

function Half({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-ink shadow-2xl shadow-ink/25 ring-1 ring-ink/10">
      {children}
    </div>
  );
}

/**
 * Overlays sit inside a box whose height is dictated by the card's aspect ratio, which
 * on a phone can be short. `overflow-y-auto` plus a small gap means the content
 * scrolls rather than pushing the button out through `overflow-hidden` — which is
 * exactly how the "Enable camera" button became untappable on mobile.
 */
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto p-3 text-center sm:gap-3 sm:p-5">
      {children}
    </div>
  );
}

function PeerHalf({
  stream,
  state,
  present,
  compact = false,
}: {
  stream: MediaStream | null;
  state: PeerVideoState;
  present: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  // Attach on every render: cheap, idempotent, and the element may mount before the
  // track arrives.
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
      if (stream) void el.play().catch(() => {});
    }
  });

  const message = !present
    ? compact ? "Waiting" : "Waiting for the other person"
    : state === "connected"
      ? null
      : state === "failed"
        ? compact
          ? "No video"
          : "Could not open a video link — you can still take photos together"
        : compact ? "Connecting" : "Connecting video…";

  return (
    <>
      <video
        ref={ref}
        playsInline
        muted
        autoPlay
        // Mirrored to match the local preview and the card, which applies the same
        // flip to both halves.
        className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-500 ${
          stream ? "opacity-100" : "opacity-0"
        }`}
      />
      {message && (
        <Overlay>
          <p
            className={`max-w-[15rem] leading-relaxed text-cream/60 ${
              compact ? "text-[10px]" : "text-xs"
            }`}
          >
            {message}
          </p>
        </Overlay>
      )}
    </>
  );
}
