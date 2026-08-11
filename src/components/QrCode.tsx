"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { BRAND } from "@/lib/brand";

/**
 * Join QR, drawn straight into a canvas.
 *
 * Uses the brand ink on card stock rather than pure black on white — still well past
 * the contrast a scanner needs, and it stops the code looking like a pasted-in
 * foreign object. Error correction is left at medium: the code carries a short URL,
 * so there is plenty of headroom without inflating the module count.
 */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: BRAND.ink, light: BRAND.paper },
      errorCorrectionLevel: "M",
    }).catch(() => {
      /* An unrenderable value just leaves the canvas blank; the code text is shown too. */
    });
  }, [value, size]);

  return (
    <canvas
      ref={ref}
      aria-label={`QR code linking to ${value}`}
      className="rounded-lg ring-1 ring-ink/10"
    />
  );
}
