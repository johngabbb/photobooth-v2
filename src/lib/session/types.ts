import type { Role } from "../types";

/**
 * Session wire types.
 *
 * The two card roles double as session roles: the person who creates the room is
 * `pamkin` and holds host authority; the joiner is `bee`. Tying them together means
 * a captured frame already knows which half of the card it belongs in — no separate
 * seat-to-slot mapping to keep in sync.
 */

export type SessionRole = Role;

export const HOST_ROLE: SessionRole = "pamkin";
export const GUEST_ROLE: SessionRole = "bee";

/** Everything a peer publishes about itself. Small — presence payloads are gossiped. */
export interface Presence {
  role: SessionRole;
  /** Distinguishes two tabs held by the same person. */
  peerId: string;
  cameraReady: boolean;
  /**
   * Guest only: has this device measured its offset from the host's clock yet?
   * The host is its own reference and publishes `true` from the start.
   *
   * Published as presence so neither device starts a countdown the guest would
   * convert with a garbage offset — a check that has to be based on something the
   * other side can actually observe.
   */
  clockSynced: boolean;
  /** Wall-clock join time, used to break host conflicts deterministically. */
  joinedAt: number;
}

/** Room settings. Either device may change these, as either may start the shoot. */
export interface RoomSettings {
  count: number;
  themeId: string;
  /** Border ornament, chosen independently of the colour theme. */
  borderId: string;
  /** Look applied to the photographs. */
  filterId: string;
}

export type SessionMessage =
  /**
   * A settings change. Carries only the changed keys, because either device may
   * now write: two people editing different fields at the same moment both keep
   * their change, where a whole-object message would let the later one win.
   */
  | { type: "settings"; from: SessionRole; patch: Partial<RoomSettings> }
  /** Sent by a joiner so the host re-broadcasts current settings. */
  | { type: "hello"; from: SessionRole }
  /**
   * Clock synchronisation. The guest pings, the host echoes with its own clock
   * reading, and the guest derives the offset between the two devices. Only the
   * guest computes anything — the host's clock *is* the reference.
   */
  | { type: "ping"; from: SessionRole; id: string; t0: number }
  | { type: "pong"; from: SessionRole; id: string; t0: number; t1: number }
  /**
   * Fire both shutters. `at` is an absolute timestamp **on the host's clock**; each
   * device converts to its own before scheduling. Broadcasting an instant rather
   * than a "go now" command is what makes the two captures simultaneous instead of
   * one-network-latency apart.
   *
   * `issued` is when the sender decided, also on the host's clock. Since either
   * person may start a shoot (D32), two schedules for the same shot can exist; both
   * devices keep the later-issued one, so they converge on the same instant rather
   * than each keeping whichever message it happened to see last.
   */
  | {
      type: "capture";
      from: SessionRole;
      shot: number;
      at: number;
      total: number;
      issued: number;
    }
  /**
   * One slice of a captured frame. Frames are chunked because a JPEG comfortably
   * exceeds a single realtime message, and chunking removes any need to know the
   * exact ceiling.
   */
  | {
      type: "frame";
      from: SessionRole;
      shot: number;
      seq: number;
      total: number;
      data: string;
    }
  /**
   * Discard shots and return to the lobby. Either person may send it — cancelling a
   * shoot has to stop the other device too, or its shutters keep firing.
   *
   * `issued` is on the host's clock, and lets a device drop capture messages from the
   * round being abandoned: without it a schedule already in flight would land after
   * the reset and quietly restart the shoot on one device only.
   */
  | { type: "reset"; from: SessionRole; issued: number }
  /**
   * WebRTC signalling for the live peer preview. SDP and ICE have to reach the other
   * device somehow before a peer connection can exist, and a broadcast channel is
   * exactly that. The host always offers — see rtc.ts.
   */
  | { type: "rtc-offer"; from: SessionRole; sdp: string }
  | { type: "rtc-answer"; from: SessionRole; sdp: string }
  | { type: "rtc-ice"; from: SessionRole; candidate: RTCIceCandidateInit };

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface JoinOptions {
  code: string;
  presence: Presence;
  onPeers: (peers: Presence[]) => void;
  onMessage: (msg: SessionMessage) => void;
  onState: (state: ConnectionState) => void;
}

/**
 * A realtime channel scoped to one room.
 *
 * Deliberately minimal — presence plus broadcast is the whole surface Phase 3 needs
 * for `captureAt`, so nothing here has to change when synchronised capture lands.
 */
export interface Transport {
  readonly kind: "local" | "supabase";
  join(opts: JoinOptions): Promise<void>;
  setPresence(patch: Partial<Presence>): Promise<void>;
  send(msg: SessionMessage): Promise<void>;
  leave(): Promise<void>;
}
