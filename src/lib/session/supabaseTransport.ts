import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { JoinOptions, Presence, SessionMessage, Transport } from "./types";

/**
 * Cross-device transport on Supabase Realtime.
 *
 * This is the production path — the only one of the two that reaches a second
 * device. It uses two Realtime features and no database at all:
 *
 * - **Presence** for the roster (who is in the room, are they camera-ready). Supabase
 *   keeps this in sync and hands back a full state on every change, so there is no
 *   heartbeat to maintain.
 * - **Broadcast** for messages. Phase 3's `captureAt` timestamp will ride the same
 *   channel with no changes here.
 *
 * Rooms are ephemeral: the channel name *is* the room. Nothing is persisted, so a
 * code stops working once everyone leaves, which is the behaviour we want.
 *
 * Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See
 * docs/setup.md. Realtime must have anonymous access enabled for the channel.
 */

/**
 * Credentials, or null when the app should fall back to the local transport.
 *
 * Two key names are accepted. Supabase now issues *publishable* keys
 * (`sb_publishable_…`) and its Connect dialog hands you a snippet naming the
 * variable `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the older *anon* keys (JWTs
 * beginning `eyJ…`) used `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both key formats work with
 * `supabase-js`, so whichever variable you paste in is honoured — a rename is not a
 * prerequisite for connecting.
 *
 * Each variable is referenced *literally*. Next.js inlines `NEXT_PUBLIC_*` at build
 * time by scanning the source for these exact expressions, so a computed lookup like
 * `process.env[name]` would come back undefined in the browser.
 *
 * Empty counts as absent: an unset value is falsy, which is what makes an
 * un-filled-in `.env.local` fall back cleanly instead of dialling a nonexistent host.
 */
export function supabaseConfig(): { url: string; key: string } | null {
  // Explicit off switch. Set NEXT_PUBLIC_USE_LOCAL_TRANSPORT=1 to force the local
  // transport while leaving credentials in place — better than blanking them, which
  // loses the values and makes "off" indistinguishable from "never configured".
  //
  // It is also the only way to exercise the fallback path once real credentials
  // exist, which otherwise becomes untestable the moment the project is set up.
  if (process.env.NEXT_PUBLIC_USE_LOCAL_TRANSPORT === "1") return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return url && key ? { url, key } : null;
}

/**
 * One client per credential pair, reused across joins.
 *
 * `createClient` spins up a GoTrue auth client that claims a fixed localStorage key.
 * Constructing one per room join means several instances contend for that key, which
 * Supabase warns about and describes as undefined behaviour. Auth is also disabled
 * outright — rooms are anonymous, so there is no session to persist or refresh, and
 * leaving it on writes tokens we never read.
 */
let cachedClient: { id: string; client: SupabaseClient } | null = null;

function getClient(config: { url: string; key: string }): SupabaseClient {
  const id = `${config.url}|${config.key}`;
  if (cachedClient?.id === id) return cachedClient.client;

  const client = createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  cachedClient = { id, client };
  return client;
}

export class SupabaseTransport implements Transport {
  readonly kind = "supabase" as const;

  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private me: Presence | null = null;
  private opts: JoinOptions | null = null;

  constructor(private config: { url: string; key: string }) {}

  async join(opts: JoinOptions): Promise<void> {
    this.opts = opts;
    this.me = { ...opts.presence };
    opts.onState("connecting");

    this.client = getClient(this.config);

    // A channel for this topic may already exist on the shared client: React Strict
    // Mode mounts effects twice in development, and `client.channel(topic)` hands
    // back the existing instance rather than a fresh one. Attaching listeners to an
    // already-subscribed channel throws ("cannot add presence callbacks after
    // subscribe"), and the topic cannot be made unique — both peers have to meet on
    // `room:CODE`. So drop any stale channel and start clean.
    for (const existing of this.client.getChannels()) {
      if (existing.topic === `realtime:room:${opts.code}`) {
        await this.client.removeChannel(existing);
      }
    }

    const channel = this.client.channel(`room:${opts.code}`, {
      config: {
        // `key` dedupes a peer across reconnects — without it a flaky connection
        // leaves ghosts in the roster.
        presence: { key: opts.presence.peerId },
        broadcast: { self: false },
      },
    });
    this.channel = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Presence>();
      const roster = Object.values(state)
        .flat()
        .map((p) => ({
          role: p.role,
          peerId: p.peerId,
          cameraReady: p.cameraReady,
          clockSynced: p.clockSynced,
          joinedAt: p.joinedAt,
        }));
      opts.onPeers(roster);
    });

    channel.on("broadcast", { event: "session" }, ({ payload }) => {
      opts.onMessage(payload as SessionMessage);
    });

    await new Promise<void>((resolve) => {
      // Never leave the caller awaiting forever. Without this, a channel that goes
      // straight to CLOSED (or never calls back at all) wedges `join()` and the room
      // sits on "Connecting…" with nothing to explain why.
      const settle = setTimeout(() => {
        opts.onState("failed");
        resolve();
      }, 15000);

      const done = () => {
        clearTimeout(settle);
        resolve();
      };

      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          if (this.me) void channel.track(this.me);
          opts.onState("connected");
          done();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[realtime]", status, err?.message ?? "");
          opts.onState("failed");
          done();
        } else if (status === "CLOSED") {
          // Expected during teardown; only meaningful if we were connected.
          opts.onState("reconnecting");
        }
      });
    });

    if (this.channel === channel) {
      await this.send({ type: "hello", from: this.me.role });
    }
  }

  async setPresence(patch: Partial<Presence>): Promise<void> {
    if (!this.me || !this.channel) return;
    this.me = { ...this.me, ...patch };
    await this.channel.track(this.me);
  }

  async send(message: SessionMessage): Promise<void> {
    await this.channel?.send({
      type: "broadcast",
      event: "session",
      payload: message,
    });
  }

  async leave(): Promise<void> {
    const channel = this.channel;
    // Cleared first so a subscribe callback still in flight cannot resurrect it.
    this.channel = null;

    await channel?.untrack().catch(() => {});
    if (channel) await this.client?.removeChannel(channel);
    // The client itself is shared and deliberately not torn down here.
    this.client = null;
    this.opts?.onState("idle");
  }
}
