/**
 * Moving a captured frame from one device to the other.
 *
 * Frames ride the realtime channel as base64 chunks rather than going through
 * object storage (revising the original plan — see docs/decisions.md D19). Chunking
 * is not an optimisation: a JPEG of a camera frame comfortably exceeds a single
 * realtime message, and slicing it means never having to know the exact ceiling.
 *
 * Nothing is persisted anywhere. A frame exists in two browsers and in transit, and
 * that is all — which is both a privacy property worth keeping and the reason there
 * is no cleanup to write.
 */

import type { Role } from "../types";

/**
 * Payload budget per message. Deliberately conservative: realtime providers differ
 * on their limits, and the cost of being wrong is a silently dropped frame.
 */
const CHUNK_CHARS = 24_000;

/** Longest edge of a transmitted frame, in pixels. */
const MAX_EDGE = 1000;

const QUALITY = 0.8;

/**
 * Downscale and JPEG-encode a captured frame for transmission.
 *
 * The full camera resolution is far more than a card half needs — the largest half
 * is 547x750 at 300 DPI — so sending it untouched would be several times the bytes
 * for no visible gain. Capping the long edge at 1000px leaves comfortable headroom
 * for the cover-crop while keeping payloads small.
 *
 * Returns base64 *without* a data-URI prefix.
 */
export async function encodeFrame(source: HTMLCanvasElement): Promise<string> {
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));

  let toEncode: HTMLCanvasElement = source;
  if (scale < 1) {
    const scaled = document.createElement("canvas");
    scaled.width = Math.round(source.width * scale);
    scaled.height = Math.round(source.height * scale);

    const ctx = scaled.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
      toEncode = scaled;
    }
  }

  const dataUrl = toEncode.toDataURL("image/jpeg", QUALITY);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Decode a received frame back into something `renderCard` can draw. */
export function decodeFrame(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode received frame"));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

export function chunk(data: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK_CHARS) {
    parts.push(data.slice(i, i + CHUNK_CHARS));
  }
  // An empty payload would otherwise produce zero chunks and never complete.
  return parts.length ? parts : [""];
}

/**
 * Reassembles chunked frames arriving from the peer.
 *
 * Keyed by shot *and* role so a retake of shot 2 cannot be confused with the
 * original, and so both people's halves can stream in concurrently.
 */
export class FrameAssembler {
  private pending = new Map<
    string,
    { parts: string[]; seen: boolean[]; received: number; total: number }
  >();

  private static key(shot: number, role: Role) {
    return `${shot}:${role}`;
  }

  /** Returns the complete base64 payload once the final chunk lands, else null. */
  add(shot: number, role: Role, seq: number, total: number, data: string): string | null {
    const key = FrameAssembler.key(shot, role);
    let entry = this.pending.get(key);

    // A retake re-sends the same key with a fresh chunk count; start over rather
    // than merging new chunks into a stale buffer.
    if (!entry || entry.total !== total) {
      entry = {
        parts: new Array<string>(total).fill(""),
        // Arrival is tracked separately from content: a chunk's data can legitimately
        // be an empty string, so emptiness is not evidence it has not arrived.
        seen: new Array<boolean>(total).fill(false),
        received: 0,
        total,
      };
      this.pending.set(key, entry);
    }

    if (seq < 0 || seq >= total) return null;

    if (!entry.seen[seq]) {
      entry.seen[seq] = true;
      entry.received += 1;
    }
    entry.parts[seq] = data;

    if (entry.received < total) return null;

    this.pending.delete(key);
    return entry.parts.join("");
  }

  /** Drop partial transfers, e.g. when the session restarts. */
  clear() {
    this.pending.clear();
  }
}
