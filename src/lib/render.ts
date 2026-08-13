import { BRAND, CARD_FONT, PLACEHOLDER_TINTS, SPECIAL } from "./brand";
import { ROLES } from "./types";
import type {
  BorderMotif,
  CardBackdrop,
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
  filter?: string | null,
) {
  const short = Math.min(dest.w, dest.h);

  ctx.save();
  roundedPath(ctx, dest, radius);
  ctx.clip();

  // The placeholder is filtered like a real photo would be, so the filter picker can
  // be judged before a single shot is taken. It applies to the gradient and arcs as
  // well as the mark — `ctx.filter` affects every drawing operation, not just images
  // — and the `restore()` below clears it before the dashed edge, which is a UI cue
  // rather than picture content and should not go grey with everything else.
  if (filter) ctx.filter = filter;

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

/** Identifies one photograph on a card: which slot, and whose half of it. */
export function halfKey(slot: number, role: Role): string {
  return `${slot}:${role}`;
}

/**
 * Which photograph, if any, sits under a point — in *design pixels*, so callers
 * convert from client coordinates once and never need to know the render scale.
 *
 * Derived from the same `slotRects` / `halfRects` that draw the card, so a hit can
 * never disagree with what is on screen.
 */
export function hitHalf(
  layout: Layout,
  x: number,
  y: number,
): { slot: number; role: Role; rect: Rect } | null {
  const roles = rolesFor(layout);

  const slots = slotRects(layout);
  for (let i = 0; i < slots.length; i++) {
    const halves = halfRects(slots[i], layout.split, layout.splitGap);
    for (let h = 0; h < halves.length; h++) {
      const r = halves[h];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return { slot: i, role: roles[h], rect: r };
      }
    }
  }
  return null;
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
 * Relative fold widths for the curtain, tiled across the card.
 *
 * A fixed sequence rather than `Math.random()`, and that is not a style choice: the
 * preview and the export are two separate `renderCard` calls, so a random pattern
 * would give you a different curtain in the downloaded file than the one you
 * approved on screen. Everything here has to be a pure function of its input.
 */
const CURTAIN_FOLDS = [1, 0.62, 1.35, 0.8, 1.15, 0.7, 1.5, 0.92, 1.08, 0.75];

/**
 * Paint a full-card backdrop.
 *
 * Takes bare dimensions rather than a Layout so the theme picker can render the
 * same thing into a 36px swatch — the swatch shows the real backdrop, not an
 * approximation of it.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  backdrop: CardBackdrop,
  w: number,
  h: number,
  band: number,
) {
  ctx.save();

  if (backdrop === "curtain") {
    ctx.fillStyle = SPECIAL.curtainShadow;
    ctx.fillRect(0, 0, w, h);

    // Vertical folds: each band is dark at its edges and lit down the middle.
    const unit = w / 16;
    let x = 0;
    let i = 0;
    while (x < w) {
      const bw = unit * CURTAIN_FOLDS[i % CURTAIN_FOLDS.length];
      const g = ctx.createLinearGradient(x, 0, x + bw, 0);
      g.addColorStop(0, SPECIAL.curtainShadow);
      g.addColorStop(0.5, SPECIAL.curtainLight);
      g.addColorStop(1, SPECIAL.curtainShadow);
      ctx.fillStyle = g;
      // +1 closes the hairline seam that rounding leaves between bands.
      ctx.fillRect(x, 0, bw + 1, h);
      x += bw;
      i++;
    }

    // Stage lighting: the top of a hung curtain falls away into shadow. Kept lighter
    // than the reference photograph on purpose — only the padding band and the footer
    // are ever visible past the photos, and at full strength the top band went to
    // flat black and lost the folds entirely.
    const shade = ctx.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "rgba(0,0,0,0.5)");
    shade.addColorStop(0.4, "rgba(0,0,0,0.16)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = SPECIAL.filmBase;
    ctx.fillRect(0, 0, w, h);

    // Sprockets down both edges, sized off the padding band they sit in and spaced
    // to an exact division of the height so the run ends flush instead of clipped.
    const holeW = band * 0.54;
    const holeH = holeW * 0.78;
    const radius = holeH * 0.32;
    const rows = Math.max(2, Math.round(h / (holeH * 2.15)));
    const pitch = h / rows;

    ctx.fillStyle = SPECIAL.filmHole;
    for (let r = 0; r < rows; r++) {
      const y = pitch * (r + 0.5) - holeH / 2;
      for (const cxEdge of [(band - holeW) / 2, w - band + (band - holeW) / 2]) {
        roundedPath(ctx, { x: cxEdge, y, w: holeW, h: holeH }, radius);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

/**
 * A sample swatch showing what a filter does: the mark on the house palette.
 *
 * The bee rather than the full mark, and a warm pumpkin-to-cream ramp behind it —
 * no leaf green anywhere, so the row stays on-brand. It still carries the range a
 * filter needs to show itself: saturated body, near-black stripes, white wings. A
 * flat colour would reveal grayscale and nothing else.
 */
export function drawFilterSample(
  ctx: CanvasRenderingContext2D,
  css: string | null,
  size: number,
) {
  ctx.save();
  // Set once, on the outer state: the motif's own save/restore inherits it, so the
  // bee is filtered along with its background rather than sitting untouched on top.
  if (css) ctx.filter = css;

  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, BRAND.pumpkin);
  g.addColorStop(0.55, BRAND.honey);
  g.addColorStop(1, BRAND.cream);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  drawBeeMotif(ctx, size / 2, size * 0.52, size * 0.74);

  ctx.restore();
}

/**
 * Motif artwork colours.
 *
 * Not in BRAND or STOCK: these are fur and linework for the character ornaments,
 * not card or UI colours, and nothing outside this file should reach for them.
 */
const FUR = {
  white: "#FFFFFF",
  beagleCoat: "#C4823C",
  beagleEar: "#8B5A2B",
  huskyCoat: "#6E4A34",
  huskyPaw: "#C9D2D6",
  tongue: "#F19AA3",
} as const;

/**
 * Fill a path and leave only its *outer* edge outlined.
 *
 * Stroke first at double width, then fill on top: the fill covers the inner half of
 * the stroke, so overlapping shapes in one path merge into a single silhouette with
 * no seam where they meet. Canvas has no path union, and this is the cheap
 * equivalent — it is what lets a head and a snout read as one head.
 */
function outlined(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  fill: string,
  lineWidth: number,
  stroke: string = BRAND.ink,
) {
  ctx.beginPath();
  path();
  ctx.lineWidth = lineWidth * 2;
  ctx.strokeStyle = stroke;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Snoopy: white body, one black ear, black nose. */
function drawSnoopyMotif(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
) {
  const r = s / 2;
  const lw = Math.max(1, s * 0.055);
  ctx.save();

  // Ear first, so the head overlaps its root. Pushed well clear of the cranium and
  // hung low: at border size it is the only thing distinguishing him from any other
  // white dog, so most of it has to sit outside the head silhouette.
  outlined(
    ctx,
    () => ctx.ellipse(cx + 0.6 * r, cy + 0.3 * r, 0.26 * r, 0.5 * r, 0.25, 0, Math.PI * 2),
    BRAND.ink,
    lw,
  );

  // Cranium and snout in one path — they merge into a single silhouette.
  outlined(
    ctx,
    () => {
      ctx.ellipse(cx + 0.1 * r, cy - 0.1 * r, 0.58 * r, 0.5 * r, 0, 0, Math.PI * 2);
      ctx.moveTo(cx - 0.06 * r, cy + 0.2 * r);
      ctx.ellipse(cx - 0.44 * r, cy + 0.2 * r, 0.4 * r, 0.3 * r, 0, 0, Math.PI * 2);
    },
    FUR.white,
    lw,
  );

  ctx.fillStyle = BRAND.ink;
  ctx.beginPath();
  ctx.ellipse(cx - 0.76 * r, cy + 0.06 * r, 0.16 * r, 0.13 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - 0.02 * r, cy - 0.16 * r, 0.09 * r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Moomin: rounded white head, big snout, two small ears. */
function drawMoominMotif(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
) {
  const r = s / 2;
  const lw = Math.max(1, s * 0.05);
  ctx.save();

  // Ears, then the head over their roots. Short nubs rather than long ovals — taller
  // and he turns into a rabbit.
  for (const dir of [-1, 1]) {
    outlined(
      ctx,
      () =>
        ctx.ellipse(
          cx + dir * 0.3 * r,
          cy - 0.52 * r,
          0.14 * r,
          0.2 * r,
          dir * 0.3,
          0,
          Math.PI * 2,
        ),
      FUR.white,
      lw,
    );
  }

  outlined(
    ctx,
    () => {
      ctx.ellipse(cx + 0.08 * r, cy - 0.08 * r, 0.56 * r, 0.52 * r, 0, 0, Math.PI * 2);
      ctx.moveTo(cx - 0.05 * r, cy + 0.26 * r);
      ctx.ellipse(cx - 0.3 * r, cy + 0.26 * r, 0.46 * r, 0.36 * r, 0, 0, Math.PI * 2);
    },
    FUR.white,
    lw,
  );

  ctx.fillStyle = BRAND.ink;
  for (const dx of [-0.12, 0.22]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * r, cy - 0.14 * r, 0.075 * r, 0.1 * r, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Max, a beagle: tan cap, white blaze, long droopy ears. */
function drawMaxMotif(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
) {
  const r = s / 2;
  const lw = Math.max(1, s * 0.055);
  ctx.save();

  for (const dir of [-1, 1]) {
    outlined(
      ctx,
      () =>
        ctx.ellipse(
          cx + dir * 0.56 * r,
          cy + 0.18 * r,
          0.21 * r,
          0.44 * r,
          dir * 0.12,
          0,
          Math.PI * 2,
        ),
      FUR.beagleEar,
      lw,
    );
  }

  const head = () =>
    ctx.ellipse(cx, cy - 0.02 * r, 0.56 * r, 0.52 * r, 0, 0, Math.PI * 2);
  outlined(ctx, head, FUR.beagleCoat, lw);

  // Blaze and muzzle, clipped so they cannot spill over the outline.
  ctx.save();
  ctx.beginPath();
  head();
  ctx.clip();
  ctx.fillStyle = FUR.white;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 0.1 * r, 0.17 * r, 0.46 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.3 * r, 0.36 * r, 0.26 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BRAND.ink;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.14 * r, 0.12 * r, 0.1 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * 0.26 * r, cy - 0.08 * r, 0.085 * r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Hunter, a husky: dark coat, white mask, upright pointed ears. */
function drawHunterMotif(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
) {
  const r = s / 2;
  const lw = Math.max(1, s * 0.055);
  ctx.save();

  // Pointed ears — the silhouette that separates Hunter from Max at border size.
  for (const dir of [-1, 1]) {
    outlined(
      ctx,
      () => {
        ctx.moveTo(cx + dir * 0.22 * r, cy - 0.34 * r);
        ctx.lineTo(cx + dir * 0.46 * r, cy - 0.88 * r);
        ctx.lineTo(cx + dir * 0.62 * r, cy - 0.22 * r);
        ctx.closePath();
      },
      FUR.huskyCoat,
      lw,
    );
  }

  const head = () =>
    ctx.ellipse(cx, cy - 0.02 * r, 0.56 * r, 0.5 * r, 0, 0, Math.PI * 2);
  outlined(ctx, head, FUR.huskyCoat, lw);

  ctx.save();
  ctx.beginPath();
  head();
  ctx.clip();
  ctx.fillStyle = FUR.white;
  // Muzzle, plus the wedge that runs up between the eyes.
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.26 * r, 0.4 * r, 0.3 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - 0.55 * r);
  ctx.lineTo(cx + 0.19 * r, cy + 0.2 * r);
  ctx.lineTo(cx - 0.19 * r, cy + 0.2 * r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BRAND.ink;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.1 * r, 0.13 * r, 0.11 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * 0.28 * r, cy - 0.12 * r, 0.085 * r, 0, Math.PI * 2);
    ctx.fill();
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
  if (motif === "both") {
    const s = size * 0.66;
    drawBeeMotif(ctx, cx - size * 0.21, cy - size * 0.04, s);
    drawPamkinMotif(ctx, cx + size * 0.21, cy + size * 0.08, s);
    return;
  }
  drawOneMotif(ctx, motif, cx, cy, size);
}

/** Dispatch for every motif except `both`, which is a pairing rather than a shape. */
function drawOneMotif(
  ctx: CanvasRenderingContext2D,
  motif: Exclude<BorderMotif, "both">,
  cx: number,
  cy: number,
  size: number,
) {
  switch (motif) {
    case "bee":
      return drawBeeMotif(ctx, cx, cy, size);
    case "pamkin":
      return drawPamkinMotif(ctx, cx, cy, size);
    case "snoopy":
      return drawSnoopyMotif(ctx, cx, cy, size);
    case "moomin":
      return drawMoominMotif(ctx, cx, cy, size);
    case "max":
      return drawMaxMotif(ctx, cx, cy, size);
    case "hunter":
      return drawHunterMotif(ctx, cx, cy, size);
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
    if (border === "both") {
      drawOneMotif(ctx, i % 2 === 0 ? "bee" : "pamkin", x, y, size);
    } else {
      drawOneMotif(ctx, border, x, y, size);
    }
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
  const { layout, theme, shots, mirror, scale, border, filter } = input;
  const overrides = input.mirrorOverrides;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(scale, scale);

  // Card stock
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, layout.canvas.w, layout.canvas.h);

  if (theme.backdrop) {
    drawBackdrop(
      ctx,
      theme.backdrop,
      layout.canvas.w,
      layout.canvas.h,
      layout.padding.left,
    );
  }

  if (border) drawCardBorder(ctx, layout, border);

  const slots = slotRects(layout);
  const roles = rolesFor(layout);

  slots.forEach((slot, i) => {
    const halves = halfRects(slot, layout.split, layout.splitGap);
    const shot: Shot = shots[i] ?? {};

    halves.forEach((half, h) => {
      const src = shot[roles[h]];
      if (src) {
        // Scoped to the photograph alone: set immediately before the draw and
        // cleared straight after, so the stock, ornaments, and footer stay untouched.
        // `drawCover` save/restores internally, which preserves this value.
        if (filter) ctx.filter = filter;
        drawCover(ctx, src, half, {
          radius: layout.radius,
          mirror: overrides?.[halfKey(i, roles[h])] ?? mirror,
        });
        if (filter) ctx.filter = "none";
      } else {
        drawEmptyHalf(
          ctx,
          half,
          layout.radius,
          theme.ink,
          roles[h],
          input.logo,
          filter,
        );
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
