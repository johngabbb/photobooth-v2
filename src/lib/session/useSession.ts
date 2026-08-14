"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BORDERS, FILTERS, THEMES } from "../layouts";
import {
  HOST_CLOCK,
  PING_COUNT,
  PING_INTERVAL_MS,
  UNSYNCED,
  refine,
  sampleFrom,
  toHostTime,
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
  type SessionMessage,
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

/**
 * Which seat this device starts in.
 *
 * With no code there is no room to be a guest of, so the device takes the host seat.
 * That is not cosmetic: the stage lays its halves out in `ROLES` order, Pamkin left,
 * so defaulting to guest put your own camera on the *right* of an empty room — and
 * then moved it to the left the moment you pressed Create and became host.
 */
function initialRole(code: string): SessionRole {
  return !code || hasHostClaim(code) ? HOST_ROLE : GUEST_ROLE;
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
  /** Either device may call this; the change is merged on both. */
  updateSettings: (patch: Partial<RoomSettings>) => void;
  setCameraReady: (ready: boolean) => void;

  /** Offset between this device's clock and the host's. */
  clock: ClockSync;
  /**
   * Fire a synchronised shot. Either device may call it: the caller broadcasts the
   * instant and schedules its own capture from the same value.
   */
  scheduleCapture: (shot: number, delayMs: number, total: number) => void;
  /** Called on both devices at the agreed instant, with the shot index. */
  onCapture: (handler: CaptureHandler | null) => void;
  /** Publish this device's frame for a shot; chunks it to the peer. */
  sendFrame: (shot: number, canvas: HTMLCanvasElement) => Promise<void>;
  /** Fires when the peer's frame for a shot has fully arrived and decoded. */
  onPeerFrame: (handler: PeerFrameHandler | null) => void;
  /** Either device: tell both to discard and start over. */
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

/**
 * Should this capture be scheduled, given what is already scheduled for that shot?
 * Records the winner as a side effect.
 *
 * Both devices run this over the same messages and reach the same answer without
 * talking to each other, which is what makes two people pressing start at the same
 * moment converge instead of splitting the strip across two schedules. Later intent
 * wins — a retake is always issued after the shot it replaces — and an exact tie in
 * the same millisecond falls to a fixed role order, arbitrary but identical on both
 * sides. A duplicate of the current winner loses to itself, so replays are ignored.
 */
function winsSchedule(
  current: Map<number, { issued: number; from: SessionRole }>,
  resetIssued: number,
  shot: number,
  issued: number,
  from: SessionRole,
): boolean {
  // Issued before the last reset: a straggler from a round somebody cancelled.
  if (issued <= resetIssued) return false;

  const prev = current.get(shot);
  if (prev && (prev.issued > issued || (prev.issued === issued && prev.from >= from))) {
    return false;
  }

  current.set(shot, { issued, from });
  return true;
}

const DEFAULT_SETTINGS: RoomSettings = {
  count: 4,
  themeId: THEMES[0].id,
  borderId: BORDERS[0].id,
  filterId: FILTERS[0].id,
};

export function useSession(code: string): Session {
  // Derived at mount, not in an effect: this hook only ever runs client-side (the
  // lobby mounts with `ssr: false`), so `sessionStorage` and `crypto` are available
  // during the first render. Doing it in an effect would mean an extra render and a
  // frame where the host briefly believes it is a guest.
  const [peerId] = useState(() => crypto.randomUUID());
  const [role, setRole] = useState<SessionRole>(() => initialRole(code));
  const [peers, setPeers] = useState<Presence[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const [clock, setClock] = useState<ClockSync>(() =>
    initialRole(code) === HOST_ROLE ? HOST_CLOCK : UNSYNCED,
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
  const clockRef = useRef<ClockSync>(
    initialRole(code) === HOST_ROLE ? HOST_CLOCK : UNSYNCED,
  );
  const captureHandlerRef = useRef<CaptureHandler | null>(null);
  const peerFrameHandlerRef = useRef<PeerFrameHandler | null>(null);
  const resetHandlerRef = useRef<(() => void) | null>(null);
  /**
   * Who currently owns each shot's schedule, keyed by shot index.
   *
   * Either person may start a shoot (D32), so two schedules for the same shot can be
   * in flight at once — and each device would otherwise keep whichever message it saw
   * last, which is not necessarily the same one. Both apply the identical rule
   * instead, so they converge without a round trip.
   */
  const issuedRef = useRef(new Map<number, { issued: number; from: SessionRole }>());
  /** Host-clock instant of the most recent reset, so its round's stragglers can be dropped. */
  const resetIssuedRef = useRef(0);
  const assemblerRef = useRef(new FrameAssembler());
  const pingsRef = useRef(new Map<string, number>());
  const rtcRef = useRef<PeerVideo | null>(null);
  /**
   * Signalling that arrived before this device had a peer connection to hand it to.
   *
   * Both sides create their `PeerVideo` when they observe the *other* side's camera
   * go ready, so whose effect runs first is a race. If the host wins, its offer
   * reaches a guest whose connection does not exist yet — and since the host never
   * re-offers, the video link silently never forms. Buffering removes the ordering
   * dependency entirely.
   */
  const pendingSignalsRef = useRef<SessionMessage[]>([]);
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
          // Merged, not adopted: the sender only tells us what it changed, so a
          // simultaneous edit to a different field survives instead of being
          // overwritten by whichever message happened to land second.
          const next = { ...settingsRef.current, ...msg.patch };
          settingsRef.current = next;
          setSettings(next);
          return;
        }

        // Someone just arrived and does not know the settings yet. Answered by
        // whoever is *not* the sender rather than by the host specifically — that
        // way a host who reloads is caught up by the guest, instead of silently
        // resetting the room to defaults.
        if (msg.type === "hello" && msg.from !== roleRef.current) {
          void transport.send({
            type: "settings",
            from: roleRef.current,
            patch: settingsRef.current,
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
          if (
            !winsSchedule(
              issuedRef.current,
              resetIssuedRef.current,
              msg.shot,
              msg.issued,
              msg.from,
            )
          ) {
            return;
          }
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
          resetIssuedRef.current = Math.max(resetIssuedRef.current, msg.issued);
          issuedRef.current.clear();
          assemblerRef.current.clear();
          resetHandlerRef.current?.();
          return;
        }

        if (
          msg.type === "rtc-offer" ||
          msg.type === "rtc-answer" ||
          msg.type === "rtc-ice"
        ) {
          const rtc = rtcRef.current;
          if (rtc) void rtc.handleSignal(msg);
          else pendingSignalsRef.current.push(msg);
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
      // Local clock for us, host clock on the wire. For the host the conversion is a
      // no-op; for the guest it is the whole point of the offset in `clock.ts`.
      const at = Date.now() + delayMs;
      const issued = toHostTime(Date.now(), clockRef.current);
      const from = roleRef.current;

      if (!winsSchedule(issuedRef.current, resetIssuedRef.current, shot, issued, from)) {
        return;
      }

      void transportRef.current?.send({
        type: "capture",
        from,
        shot,
        at: toHostTime(at, clockRef.current),
        total,
        issued,
      });
      // Drive our own capture from the local value rather than round-tripping it
      // through the conversion, so we schedule against exactly what we measured.
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
    const issued = toHostTime(Date.now(), clockRef.current);
    resetIssuedRef.current = Math.max(resetIssuedRef.current, issued);
    issuedRef.current.clear();
    assemblerRef.current.clear();
    void transportRef.current?.send({ type: "reset", from: roleRef.current, issued });
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

    // Replay anything that arrived while we were still setting up.
    const queued = pendingSignalsRef.current;
    pendingSignalsRef.current = [];
    for (const msg of queued) void rtc.handleSignal(msg);

    return () => {
      rtcRef.current = null;
      pendingSignalsRef.current = [];
      rtc.stop();
    };
  }, [connection, peerReadyForVideo, localReady, peer?.peerId]);


  const updateSettings = useCallback((patch: Partial<RoomSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);

    // Broadcast the patch alone, never the merged object — that is what makes
    // concurrent edits to different fields compose instead of clobber.
    void transportRef.current?.send({
      type: "settings",
      from: roleRef.current,
      patch,
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
