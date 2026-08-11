import type { Shot } from "./types";

/**
 * Freeze the current video frame into a canvas.
 *
 * Returns a canvas rather than a Blob or data URL because a canvas is already a
 * `CanvasImageSource` — it drops straight into `renderCard` through the exact same
 * path the Phase 0 placeholders used, with no decode step in between.
 *
 * `ImageCapture.takePhoto()` would be the "proper" API and is deliberately avoided:
 * support outside Chromium is still patchy, and `drawImage` on the video element
 * works everywhere at the resolution the stream is already producing.
 */
export function captureFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;

  // Zero until the stream has delivered metadata; capturing then yields a blank frame.
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

/** An empty set of slots for a card of `count` photos. */
export function emptyShots(count: number): Shot[] {
  return Array.from({ length: count }, () => ({}));
}
