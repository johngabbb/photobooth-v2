"use client";

import { useEffect, useRef, useState } from "react";
import { cameraMessage, type Camera } from "@/lib/camera";

/**
 * The live preview.
 *
 * The frame is constrained to the aspect ratio of one card slot and the video is
 * `object-cover`, so what you see is exactly the crop that will land on the card —
 * the same centre-crop `drawCover` performs at render time.
 *
 * The preview is mirrored because people expect a mirror when facing a camera.
 * Whether the *saved* photo is mirrored is a separate decision, carried by the
 * card's `mirror` flag.
 */

/**
 * Largest box of the given ratio that fits the observed container.
 *
 * Measured rather than expressed in CSS, because CSS cannot express it here. The
 * card canvas gets aspect-correct scaling free from its bitmap's intrinsic ratio,
 * but there is no equivalent for a box wrapping a video plus overlays:
 *
 * - `aspect-ratio` on a bare div has no intrinsic size to scale from — one axis
 *   wins and the ratio breaks.
 * - An `<svg>` spacer looks like the canvas trick but is not. Its `width`/`height`
 *   attributes are *presentation attributes* — they become CSS declarations, so
 *   `max-width` clamps the width and leaves the height alone. A canvas's attributes
 *   set its bitmap instead, which is why only the canvas preserves ratio.
 * - Percentage `max-height` resolves against the parent's height, so any auto-height
 *   wrapper in the chain silently turns it into `none`.
 *
 * Twenty lines of ResizeObserver is more honest than CSS that appears to work and
 * quietly stops when the ratio crosses 1.
 */
function useFitBox(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const w = Math.min(width, height * ratio);
      setSize({ width: Math.round(w), height: Math.round(w / ratio) });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();

    return () => observer.disconnect();
  }, [ratio]);

  return { ref, size };
}

export function CameraStage({
  camera,
  slot,
  countdown,
  flash,
  onStart,
}: {
  camera: Camera;
  /** Dimensions of one card slot; only the ratio is used. */
  slot: { w: number; h: number };
  /** Seconds remaining, or null when not counting down. */
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

  return (
    <div
      ref={ref}
      className="flex h-full min-h-0 w-full items-center justify-center"
    >
      <div
        style={{ width: size.width || undefined, height: size.height || undefined }}
        className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-ink shadow-2xl shadow-ink/25 ring-1 ring-ink/10"
      >
        {/* Always mounted, so the ref exists when the stream arrives. */}
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="max-w-xs text-sm text-cream/70">
              The booth needs your camera. Nothing is uploaded — photos stay on this
              device.
            </p>
            <button
              type="button"
              onClick={onStart}
              className="rounded-full bg-honey px-6 py-3 text-sm font-semibold text-ink shadow-lg transition hover:brightness-105"
            >
              Enable camera
            </button>
          </div>
        )}

        {status === "requesting" && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-cream/70">
            Waiting for camera permission…
          </p>
        )}

        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-base font-semibold text-cream">
              {cameraMessage(status).title}
            </p>
            <p className="max-w-sm text-sm text-cream/65">
              {cameraMessage(status).hint}
            </p>
            {detail && (
              <p className="max-w-sm font-mono text-[11px] text-cream/35">{detail}</p>
            )}
            <button
              type="button"
              onClick={onStart}
              className="mt-2 rounded-full bg-honey px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-105"
            >
              Try again
            </button>
          </div>
        )}

        {countdown !== null && live && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Scrim: the digit has to stay readable over an arbitrarily bright frame. */}
            <div className="absolute inset-0 bg-ink/25" />
            <span
              key={countdown}
              className={`countdown-digit relative font-bold leading-none text-cream drop-shadow-[0_6px_28px_rgba(0,0,0,0.7)] ${
                countdown > 0 ? "text-[8rem]" : "text-6xl"
              }`}
            >
              {countdown > 0 ? countdown : "smile!"}
            </span>
          </div>
        )}

        {/* Shutter flash. */}
        <div
          className={`pointer-events-none absolute inset-0 bg-cream transition-opacity ${
            flash ? "opacity-90 duration-0" : "opacity-0 duration-500"
          }`}
        />
      </div>
    </div>
  );
}
