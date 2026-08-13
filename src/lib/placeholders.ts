import { BRAND, CARD_FONT, PLACEHOLDER_TINTS } from "./brand";
import { withAlpha } from "./render";
import { ROLES } from "./types";
import type { Role, Shot } from "./types";

/**
 * Synthetic stand-in "photos" for Phase 0, so the card renderer can be built and
 * judged before any camera code exists. Each one is a canvas, which is a valid
 * `CanvasImageSource`, so it flows through `renderCard` exactly as a real capture
 * will — same cropping, same mirroring, same code path.
 *
 * Deliberately 4:3 at 640x480: the same awkward aspect ratio a webcam hands us,
 * so the crop math gets exercised honestly rather than against convenient squares.
 */

const SOURCE = { w: 640, h: 480 };

export function placeholderPhoto(role: Role, index: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE.w;
  canvas.height = SOURCE.h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const tint = PLACEHOLDER_TINTS[role];
  const grad = ctx.createLinearGradient(0, 0, SOURCE.w, SOURCE.h);
  grad.addColorStop(0, tint.from);
  grad.addColorStop(1, tint.to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SOURCE.w, SOURCE.h);

  // Concentric arcs, off-centre, so cropping is visibly doing something. Role colour
  // rather than white — the fill is too pale for white to register.
  ctx.strokeStyle = withAlpha(tint.line, 0.30);
  ctx.lineWidth = 14;
  for (let r = 60; r < 420; r += 70) {
    ctx.beginPath();
    ctx.arc(SOURCE.w * 0.5, SOURCE.h * 0.42, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shot number, large enough to survive a hard crop. Ink, for the same reason.
  ctx.fillStyle = withAlpha(BRAND.ink, 0.45);
  ctx.font = `700 190px ${CARD_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index + 1), SOURCE.w / 2, SOURCE.h * 0.42);

  ctx.font = `600 42px ${CARD_FONT}`;
  ctx.fillStyle = withAlpha(BRAND.ink, 0.38);
  ctx.fillText(role.toUpperCase(), SOURCE.w / 2, SOURCE.h * 0.85);

  return canvas;
}

/** A full set of placeholder shots for a card of `count` slots. */
export function placeholderShots(count: number): Shot[] {
  return Array.from({ length: count }, (_, i) => {
    const shot: Shot = {};
    for (const role of ROLES) {
      shot[role] = placeholderPhoto(role, i);
    }
    return shot;
  });
}
