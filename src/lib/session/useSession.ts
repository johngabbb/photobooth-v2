"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { THEMES } from "../layouts";
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
}

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

  const transportRef = useRef<Transport | null>(null);
  const roleRef = useRef<SessionRole>(role);
  const settingsRef = useRef<RoomSettings>(DEFAULT_SETTINGS);
  // Last roster we published, so repeated identical syncs do not re-render.
  const rosterKeyRef = useRef<string>("");

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
          .map((p) => `${p.peerId}:${p.role}:${p.cameraReady}`)
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
        }
      },
    });

    return () => {
      cancelled = true;
      void transport.leave();
      transportRef.current = null;
    };
  }, [code, peerId]);

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

  const peer = useMemo(
    () => peers.find((p) => p.peerId !== peerId) ?? null,
    [peers, peerId],
  );

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
  };
}
