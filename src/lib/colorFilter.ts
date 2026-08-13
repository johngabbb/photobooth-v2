import type { Rect } from "./types";

/**
 * A software implementation of the `filter` strings in `layouts.ts`, for engines
 * that do not implement `CanvasRenderingContext2D.filter`.
 *
 * WebKit is the holdout: it shipped the property in Safari 18 behind a preference
 * that is off by default, and iOS forces every browser onto WebKit. So on an iPhone
 * — in Safari, Chrome, and Firefox alike — `ctx.filter = "grayscale(1)"` is a silent
 * no-op and every photo comes out untouched. Nothing throws; the filter just never
 * happens. See decisions D29.
 *
 * The five looks we ship are all per-pixel colour operations — saturate, contrast,
 * sepia, grayscale, brightness — with no blur or drop-shadow among them. That is
 * what makes a fallback worth writing: each one is an exact affine transform of RGB
 * as defined by Filter Effects Level 1, so this produces the same picture the native
 * path does rather than an approximation of it.
 *
 * Like the rest of the renderer this touches nothing but the 2D context it is
 * handed, so it stays runnable in Node.
 */

/**
 * `rgb' = m · rgb + o`, with both sides in 0..1 sRGB.
 *
 * Every supported function is affine, and affine transforms compose, so a whole
 * filter list collapses into one of these and the pixel loop runs exactly once no
 * matter how many functions were chained.
 */
export interface ColorTransform {
  /** Row-major 3x3. */
  m: readonly number[];
  o: readonly number[];
}

const IDENTITY: ColorTransform = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

/**
 * Luminance weights. Filter Effects specifies `grayscale()` with the four-figure
 * Rec. 709 values but `saturate()` via SVG's `feColorMatrix type="saturate"`, which
 * rounds them to three. The gap is under half a 255th of a level — far below what a
 * print can show — but they are kept apart anyway so each function matches the text
 * that defines it, and nobody later has to wonder which one was rounded.
 */
const LUMA_GRAYSCALE = [0.2126, 0.7152, 0.0722] as const;
const LUMA_SATURATE = [0.213, 0.715, 0.072] as const;

/** The `feColorMatrix type="saturate"` matrix, for a given weighting. */
function saturateMatrix(s: number, l: readonly number[]): ColorTransform {
  const [lr, lg, lb] = l;
  return {
    m: [
      lr + (1 - lr) * s, lg - lg * s, lb - lb * s,
      lr - lr * s, lg + (1 - lg) * s, lb - lb * s,
      lr - lr * s, lg - lg * s, lb + (1 - lb) * s,
    ],
    o: [0, 0, 0],
  };
}

/** Mix a matrix with the identity — how the spec defines the partial-amount forms. */
function mix(target: readonly number[], amount: number): ColorTransform {
  const k = 1 - amount;
  return {
    m: target.map((v, i) => {
      const identity = i % 4 === 0 ? 1 : 0;
      return v * amount + identity * k;
    }),
    o: [0, 0, 0],
  };
}

const SEPIA = [
  0.393, 0.769, 0.189,
  0.349, 0.686, 0.168,
  0.272, 0.534, 0.131,
] as const;

/** `feComponentTransfer type="linear"`: one slope and intercept on all channels. */
function linear(slope: number, intercept: number): ColorTransform {
  return {
    m: [slope, 0, 0, 0, slope, 0, 0, 0, slope],
    o: [intercept, intercept, intercept],
  };
}

/** `b` after `a`, as a single transform. */
function compose(a: ColorTransform, b: ColorTransform): ColorTransform {
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m.push(
        b.m[r * 3] * a.m[c] + b.m[r * 3 + 1] * a.m[3 + c] + b.m[r * 3 + 2] * a.m[6 + c],
      );
    }
  }
  const o = [0, 1, 2].map(
    (r) =>
      b.m[r * 3] * a.o[0] +
      b.m[r * 3 + 1] * a.o[1] +
      b.m[r * 3 + 2] * a.o[2] +
      b.o[r],
  );
  return { m, o };
}

/** `1.45` or `45%`, the two forms a filter function accepts. */
function amountOf(raw: string, fallback: number): number | null {
  const text = raw.trim();
  if (!text) return fallback;
  const pct = text.endsWith("%");
  const n = Number(pct ? text.slice(0, -1) : text);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function functionTransform(name: string, arg: string): ColorTransform | null {
  const a = amountOf(arg, 1);
  if (a === null) return null;

  switch (name) {
    case "grayscale":
      // Clamped because the spec caps the amount at 1: over-desaturating past grey
      // would start inverting the colour, which is not what "grayscale(150%)" means.
      return saturateMatrix(1 - Math.min(a, 1), LUMA_GRAYSCALE);
    case "saturate":
      return saturateMatrix(Math.max(a, 0), LUMA_SATURATE);
    case "sepia":
      return mix(SEPIA, Math.min(Math.max(a, 0), 1));
    case "brightness":
      return linear(Math.max(a, 0), 0);
    case "contrast":
      return linear(Math.max(a, 0), 0.5 - 0.5 * Math.max(a, 0));
    case "invert": {
      const k = Math.min(Math.max(a, 0), 1);
      return linear(1 - 2 * k, k);
    }
    default:
      // blur(), drop-shadow(), hue-rotate() and friends are not affine per-pixel
      // work and are deliberately not faked here. Returning null aborts the whole
      // parse, so an unsupported function leaves the photo untouched rather than
      // half-filtered — the same thing the native path would do with a bad string.
      return null;
  }
}

const FUNCTION_RE = /([a-z-]+)\(([^)]*)\)/gi;

/**
 * Collapse a canvas/CSS `filter` string into one colour transform.
 *
 * `null` means "cannot be done this way" — either the string is `none`/empty, or it
 * uses a function this fallback does not implement.
 */
export function parseColorFilter(css: string | null | undefined): ColorTransform | null {
  if (!css || css.trim() === "none") return null;

  let out = IDENTITY;
  let matched = 0;

  for (const [, name, arg] of css.matchAll(FUNCTION_RE)) {
    const step = functionTransform(name.toLowerCase(), arg);
    if (!step) return null;
    out = compose(out, step);
    matched++;
  }

  return matched > 0 ? out : null;
}

/**
 * Whether this engine implements `ctx.filter`.
 *
 * A round-trip rather than an `in` check: WebKit leaves the property off the
 * prototype entirely when the feature preference is off, so an unimplemented engine
 * reads back `undefined` while a working one echoes what it was given.
 */
export function supportsContextFilter(ctx: CanvasRenderingContext2D): boolean {
  try {
    const before = ctx.filter;
    if (typeof before !== "string") return false;
    ctx.filter = "grayscale(1)";
    const ok = ctx.filter === "grayscale(1)";
    ctx.filter = before;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Recolour the pixels already drawn inside `rect`, in place.
 *
 * Reads the *current* transform rather than taking a scale argument, so this works
 * unchanged whether it is called under the card's design-pixel scale or the device
 * ratio a swatch canvas sets. Only the scale and translation components are used —
 * the renderer never rotates or skews, and the pixel grid has no way to express it
 * if it did.
 *
 * `radius` masks the pass to a rounded rectangle. It has to be done by hand: unlike
 * every drawing call, `putImageData` ignores both the clip and the transform, so a
 * plain rectangular pass would tint the four corners of card stock that sit outside
 * a photo's rounded edge — small, but on a sepia card they read as dirty notches.
 */
export function applyColorTransform(
  ctx: CanvasRenderingContext2D,
  t: ColorTransform,
  rect: Rect,
  radius = 0,
) {
  const m = ctx.getTransform();
  const { width: cw, height: ch } = ctx.canvas;

  // Snapped *inward*. A photo's edge pixel is an antialiased blend of the picture
  // and the card stock behind it, and the two routes disagree about it by
  // construction: the native filter runs before compositing and only ever sees the
  // picture, while this one runs after and sees the blend. Rounding outward tinted
  // that rim, which drew a visible grey outline around all eight photos on a
  // greyscale card. Rounding inward instead leaves the rim untouched — a sub-pixel
  // of unfiltered blend, invisible against the photo it borders.
  const x0 = Math.max(0, Math.ceil(m.a * rect.x + m.e));
  const y0 = Math.max(0, Math.ceil(m.d * rect.y + m.f));
  const x1 = Math.min(cw, Math.floor(m.a * (rect.x + rect.w) + m.e));
  const y1 = Math.min(ch, Math.floor(m.d * (rect.y + rect.h) + m.f));

  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  let image: ImageData;
  try {
    image = ctx.getImageData(x0, y0, w, h);
  } catch {
    // A tainted canvas. Nothing here can read it, so the photo stays unfiltered —
    // which is what an engine without `ctx.filter` was already doing.
    return;
  }

  const px = image.data;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = t.m;
  // Offsets are specified against 0..1 colour but the buffer is bytes.
  const o0 = t.o[0] * 255;
  const o1 = t.o[1] * 255;
  const o2 = t.o[2] * 255;

  // Matches `roundedPath`, which clamps the radius the same way before stroking.
  const rr = Math.min(radius * Math.abs(m.a), w / 2, h / 2);

  for (let y = 0; y < h; y++) {
    let inset = 0;
    if (rr > 0) {
      // Distance into the rect from whichever edge is nearer, sampled at the pixel
      // centre. Outside the corner bands this is >= rr and the row is full width.
      const dy = Math.min(y + 0.5, h - (y + 0.5));
      if (dy < rr) {
        const k = rr - dy;
        inset = rr - Math.sqrt(Math.max(0, rr * rr - k * k));
      }
    }

    // A pixel belongs to the corner if its *centre* is inside the arc: include x
    // when `x + 0.5 >= inset`, which is what rounding says. Rounding up instead
    // skipped a pixel wherever the arc fell mid-cell, and because the cut is
    // horizontal that error stacked into a visible staircase of unfiltered colour
    // down each corner — the one place this pass had an artefact you could see.
    const from = Math.round(inset);
    const to = w - from;

    for (let x = from; x < to; x++) {
      const i = (y * w + x) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];

      // Written back with the clamp the spec requires after the matrix, and with
      // alpha untouched — none of the supported functions move it.
      px[i] = clampByte(m0 * r + m1 * g + m2 * b + o0);
      px[i + 1] = clampByte(m3 * r + m4 * g + m5 * b + o1);
      px[i + 2] = clampByte(m6 * r + m7 * g + m8 * b + o2);
    }
  }

  ctx.putImageData(image, x0, y0);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
