"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { THEMES } from "../layouts";
import {
  HOST_CLOCK,
  PING_COUNT,
  PING_INTERVAL_MS,
  UNSYNCED,
  refine,
  sampleFrom,
  toLocalTime,
  type ClockSync,
} from "./clock";
import { FrameAssembler, chunk, decodeFrame, encodeFrame } from "./frames";
import { PeerVideo, type PeerVideoState } from "./rtc";
import { LocalTransport } from "./localTransport";
import { SupabaseTransport, supabaseConfig } from "./supabaseTransport";
import {
  GUEST_ROLE,
  HOST_ROLE,
  type ConnectionState,
  type Presence,
  type RoomSettings,
  type SessionRole,
  type Transport,
} from "./types";

const HOST_CLAIM_PREFIX = "pamkin:host:";

/** Mark this tab as the creator of `code`, before navigating into the room. */
export function claimHost(code: string) {
  sessionStorage.setItem(HOST_CLAIM_PREFIX + code, "1");
}

function hasHostClaim(code: string): boolean {
  return sessionStorage.getItem(HOST_CLAIM_PREFIX + code) === "1";
}

export interface Session {
  role: SessionRole;
  isHost: boolean;
  /** Everyone in the room, including me. */
  peers: Presence[];
  /** The other person, if they have arrived. */
  peer: Presence | null;
  connection: ConnectionState;
  transportKind: Transport["kind"];
  settings: RoomSettings;
  /** No-op for the guest: settings are host-authoritative. */
  updateSettings: (patch: Partial<RoomSettings>) => void;
  setCameraReady: (ready: boolean) => void;

  /** Offset between this device's clock and the host's. */
  clock: ClockSync;
  /**
   * Fire a synchronised shot. Host only — it broadcasts the instant and schedules
   * its own capture from the same value.
   */
  scheduleCapture: (shot: number, delayMs: number, total: number) => void;
  /** Called on both devices at the agreed instant, with the shot index. */
  onCapture: (handler: CaptureHandler | null) => void;
  /** Publish this device's frame for a shot; chunks it to the peer. */
  sendFrame: (shot: number, canvas: HTMLCanvasElement) => Promise<void>;
  /** Fires when the peer's frame for a shot has fully arrived and decoded. */
  onPeerFrame: (handler: PeerFrameHandler | null) => void;
  /** Host: tell both devices to discard and start over. */
  reset: () => void;
  onReset: (handler: (() => void) | null) => void;

  /** The other person's camera, once the peer connection is up. */
  peerStream: MediaStream | null;
  peerVideo: PeerVideoState;
  /** Hand the local camera to the peer connection. Safe to call repeatedly. */
  publishLocalStream: (stream: MediaStream | null) => void;
}

/** `at` is this device's local clock, already offset-corrected. */
export type CaptureHandler = (shot: number, at: number, total: number) => void;
export type PeerFrameHandler = (
  shot: number,
  role: SessionRole,
  image: HTMLImageElement,
) => void;

const DEFAULT_SETTINGS: RoomSettings = { count: 4, themeId: THEMES[0].id };

export function useSession(code: string): Session {
  // Derived at mount, not in an effect: this hook only ever runs client-side (the
  // lobby mounts with `ssr: false`), so `sessionStorage` and `crypto` are available
  // during the first render. Doing it in an effect would mean an extra render and a
  // frame where the host briefly believes it is a guest.
  const [peerId] = useState(() => crypto.randomUUID());
  const [role, setRole] = useState<SessionRole>(() =>
    hasHostClaim(code) ? HOST_ROLE : GUEST_ROLE,
  );
  const [peers, setPeers] = useState<Presence[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const [clock, setClock] = useState<ClockSync>(() =>
    hasHostClaim(code) ? HOST_CLOCK : UNSYNCED,
  );
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStream, setPeerStream] = useState<MediaStream | null>(null);
  const [peerVideo, setPeerVideo] = useState<PeerVideoState>("idle");

  const transportRef = useRef<Transport | null>(null);
  const roleRef = useRef<SessionRole>(role);
  const settingsRef = useRef<RoomSettings>(DEFAULT_SETTINGS);
  // Last roster we published, so repeated identical syncs do not re-render.
  const rosterKeyRef = useRef<string>("");

  // Callbacks live in refs, not state: they are set by the room component after
  // mount and must be readable from the message handler without re-joining the
  // channel every time the component re-renders.
  const clockRef = useRef<ClockSync>(hasHostClaim(code) ? HOST_CLOCK : UNSYNCED);
  const captureHandlerRef = useRef<CaptureHandler | null>(null);
  const peerFrameHandlerRef = useRef<PeerFrameHandler | null>(null);
  const resetHandlerRef = useRef<(() => void) | null>(null);
  const assemblerRef = useRef(new FrameAssembler());
  const pingsRef = useRef(new Map<string, number>());
  const rtcRef = useRef<PeerVideo | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const transportKind = useMemo<Transport["kind"]>(
    () => (supabaseConfig() ? "supabase" : "local"),
    [],
  );

  useEffect(() => {
    if (!code) return;

    const config = supabaseConfig();
    const transport: Transport = config
      ? new SupabaseTransport(config)
      : new LocalTransport();
    transportRef.current = transport;

    const me: Presence = {
      role: roleRef.current,
      peerId,
      cameraReady: false,
      clockSynced: roleRef.current === HOST_ROLE,
      joinedAt: Date.now(),
    };

    let cancelled = false;

    void transport.join({
      code,
      presence: me,
      onState: (s) => !cancelled && setConnection(s),
      onPeers: (roster) => {
        if (cancelled) return;

        // Supabase re-syncs presence liberally and the local transport gossips on a
        // heartbeat. Both can deliver an unchanged roster many times a second.
        const key = roster
          .map((p) => `${p.peerId}:${p.role}:${p.cameraReady}:${p.clockSynced}`)
          .sort()
          .join("|");
        if (key !== rosterKeyRef.current) {
          rosterKeyRef.current = key;
          setPeers(roster);
        }

        // Host conflict: two tabs opened the same create link. Deterministically the
        // earlier joiner keeps host; the later one steps down to guest so the room
        // never has two writers.
        const mine = roster.find((p) => p.peerId === peerId);
        if (!mine || mine.role !== HOST_ROLE) return;

        const otherHost = roster.find(
          (p) => p.peerId !== peerId && p.role === HOST_ROLE,
        );
        if (otherHost && otherHost.joinedAt < mine.joinedAt) {
          roleRef.current = GUEST_ROLE;
          setRole(GUEST_ROLE);
          sessionStorage.removeItem(HOST_CLAIM_PREFIX + code);
          void transport.setPresence({ role: GUEST_ROLE });
        }
      },
      onMessage: (msg) => {
        if (cancelled) return;

        if (msg.type === "settings") {
          // The host is the writer; ignore anything that would overwrite its own state.
          if (roleRef.current !== HOST_ROLE) {
            settingsRef.current = msg.settings;
            setSettings(msg.settings);
          }
          return;
        }

        // Someone just arrived and does not know the settings yet.
        if (msg.type === "hello" && roleRef.current === HOST_ROLE) {
          void transport.send({
            type: "settings",
            from: HOST_ROLE,
            settings: settingsRef.current,
          });
          return;
        }

        // Clock sync. The host simply echoes with its own reading; all the
        // arithmetic happens on the guest.
        if (msg.type === "ping" && roleRef.current === HOST_ROLE) {
          void transport.send({
            type: "pong",
            from: HOST_ROLE,
            id: msg.id,
            t0: msg.t0,
            t1: Date.now(),
          });
          return;
        }

        if (msg.type === "pong" && roleRef.current !== HOST_ROLE) {
          const sent = pingsRef.current.get(msg.id);
          if (sent === undefined) return;
          pingsRef.current.delete(msg.id);

          const current = clockRef.current;

          const next = refine(clockRef.current, sampleFrom(msg.t0, msg.t1, Date.now()));
          clockRef.current = next;
          setClock(next);
          if (!current.synced && next.synced) {
            void transport.setPresence({ clockSynced: true });
          }
          return;
        }

        // The shutter instant, expressed on the host's clock. Convert to this
        // device's clock before handing it on — for the host that is a no-op.
        if (msg.type === "capture") {
          captureHandlerRef.current?.(
            msg.shot,
            toLocalTime(msg.at, clockRef.current),
            msg.total,
          );
          return;
        }

        if (msg.type === "frame") {
          const complete = assemblerRef.current.add(
            msg.shot,
            msg.from,
            msg.seq,
            msg.total,
            msg.data,
          );
          if (complete) {
            void decodeFrame(complete)
              .then((img) => peerFrameHandlerRef.current?.(msg.shot, msg.from, img))
              .catch(() => {
                /* A corrupt frame leaves that half empty; retake covers it. */
              });
          }
          return;
        }

        if (msg.type === "reset") {
          assemblerRef.current.clear();
          resetHandlerRef.current?.();
          return;
        }

        if (
          msg.type === "rtc-offer" ||
          msg.type === "rtc-answer" ||
          msg.type === "rtc-ice"
        ) {
          void rtcRef.current?.handleSignal(msg);
        }
      },
    });

    return () => {
      cancelled = true;
      void transport.leave();
      transportRef.current = null;
    };
  }, [code, peerId]);

  // Probe the host's clock once both are present. Re-runs if the host reconnects,
  // because a new peer means a new clock to measure against.
  const hostPresent = peers.some((p) => p.role === HOST_ROLE && p.peerId !== peerId);
  useEffect(() => {
    if (roleRef.current === HOST_ROLE) return;
    if (connection !== "connected" || !hostPresent) return;

    let cancelled = false;
    let sent = 0;

    const timer = window.setInterval(() => {
      if (cancelled || sent >= PING_COUNT) {
        window.clearInterval(timer);
        return;
      }
      sent += 1;

      const id = crypto.randomUUID();
      const t0 = Date.now();
      pingsRef.current.set(id, t0);
      void transportRef.current?.send({ type: "ping", from: GUEST_ROLE, id, t0 });
    }, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection, hostPresent, peerId]);

  const scheduleCapture = useCallback(
    (shot: number, delayMs: number, total: number) => {
      if (roleRef.current !== HOST_ROLE) return;

      // Host clock is the reference, so "now + delay" needs no correction here.
      const at = Date.now() + delayMs;
      void transportRef.current?.send({
        type: "capture",
        from: HOST_ROLE,
        shot,
        at,
        total,
      });
      // Drive our own capture from the identical value rather than a second
      // `Date.now()`, so host and guest are working from one number.
      captureHandlerRef.current?.(shot, at, total);
    },
    [],
  );

  const onCapture = useCallback((handler: CaptureHandler | null) => {
    captureHandlerRef.current = handler;
  }, []);

  const onPeerFrame = useCallback((handler: PeerFrameHandler | null) => {
    peerFrameHandlerRef.current = handler;
  }, []);

  const onReset = useCallback((handler: (() => void) | null) => {
    resetHandlerRef.current = handler;
  }, []);

  const sendFrame = useCallback(async (shot: number, canvas: HTMLCanvasElement) => {
    const transport = transportRef.current;
    if (!transport) return;

    const encoded = await encodeFrame(canvas);
    const parts = chunk(encoded);

    for (let seq = 0; seq < parts.length; seq++) {
      await transport.send({
        type: "frame",
        from: roleRef.current,
        shot,
        seq,
        total: parts.length,
        data: parts[seq],
      });
    }
  }, []);

  const reset = useCallback(() => {
    if (roleRef.current !== HOST_ROLE) return;
    assemblerRef.current.clear();
    void transportRef.current?.send({ type: "reset", from: HOST_ROLE });
    resetHandlerRef.current?.();
  }, []);

  const peer = useMemo(
    () => peers.find((p) => p.peerId !== peerId) ?? null,
    [peers, peerId],
  );

  const publishLocalStream = useCallback((stream: MediaStream | null) => {
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  // Bring the peer connection up once both people are present with cameras on.
  //
  // Gating on the peer's *published* camera state matters: offering before the other
  // side can add tracks negotiates a one-way connection, and nothing renegotiates it
  // afterwards.
  const peerReadyForVideo = Boolean(peer?.cameraReady);
  const localReady = Boolean(localStream);
  useEffect(() => {
    if (connection !== "connected") return;
    if (!peerReadyForVideo || !localReady) return;

    const rtc = new PeerVideo({
      isHost: roleRef.current === HOST_ROLE,
      role: roleRef.current,
      send: (msg) => void transportRef.current?.send(msg),
      onStream: setPeerStream,
      onState: setPeerVideo,
    });
    rtcRef.current = rtc;

    const stream = localStreamRef.current;
    if (stream) void rtc.start(stream);

    return () => {
      rtcRef.current = null;
      rtc.stop();
    };
  }, [connection, peerReadyForVideo, localReady, peer?.peerId]);


  const updateSettings = useCallback((patch: Partial<RoomSettings>) => {
    if (roleRef.current !== HOST_ROLE) return;

    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);

    void transportRef.current?.send({
      type: "settings",
      from: HOST_ROLE,
      settings: next,
    });
  }, []);

  const setCameraReady = useCallback((ready: boolean) => {
    void transportRef.current?.setPresence({ cameraReady: ready });
  }, []);

  return {
    role,
    isHost: role === HOST_ROLE,
    peers,
    peer,
    connection,
    transportKind,
    settings,
    updateSettings,
    setCameraReady,
    clock,
    scheduleCapture,
    onCapture,
    sendFrame,
    onPeerFrame,
    reset,
    onReset,
    peerStream,
    peerVideo,
    publishLocalStream,
  };
}
