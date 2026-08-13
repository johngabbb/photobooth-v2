"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND, CARD_FONT } from "@/lib/brand";
import { hitHalf, renderCard, withAlpha } from "@/lib/render";
import type { Rect, RenderInput, Role } from "@/lib/types";

/**
 * Displays a card by running the real renderer into an on-screen canvas.
 *
 * There is no separate "preview" implementation — this is the same `renderCard`
 * that produces the download, at a lower scale. That is the whole point: the
 * preview cannot drift from the exported file.
 */
export function CardCanvas({
  input,
  className,
  onPickPhoto,
}: {
  input: RenderInput;
  className?: string;
  /**
   * Makes the card interactive: photos highlight under the pointer and fire this
   * with whichever one was clicked.
   */
  onPickPhoto?: (slot: number, role: Role) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ slot: number; role: Role; rect: Rect } | null>(
    null,
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = Math.round(input.layout.canvas.w * input.scale);
    canvas.height = Math.round(input.layout.canvas.h * input.scale);

    renderCard(ctx, input);

    /*
     * Hover chrome, painted on top of the finished card.
     *
     * Deliberately here and not in `renderCard`: this is UI, not card content, and
     * the invariant that one renderer draws the card has to keep meaning what it
     * says. It cannot leak into the PNG either — `downloadCard` renders a fresh
     * canvas through `renderCard`, which knows nothing about a pointer.
     */
    if (!hover) return;

    const { rect } = hover;
    ctx.save();
    ctx.scale(input.scale, input.scale);

    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, input.layout.radius);
    ctx.fillStyle = withAlpha(BRAND.ink, 0.42);
    ctx.fill();

    const cx = rect.x + rect.w / 2;
    /*
     * Matches PrimaryButton: pumpkin pill, cream label, soft pumpkin shadow.
     *
     * Capped against the card width as well as the half, so the pill comes out the
     * same size whether it lands on a tall 2-photo half or a squat 4-photo one —
     * a button that resized with its slot would not read as one control.
     */
    const size = Math.min(Math.min(rect.w, rect.h) * 0.08, input.layout.canvas.w * 0.028);

    ctx.font = `600 ${size}px ${CARD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const label = "Mirror";
    // Ratios taken from the button's own `px-5 py-3` against its 14px text.
    const padX = size * 1.4;
    const padY = size * 0.85;
    const textW = ctx.measureText(label).width;
    const pillH = size + padY * 2;
    // Top of the photo rather than the middle: a face is usually centred, and the
    // point of hovering is to see which photo you are about to flip.
    const cy = rect.y + size * 0.9 + pillH / 2;

    ctx.shadowColor = withAlpha(BRAND.pumpkin, 0.45);
    ctx.shadowBlur = size * 0.9;
    ctx.shadowOffsetY = size * 0.25;

    ctx.beginPath();
    ctx.roundRect(
      cx - textW / 2 - padX,
      cy - pillH / 2,
      textW + padX * 2,
      pillH,
      pillH / 2,
    );
    ctx.fillStyle = BRAND.pumpkin;
    ctx.fill();

    // Cleared before the text, or the label picks up the pill's glow.
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = BRAND.cream;
    ctx.fillText(label, cx, cy);

    ctx.restore();
  }, [input, hover]);

  /** Design-pixel coordinates for a pointer event. */
  function toCard(e: React.MouseEvent<HTMLCanvasElement>) {
    // Via the element's *displayed* size, not its bitmap size: `max-h-full` scales
    // the canvas down to fit, so the two are rarely the same.
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * input.layout.canvas.w,
      y: ((e.clientY - r.top) / r.height) * input.layout.canvas.h,
    };
  }

  function handleMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onPickPhoto) return;

    const { x, y } = toCard(e);
    const hit = hitHalf(input.layout, x, y);
    // Empty slots get no affordance — there is no photograph there to mirror.
    const over = hit && input.shots[hit.slot]?.[hit.role] ? hit : null;

    setHover((prev) =>
      prev?.slot === over?.slot && prev?.role === over?.role ? prev : over,
    );
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onPickPhoto) return;
    const { x, y } = toCard(e);
    const hit = hitHalf(input.layout, x, y);
    if (hit && input.shots[hit.slot]?.[hit.role]) onPickPhoto(hit.slot, hit.role);
  }

  // No explicit CSS width or height: the canvas keeps its intrinsic bitmap size,
  // so `max-h-*` / `max-w-*` from the caller shrink it with the aspect ratio
  // intact. Setting both dimensions in CSS would stretch the bitmap instead.
  return (
    <canvas
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      onClick={handleClick}
      className={`${className ?? ""} ${onPickPhoto ? "cursor-pointer" : ""}`}
    />
  );
}
