"use client";

import { useEffect, useRef } from "react";
import { cameraMessage, type Camera } from "@/lib/camera";
import { useFitBox } from "@/lib/useFitBox";
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

  const { ref, size } = useFitBox(slot.w / slot.h);
  const gapPx = Math.round((size.width * splitGap) / slot.w) || 0;

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
        {/* Halves are drawn in ROLES order so the seam matches the rendered card:
            Pamkin is always on the left. */}
        {ROLES.map((slotRole) =>
          slotRole === role ? (
            <Half key={slotRole}>
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
                  <p className="max-w-[16rem] text-sm text-cream/70">
                    The booth needs your camera. Photos never leave your device except
                    to the person you are shooting with.
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
                  <p className="text-sm text-cream/70">Waiting for permission…</p>
                </Overlay>
              )}

              {failed && (
                <Overlay>
                  <p className="text-sm font-semibold text-cream">
                    {cameraMessage(status).title}
                  </p>
                  <p className="max-w-[18rem] text-xs text-cream/65">
                    {cameraMessage(status).hint}
                  </p>
                  {detail && (
                    <p className="max-w-[18rem] font-mono text-[10px] text-cream/35">
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
            </Half>
          ) : (
            <Half key={slotRole}>
              <PeerHalf
                stream={peerStream}
                state={peerVideo}
                present={peerPresent}
              />
            </Half>
          ),
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

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center">
      {children}
    </div>
  );
}

function PeerHalf({
  stream,
  state,
  present,
}: {
  stream: MediaStream | null;
  state: PeerVideoState;
  present: boolean;
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
    ? "Waiting for the other person"
    : state === "connected"
      ? null
      : state === "failed"
        ? "Could not open a video link — you can still take photos together"
        : "Connecting video…";

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
          <p className="max-w-[15rem] text-xs leading-relaxed text-cream/60">
            {message}
          </p>
        </Overlay>
      )}
    </>
  );
}
