import { BRAND, mixHex } from "./brand";
import { renderCard, withAlpha } from "./render";
import type { Layout, RenderInput } from "./types";

/**
 * The card as a 9:16 story image.
 *
 * A photocard is 2:3 (or 1:3 for a strip) and a story frame is 9:16, so the card
 * cannot *become* one without either distorting the photographs or cropping the
 * card. Instead the same card is matted: the frame paints a field, the card is fitted
 * into it at its own aspect ratio, and `renderCard` draws it exactly as it draws the
 * printable PNG. There is still one renderer — this module only decides where the
 * card sits and what is behind it. See docs/decisions.md D31.
 */

/**
 * Instagram story canvas, in pixels. Also the frame for Reels, TikTok, and Shorts;
 * anything larger is re-encoded on upload, so this is the size worth exporting.
 */
export const STORY_SIZE = { w: 1080, h: 1920 } as const;

/**
 * Fraction of each axis kept clear of the card.
 *
 * The vertical figure is the load-bearing one: Instagram's own chrome — the account
 * header at the top, the reply bar at the bottom — covers roughly the first and last
 * 200px of a 1920px frame. A card that filled the height would have its footer under
 * the reply bar.
 */
const MARGIN = { x: 0.08, y: 0.12 } as const;

export interface StoryFit {
  /** Multiplier from the layout's design pixels to story pixels. */
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a card lands inside the story frame: centred, aspect preserved. */
export function storyFit(layout: Layout, size = STORY_SIZE): StoryFit {
  const scale = Math.min(
    (size.w * (1 - MARGIN.x * 2)) / layout.canvas.w,
    (size.h * (1 - MARGIN.y * 2)) / layout.canvas.h,
  );
  const w = layout.canvas.w * scale;
  const h = layout.canvas.h * scale;
  return { scale, w, h, x: (size.w - w) / 2, y: (size.h - h) / 2 };
}

/**
 * Everything a card needs except where it goes: the fit decides `scale` and
 * `origin`, so taking them here would only let a caller contradict it.
 */
export type StoryInput = Omit<RenderInput, "scale" | "origin">;

/** Draw the card into a story frame. `ctx` must be `STORY_SIZE`. */
export function renderStory(ctx: CanvasRenderingContext2D, input: StoryInput) {
  const { layout, theme } = input;
  const fit = storyFit(layout);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // The field is the card's own stock walked toward its ink, so it reads as the same
  // object's shadow side rather than an unrelated colour, and works for every theme
  // including the two dark ones without a per-theme entry.
  const field = ctx.createLinearGradient(0, 0, 0, STORY_SIZE.h);
  field.addColorStop(0, mixHex(theme.paper, theme.ink, 0.1));
  field.addColorStop(1, mixHex(theme.paper, theme.ink, 0.26));
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, STORY_SIZE.w, STORY_SIZE.h);

  // Twice a photo's radius: the card reads as the object holding the photos, so its
  // corners have to be the softer pair. Derived rather than picked so a layout that
  // changes its radius keeps the relationship.
  const radius = layout.radius * 2 * fit.scale;

  // Cast on the field before the card is drawn, so the card itself covers the part of
  // the blur that falls under it.
  ctx.save();
  ctx.shadowColor = withAlpha(BRAND.ink, 0.38);
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = theme.paper;
  ctx.beginPath();
  ctx.roundRect(fit.x, fit.y, fit.w, fit.h, radius);
  ctx.fill();
  ctx.restore();

  // The clip is what rounds the card: `renderCard` fills its stock as a plain
  // rectangle, and it must keep doing so — the printed card has square corners.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(fit.x, fit.y, fit.w, fit.h, radius);
  ctx.clip();
  renderCard(ctx, { ...input, scale: fit.scale, origin: { x: fit.x, y: fit.y } });
  ctx.restore();

  ctx.restore();
}

/** Export the story frame to a Blob. */
export async function renderStoryToBlob(
  input: StoryInput,
  type: "image/png" | "image/jpeg" = "image/png",
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_SIZE.w;
  canvas.height = STORY_SIZE.h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire a 2D canvas context");

  renderStory(ctx, input);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      type,
      type === "image/jpeg" ? 0.92 : undefined,
    );
  });
}
