import { BRAND, CARD_FONT, PLACEHOLDER_TINTS } from "./brand";
import { ROLES } from "./types";
import type {
  BorderMotif,
  Layout,
  Rect,
  RenderInput,
  Role,
  Shot,
  SplitMode,
} from "./types";

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
/**
 * A slot with no photograph in it yet.
 *
 * Drawn as a stand-in photo rather than a blank box: the same role gradient and
 * off-centre arcs the studio's synthetic photos use, with the mark where those put
 * a shot number. That makes a half-shot card look like a card, not like a bug.
 *
 * Everything is painted straight into `ctx` — no intermediate canvas — so this stays
 * DOM-free and keeps running under `@napi-rs/canvas` in Node.
 */
function drawEmptyHalf(
  ctx: CanvasRenderingContext2D,
  dest: Rect,
  radius: number,
  ink: string,
  role: Role,
  logo?: CanvasImageSource | null,
) {
  const short = Math.min(dest.w, dest.h);

  ctx.save();
  roundedPath(ctx, dest, radius);
  ctx.clip();

  const tint = PLACEHOLDER_TINTS[role];
  const grad = ctx.createLinearGradient(
    dest.x,
    dest.y,
    dest.x + dest.w,
    dest.y + dest.h,
  );
  grad.addColorStop(0, tint.from);
  grad.addColorStop(1, tint.to);
  ctx.fillStyle = grad;
  ctx.fillRect(dest.x, dest.y, dest.w, dest.h);

  // Arcs sized off the slot rather than fixed, so a 3:1 landscape half and a
  // portrait one get the same motif instead of the same pixel count.
  const cx = dest.x + dest.w * 0.5;
  const cy = dest.y + dest.h * 0.42;
  const step = short * 0.17;
  const far = Math.hypot(dest.w, dest.h);

  // Drawn in the role colour, not white: white vanished once the fill was pulled
  // back toward the card stock.
  ctx.strokeStyle = withAlpha(tint.line, 0.28);
  ctx.lineWidth = Math.max(2, short * 0.028);
  for (let r = step; r < far; r += step) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (logo) {
    const size = short * 0.44;
    drawContain(ctx, logo, {
      x: cx - size / 2,
      y: cy - size / 2,
      w: size,
      h: size,
    });
  }

  ctx.restore();

  // Dashed edge, drawn unclipped so the full stroke width survives. It is the one
  // cue that separates a waiting slot from a photographed one.
  ctx.save();
  roundedPath(ctx, dest, radius);
  ctx.strokeStyle = withAlpha(ink, 0.28);
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
 * A small bee, centred on `cx, cy` and fitting a `s`-square box.
 *
 * Deliberately fewer features than the logo: at border size a face and six legs
 * turn to mud, so this keeps only what survives — striped body, two wings, two
 * antennae.
 */
function drawBeeMotif(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
) {
  const r = s / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = BRAND.ink;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Antennae first, so the body covers where they meet it.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.22, cy - r * 0.34);
  ctx.lineTo(cx - r * 0.44, cy - r * 0.82);
  ctx.moveTo(cx + r * 0.22, cy - r * 0.34);
  ctx.lineTo(cx + r * 0.44, cy - r * 0.82);
  ctx.stroke();

  ctx.fillStyle = BRAND.wing;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      cx + dir * r * 0.34,
      cy - r * 0.3,
      r * 0.34,
      r * 0.19,
      dir * 0.7,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.18, r * 0.62, r * 0.44, 0, 0, Math.PI * 2);
  ctx.fillStyle = BRAND.honey;
  ctx.fill();

  // Stripes clipped to the body, so they cannot spill past the silhouette.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BRAND.ink;
  for (const dx of [-0.3, 0.06, 0.42]) {
    ctx.fillRect(cx + r * dx, cy - r * 0.4, r * 0.2, r * 1.3);
  }
  ctx.restore();

  // The path survives save/restore — this strokes the body ellipse above.
  ctx.stroke();
  ctx.restore();
}

/** A small pamkin, centred on `cx, cy` and fitting a `s`-square box. */
function drawPamkinMotif(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
) {
  const r = s / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = BRAND.ink;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.5);
  ctx.lineTo(cx, cy - r * 0.9);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx + r * 0.36, cy - r * 0.74, r * 0.3, r * 0.15, -0.55, 0, Math.PI * 2);
  ctx.fillStyle = BRAND.leaf;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.12, r * 0.8, r * 0.68, 0, 0, Math.PI * 2);
  ctx.fillStyle = BRAND.pumpkin;
  ctx.fill();

  // Ribs, clipped to the body for the same reason the bee's stripes are.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = withAlpha(BRAND.ink, 0.35);
  for (const dx of [-0.4, 0.4]) {
    ctx.beginPath();
    ctx.ellipse(cx + r * dx, cy + r * 0.12, r * 0.26, r * 0.66, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.12, r * 0.8, r * 0.68, 0, 0, Math.PI * 2);
  ctx.strokeStyle = BRAND.ink;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a single motif, centred on `cx, cy` in a `size` box.
 *
 * Exported so the theme picker can show the ornament a theme actually applies,
 * drawn by this same code — a hand-made SVG in the UI would drift from the card the
 * first time either changed. `both` pairs the two side by side, which is a picker
 * affordance; on a card `both` alternates along the edge instead.
 */
export function drawMotif(
  ctx: CanvasRenderingContext2D,
  motif: BorderMotif,
  cx: number,
  cy: number,
  size: number,
) {
  if (motif === "bee") {
    drawBeeMotif(ctx, cx, cy, size);
  } else if (motif === "pamkin") {
    drawPamkinMotif(ctx, cx, cy, size);
  } else {
    const s = size * 0.66;
    drawBeeMotif(ctx, cx - size * 0.21, cy - size * 0.04, s);
    drawPamkinMotif(ctx, cx + size * 0.21, cy + size * 0.08, s);
  }
}

/**
 * Repeat a motif around the card's padding band.
 *
 * Sized and placed off `layout.padding`, so this works for any format without a
 * branch: the band is narrow (48 design px on a duo card), and the motif is kept to
 * two thirds of it so nothing can reach into the photo area.
 */
function drawCardBorder(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  border: BorderMotif,
) {
  const { padding, canvas } = layout;
  const band = Math.min(padding.top, padding.right, padding.bottom, padding.left);
  const size = band * 0.68;
  const step = size * 1.85;

  const x0 = padding.left / 2;
  const x1 = canvas.w - padding.right / 2;
  const y0 = padding.top / 2;
  const y1 = canvas.h - padding.bottom / 2;

  // `both` alternates along each edge, and each edge counts from its own start so
  // the corners stay consistent rather than depending on push order.
  const place = (x: number, y: number, i: number) => {
    const bee = border === "bee" || (border === "both" && i % 2 === 0);
    if (bee) drawBeeMotif(ctx, x, y, size);
    else drawPamkinMotif(ctx, x, y, size);
  };

  const cols = Math.max(2, Math.round((x1 - x0) / step));
  for (let i = 0; i <= cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols;
    place(x, y0, i);
    place(x, y1, i);
  }

  // Skips the first and last row: the corners were already covered above.
  const rows = Math.max(2, Math.round((y1 - y0) / step));
  for (let i = 1; i < rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    place(x0, y, i);
    place(x1, y, i);
  }
}

/**
 * Render a complete card into `ctx`.
 *
 * The context is expected to be sized `layout.canvas * scale`; this function
 * applies the scale itself and draws everything in design pixels.
 */
export function renderCard(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { layout, theme, shots, mirror, scale, border } = input;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(scale, scale);

  // Card stock
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, layout.canvas.w, layout.canvas.h);

  if (border) drawCardBorder(ctx, layout, border);

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
        drawEmptyHalf(ctx, half, layout.radius, theme.ink, roles[h], input.logo);
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
