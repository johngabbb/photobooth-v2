import { CARD_FONT } from "./brand";
import { ROLES } from "./types";
import type { Layout, Rect, RenderInput, Role, Shot, SplitMode } from "./types";

/**
 * Pure canvas rendering for a photocard.
 *
 * This module is the single source of truth for what a card looks like. The
 * on-screen preview and the downloaded file both go through `renderCard`, so a
 * preview can never drift from the export. Nothing here touches the DOM beyond the
 * 2D context it is handed, which keeps it testable and reusable on an
 * OffscreenCanvas later.
 */

/** The vertical stack of slot rectangles, in design pixels. */
export function slotRects(layout: Layout): Rect[] {
  const { canvas, padding, gap, slots, footer } = layout;
  const innerW = canvas.w - padding.left - padding.right;
  const innerH = canvas.h - padding.top - padding.bottom - footer;
  const slotH = (innerH - gap * (slots - 1)) / slots;

  return Array.from({ length: slots }, (_, i) => ({
    x: padding.left,
    y: padding.top + i * (slotH + gap),
    w: innerW,
    h: slotH,
  }));
}

/**
 * Divide one slot into per-person rectangles.
 *
 * Returns one rect for `none`, two for a split. The order always matches
 * `ROLES`, so index 0 is Pamkin and index 1 is Bee.
 */
export function halfRects(slot: Rect, split: SplitMode, splitGap: number): Rect[] {
  if (split === "none") return [slot];

  if (split === "vertical") {
    const w = (slot.w - splitGap) / 2;
    return [
      { x: slot.x, y: slot.y, w, h: slot.h },
      { x: slot.x + w + splitGap, y: slot.y, w, h: slot.h },
    ];
  }

  const h = (slot.h - splitGap) / 2;
  return [
    { x: slot.x, y: slot.y, w: slot.w, h },
    { x: slot.x, y: slot.y + h + splitGap, w: slot.w, h },
  ];
}

/** Intrinsic pixel size of anything drawable, across the sources we actually use. */
function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) {
    return { w: src.videoWidth, h: src.videoHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
    return { w: src.naturalWidth, h: src.naturalHeight };
  }
  const sized = src as { width: number; height: number };
  return { w: sized.width, h: sized.height };
}

function roundedPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
}

/**
 * Draw `src` to fill `dest` without distortion, cropping the overflow — the
 * equivalent of CSS `object-fit: cover`, centred.
 *
 * Camera feeds are 4:3 or 16:9 and slots are usually portrait, so something always
 * gets cropped. Centre-cropping is the v1 answer; biasing toward detected faces is
 * a later refinement.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  dest: Rect,
  opts: { radius?: number; mirror?: boolean } = {},
) {
  const { w: sw, h: sh } = sourceSize(src);
  if (!sw || !sh) return;

  const scale = Math.max(dest.w / sw, dest.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = dest.x + (dest.w - dw) / 2;
  const dy = dest.y + (dest.h - dh) / 2;

  ctx.save();
  roundedPath(ctx, dest, opts.radius ?? 0);
  ctx.clip();

  if (opts.mirror) {
    // Reflect about the vertical centre line of `dest`: x' = (2*dest.x + dest.w) - x
    ctx.translate(2 * dest.x + dest.w, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(src, dx, dy, dw, dh);
  ctx.restore();
}

/** Placeholder fill for a half with no photo yet. */
function drawEmptyHalf(
  ctx: CanvasRenderingContext2D,
  dest: Rect,
  radius: number,
  ink: string,
) {
  ctx.save();
  roundedPath(ctx, dest, radius);
  ctx.fillStyle = withAlpha(ink, 0.06);
  ctx.fill();

  ctx.strokeStyle = withAlpha(ink, 0.18);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Blend a hex colour toward transparency. Accepts `#rgb` and `#rrggbb`. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Which roles a layout expects per slot, in draw order. */
function rolesFor(layout: Layout): Role[] {
  return layout.split === "none" ? [ROLES[0]] : [...ROLES];
}

/**
 * Draw `src` fully inside `dest` without cropping, preserving aspect and centring —
 * the equivalent of CSS `object-fit: contain`. Used for the logo, where losing the
 * bee's antennae to a crop would be unacceptable.
 */
export function drawContain(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  dest: Rect,
) {
  const { w: sw, h: sh } = sourceSize(src);
  if (!sw || !sh) return;

  const scale = Math.min(dest.w / sw, dest.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(src, dest.x + (dest.w - dw) / 2, dest.y + (dest.h - dh) / 2, dw, dh);
}

/** Split a word that is itself wider than `maxWidth` into hard-broken chunks. */
function breakWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
): string[] {
  const parts: string[] = [];
  let cur = "";

  for (const ch of word) {
    if (cur && ctx.measureText(cur + ch).width > maxWidth) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);

  return parts;
}

/**
 * Greedy word wrap against the current `ctx.font`.
 *
 * Set the font before calling — measurement depends on it. Words too long to fit on
 * a line of their own are hard-broken rather than allowed to overflow, so a pasted
 * URL or a run of emoji cannot push past the card's margin.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";

  const flush = () => {
    if (line) {
      lines.push(line);
      line = "";
    }
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (ctx.measureText(word).width > maxWidth) {
      flush();
      const parts = breakWord(ctx, word, maxWidth);
      lines.push(...parts.slice(0, -1));
      line = parts[parts.length - 1] ?? "";
      continue;
    }

    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      flush();
      line = word;
    }
  }
  flush();

  return lines;
}

/** Trim `lines` to `maxLines`, marking the cut with an ellipsis. */
function clampLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  maxLines: number,
  maxWidth: number,
): string[] {
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];

  while (last && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last.trimEnd()}…`;

  return kept;
}

/**
 * Footer: the mark on the left, caption beside it, both vertically centred in the
 * footer band.
 *
 * Left-aligned rather than centred so the mark lines up with the left edge of the
 * photos above it.
 */
function drawFooter(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { layout, theme, content, logo } = input;
  const duo = layout.mode === "duo";

  const capSize = duo ? 28 : 20;
  const capGap = duo ? 18 : 12;
  const hasCaption = Boolean(content.caption);

  // The mark carries the footer alone now that the wordmark text is gone, so it
  // takes most of the band rather than sharing it.
  const markSize = logo ? Math.min(layout.footer * 0.82, duo ? 150 : 104) : 0;

  const footerTop = layout.canvas.h - layout.padding.bottom - layout.footer;
  const midY = footerTop + layout.footer / 2;
  const left = layout.padding.left;

  ctx.save();

  if (logo) {
    drawContain(ctx, logo, {
      x: left,
      y: midY - markSize / 2,
      w: markSize,
      h: markSize,
    });
  }

  if (hasCaption) {
    // Centred on the card itself, not on the space beside the mark — otherwise the
    // caption reads as pushed to the right.
    //
    // Collision with the mark is prevented by the *width* instead: the text box is
    // symmetric about the card's centre and stops short of the mark on both sides,
    // so wrapped lines stay clear of the logo while still looking centred.
    const centreX = layout.canvas.w / 2;
    const clearance = left + (logo ? markSize + capGap : 0);
    const availW = Math.max(
      layout.canvas.w - 2 * clearance,
      // Degenerate case: a mark so wide there is no symmetric room left. Fall back
      // to the region beside it rather than emitting a zero-width text box.
      Math.min(120, layout.canvas.w - layout.padding.right - clearance),
    );

    ctx.font = `400 ${capSize}px ${CARD_FONT}`;
    ctx.fillStyle = withAlpha(theme.ink, 0.65);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lineH = capSize * 1.32;
    const maxLines = Math.max(1, Math.floor(layout.footer / lineH));
    const lines = clampLines(
      ctx,
      wrapText(ctx, content.caption, availW),
      maxLines,
      availW,
    );

    const startY = midY - ((lines.length - 1) * lineH) / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, centreX, startY + i * lineH);
    });
  }

  ctx.restore();
}

/**
 * Render a complete card into `ctx`.
 *
 * The context is expected to be sized `layout.canvas * scale`; this function
 * applies the scale itself and draws everything in design pixels.
 */
export function renderCard(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { layout, theme, shots, mirror, scale } = input;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(scale, scale);

  // Card stock
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, layout.canvas.w, layout.canvas.h);

  const slots = slotRects(layout);
  const roles = rolesFor(layout);

  slots.forEach((slot, i) => {
    const halves = halfRects(slot, layout.split, layout.splitGap);
    const shot: Shot = shots[i] ?? {};

    halves.forEach((half, h) => {
      const src = shot[roles[h]];
      if (src) {
        drawCover(ctx, src, half, { radius: layout.radius, mirror });
      } else {
        drawEmptyHalf(ctx, half, layout.radius, theme.ink);
      }
    });

    // Hairline rule between slots — not after the last one, where it would collide
    // with the footer text.
    if (theme.accent && i < slots.length - 1) {
      ctx.save();
      ctx.strokeStyle = withAlpha(theme.accent, 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(slot.x, slot.y + slot.h + layout.gap / 2);
      ctx.lineTo(slot.x + slot.w, slot.y + slot.h + layout.gap / 2);
      ctx.stroke();
      ctx.restore();
    }
  });

  drawFooter(ctx, input);
  ctx.restore();
}

/** Export a card to a Blob at print resolution. */
export async function renderToBlob(
  input: RenderInput,
  type: "image/png" | "image/jpeg" = "image/png",
): Promise<Blob> {
  const { layout, scale } = input;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.canvas.w * scale);
  canvas.height = Math.round(layout.canvas.h * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire a 2D canvas context");

  renderCard(ctx, input);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      type,
      type === "image/jpeg" ? 0.92 : undefined,
    );
  });
}
