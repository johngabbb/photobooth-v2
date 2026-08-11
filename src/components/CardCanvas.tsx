"use client";

import { useEffect, useRef } from "react";
import { renderCard } from "@/lib/render";
import type { RenderInput } from "@/lib/types";

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
}: {
  input: RenderInput;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = Math.round(input.layout.canvas.w * input.scale);
    canvas.height = Math.round(input.layout.canvas.h * input.scale);

    renderCard(ctx, input);
  }, [input]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{
        aspectRatio: `${input.layout.canvas.w} / ${input.layout.canvas.h}`,
      }}
    />
  );
}
