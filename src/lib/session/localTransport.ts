import type {
  JoinOptions,
  Presence,
  SessionMessage,
  Transport,
} from "./types";

/**
 * Same-browser transport built on `BroadcastChannel`.
 *
 * **This is not the production path.** `BroadcastChannel` reaches other tabs in the
 * same browser profile and nothing else — no second device, no second browser. It
 * exists so the entire session flow (codes, join, presence, role assignment,
 * settings sync) can be built and tested with two tabs, without anyone needing to
 * provision a Supabase project first, and so the app still does something coherent
 * when credentials are absent.
 *
 * Presence is gossiped rather than served: each peer re-announces on a heartbeat and
 * peers expire from the roster if they go quiet. That is a crude imitation of a real
 * presence service, but it exercises exactly the same interface, so swapping in
 * Supabase changes no calling code.
 */

const HEARTBEAT_MS = 800;
const EXPIRY_MS = 2600;

function samePresence(a: Presence, b: Presence): boolean {
  return (
    a.peerId === b.peerId &&
    a.role === b.role &&
    a.name === b.name &&
    a.cameraReady === b.cameraReady &&
    a.clockSynced === b.clockSynced &&
    a.joinedAt === b.joinedAt
  );
}

type Envelope =
  | { kind: "presence"; presence: Presence }
  | { kind: "bye"; peerId: string }
  | { kind: "message"; message: SessionMessage };

export class LocalTransport implements Transport {
  readonly kind = "local" as const;

  private channel: BroadcastChannel | null = null;
  private me: Presence | null = null;
  private opts: JoinOptions | null = null;
  private heartbeat: number | null = null;
  private sweeper: number | null = null;
  private peers = new Map<string, { presence: Presence; seen: number }>();

  async join(opts: JoinOptions): Promise<void> {
    this.opts = opts;
    this.me = { ...opts.presence };

    opts.onState("connecting");

    this.channel = new BroadcastChannel(`pamkin-room-${opts.code}`);
    this.channel.onmessage = (e: MessageEvent<Envelope>) => this.receive(e.data);

    this.announce();
    // A joiner asks the room to identify itself; existing peers answer by announcing.
    void this.send({ type: "hello", from: this.me.role });

    this.heartbeat = window.setInterval(() => this.announce(), HEARTBEAT_MS);
    this.sweeper = window.setInterval(() => this.sweep(), HEARTBEAT_MS);

    opts.onState("connected");
    this.emitPeers();
  }

  async setPresence(patch: Partial<Presence>): Promise<void> {
    if (!this.me) return;
    this.me = { ...this.me, ...patch };
    this.announce();
    this.emitPeers();
  }

  async send(message: SessionMessage): Promise<void> {
    this.channel?.postMessage({ kind: "message", message } satisfies Envelope);
  }

  async leave(): Promise<void> {
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    if (this.sweeper) window.clearInterval(this.sweeper);
    this.heartbeat = null;
    this.sweeper = null;

    if (this.channel && this.me) {
      this.channel.postMessage({ kind: "bye", peerId: this.me.peerId } satisfies Envelope);
    }
    this.channel?.close();
    this.channel = null;
    this.peers.clear();
    this.opts?.onState("idle");
  }

  private announce() {
    if (!this.me) return;
    this.channel?.postMessage({ kind: "presence", presence: this.me } satisfies Envelope);
  }

  private receive(env: Envelope) {
    if (env.kind === "presence") {
      // BroadcastChannel does not echo to the sender, so anything arriving is a peer.
      const prev = this.peers.get(env.presence.peerId);
      const changed =
        !prev || !samePresence(prev.presence, env.presence);

      this.peers.set(env.presence.peerId, {
        presence: env.presence,
        seen: Date.now(),
      });

      // Heartbeats arrive several times a second. Emitting on every one would push a
      // new roster array into React state continuously, re-rendering the lobby
      // forever for no reason.
      if (changed) this.emitPeers();
      return;
    }

    if (env.kind === "bye") {
      this.peers.delete(env.peerId);
      this.emitPeers();
      return;
    }

    if (env.message.type === "hello") {
      this.announce();
    }
    this.opts?.onMessage(env.message);
  }

  private sweep() {
    const cutoff = Date.now() - EXPIRY_MS;
    let changed = false;

    for (const [id, entry] of this.peers) {
      if (entry.seen < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private emitPeers() {
    if (!this.me) return;
    const roster = [this.me, ...[...this.peers.values()].map((p) => p.presence)];
    this.opts?.onPeers(roster);
  }
}
