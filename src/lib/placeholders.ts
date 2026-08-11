import { CARD_FONT } from "./brand";
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

const PALETTES: Record<Role, [string, string]> = {
  pamkin: ["#F2792F", "#C4442A"],
  bee: ["#F7C948", "#E08A1E"],
};

const SOURCE = { w: 640, h: 480 };

export function placeholderPhoto(role: Role, index: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE.w;
  canvas.height = SOURCE.h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const [from, to] = PALETTES[role];
  const grad = ctx.createLinearGradient(0, 0, SOURCE.w, SOURCE.h);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SOURCE.w, SOURCE.h);

  // Concentric arcs, off-centre, so cropping is visibly doing something.
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 14;
  for (let r = 60; r < 420; r += 70) {
    ctx.beginPath();
    ctx.arc(SOURCE.w * 0.5, SOURCE.h * 0.42, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shot number, large enough to survive a hard crop.
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `700 190px ${CARD_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index + 1), SOURCE.w / 2, SOURCE.h * 0.42);

  ctx.font = `600 42px ${CARD_FONT}`;
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
