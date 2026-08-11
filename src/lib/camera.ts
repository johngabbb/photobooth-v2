"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Camera acquisition.
 *
 * Deliberately not a thin wrapper around `getUserMedia`: the failure modes are the
 * substance of this module. A booth that says "camera error" when the real problem
 * is "you're on http, not https" or "Zoom already owns the webcam" wastes everyone's
 * time, so each case is distinguished and given its own message.
 */

export type CameraStatus =
  /** Never asked. The camera must be started by a user gesture — iOS requires it. */
  | "idle"
  | "requesting"
  | "ready"
  /** Permission refused, or blocked by policy. */
  | "denied"
  /** No camera attached, or no camera matching the constraints. */
  | "notfound"
  /** Hardware is present but held by another application. */
  | "busy"
  /** Page is not in a secure context — `getUserMedia` is unavailable over plain http. */
  | "insecure"
  /** Browser has no media devices API at all. */
  | "unsupported"
  | "error";

export interface Camera {
  status: CameraStatus;
  /** The live stream, for handing to a peer connection. */
  stream: MediaStream | null;
  /** Underlying DOMException message, for the details line. */
  detail: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
}

/** Human-readable explanation and, where there is one, the way out. */
export function cameraMessage(status: CameraStatus): { title: string; hint: string } {
  switch (status) {
    case "denied":
      return {
        title: "Camera permission denied",
        hint: "Allow camera access for this site in your browser's address bar, then try again.",
      };
    case "notfound":
      return {
        title: "No camera found",
        hint: "Connect a camera, or check that no privacy shutter or switch is disabling it.",
      };
    case "busy":
      return {
        title: "Camera is in use",
        hint: "Another app has the camera. Close it — video calls are the usual culprit — and try again.",
      };
    case "insecure":
      return {
        title: "Needs a secure connection",
        hint: "Cameras only work over https. Use the https URL, or localhost during development.",
      };
    case "unsupported":
      return {
        title: "Camera not supported",
        hint: "This browser has no camera API. Try a current Chrome, Safari, Firefox, or Edge.",
      };
    default:
      return {
        title: "Could not start the camera",
        hint: "Something went wrong reaching the camera. Try again.",
      };
  }
}

function classify(err: unknown): { status: CameraStatus; detail: string } {
  const name = err instanceof DOMException ? err.name : "";
  const detail = err instanceof Error ? err.message : String(err);

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { status: "denied", detail };
    case "NotFoundError":
    case "OverconstrainedError":
      return { status: "notfound", detail };
    case "NotReadableError":
    case "AbortError":
      return { status: "busy", detail };
    default:
      return { status: "error", detail };
  }
}

export function useCamera(): Camera {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (!window.isSecureContext) {
      setStatus("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");
    setDetail(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // `ideal` rather than `exact`: an unsatisfiable exact constraint throws
        // OverconstrainedError, which would read to the user as "no camera".
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });

      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setStream(stream);
      setStatus("ready");
    } catch (err) {
      const { status: s, detail: d } = classify(err);
      setDetail(d);
      setStatus(s);
    }
  }, []);

  // Attach the stream whenever the element and stream are both present. Runs on
  // every render on purpose — the <video> may mount after the stream arrives, and
  // this is cheap and idempotent.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {
        /* autoplay rejection is recoverable — the poster frame still shows */
      });
    }
  });

  // iOS suspends camera tracks when the tab backgrounds, and they do not resume on
  // their own. Without this the preview is a frozen frame after any notification.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "visible") return;

      const stream = streamRef.current;
      if (!stream) return;

      const dead = stream.getVideoTracks().every((t) => t.readyState === "ended");
      if (dead) {
        void start();
      } else {
        void videoRef.current?.play().catch(() => {});
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [start]);

  // Release the hardware when the booth unmounts — the camera light going out is
  // how people know it actually stopped.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { status, stream, detail, videoRef, start, stop };
}
