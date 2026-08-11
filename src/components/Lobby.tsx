"use client";

import { useEffect, useState } from "react";
import { CameraStage } from "@/components/CameraStage";
import { QrCode } from "@/components/QrCode";
import { Field, Segmented, ThemePicker } from "@/components/Controls";
import { useCamera } from "@/lib/camera";
import { PHOTO_COUNTS, layoutFor } from "@/lib/layouts";
import { slotRects } from "@/lib/render";
import { useSession } from "@/lib/session/useSession";
import { GUEST_ROLE, HOST_ROLE } from "@/lib/session/types";

/**
 * Phase 2: the room.
 *
 * Two people, one channel, shared settings — and deliberately no shared capture.
 * That is Phase 3. What this proves out is everything capture will sit on top of:
 * the channel connects, presence reflects who is here and whether their camera is
 * live, roles are assigned without a race, and the host's settings reach the guest.
 */

const ROLE_LABEL = { pamkin: "Pamkin", bee: "Bee" } as const;

export function Lobby({ code }: { code: string }) {
  const session = useSession(code);
  const camera = useCamera();

  // Read at mount rather than in an effect. Safe during render because the lobby is
  // client-only (`ssr: false`), so there is no server pass to mismatch against.
  const [origin] = useState(() => window.location.origin);
  const joinUrl = `${origin}/room/${code}`;

  // Publish camera readiness so the other person can see it.
  //
  // Depends on the destructured callback, never on `session` itself: the hook
  // returns a fresh object every render, so depending on it would re-fire this
  // effect on every render — and since publishing presence causes a render, that is
  // an infinite loop rather than a performance nit.
  const { setCameraReady } = session;
  const cameraReady = camera.status === "ready";
  useEffect(() => {
    setCameraReady(cameraReady);
  }, [cameraReady, setCameraReady]);

  const layout = layoutFor("duo", session.settings.count);
  const slotRect = slotRects(layout)[0];
  // Each person fills half a slot — that is the frame they should be composing for.
  const half = { w: (slotRect.w - layout.splitGap) / 2, h: slotRect.h };

  const peer = session.peer;
  const bothReady = cameraReady && Boolean(peer?.cameraReady);

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 gap-6 px-6 py-5 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-h-0 flex-col items-center justify-center gap-3">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <CameraStage
            camera={camera}
            slot={half}
            countdown={null}
            flash={false}
            onStart={camera.start}
          />
        </div>
        <p className="shrink-0 font-mono text-[11px] text-ink/50">
          You are {ROLE_LABEL[session.role]} · your half of a {layout.physical} card
        </p>
      </div>

      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto">
        <ConnectionBanner
          state={session.connection}
          kind={session.transportKind}
        />

        <Field label="Room code">
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-3xl font-bold tracking-[0.2em] text-ink">
                {code}
              </span>
              <CopyLink url={joinUrl} />
            </div>
            <QrCode value={joinUrl} size={104} />
          </div>
        </Field>

        <Field label="Who's here">
          <div className="flex flex-col gap-2">
            <PeerRow
              label={`${ROLE_LABEL[session.role]} (you)`}
              present
              ready={cameraReady}
              host={session.isHost}
            />
            <PeerRow
              label={ROLE_LABEL[session.role === HOST_ROLE ? GUEST_ROLE : HOST_ROLE]}
              present={Boolean(peer)}
              ready={Boolean(peer?.cameraReady)}
              host={peer?.role === HOST_ROLE}
            />
          </div>
        </Field>

        <Field label={session.isHost ? "Photos" : "Photos (set by host)"}>
          <Segmented
            options={PHOTO_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(session.settings.count)}
            onChange={(v) => session.updateSettings({ count: Number(v) })}
            disabled={!session.isHost}
          />
        </Field>

        <Field label={session.isHost ? "Theme" : "Theme (set by host)"}>
          <div className={session.isHost ? "" : "pointer-events-none opacity-60"}>
            <ThemePicker
              value={session.settings.themeId}
              onChange={(id) => session.updateSettings({ themeId: id })}
            />
          </div>
        </Field>

        <div className="rounded-xl border border-ink/10 bg-paper/60 p-3">
          <p className="text-sm font-medium text-ink/80">
            {!peer
              ? "Waiting for the other person…"
              : bothReady
                ? "Both cameras are live."
                : "Waiting for both cameras…"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
            {bothReady
              ? "Synchronised capture arrives in Phase 3 — one countdown will fire both shutters at the same instant."
              : "Share the code or QR above. Each of you needs to enable your own camera."}
          </p>
        </div>
      </aside>
    </div>
  );
}

function PeerRow({
  label,
  present,
  ready,
  host,
}: {
  label: string;
  present: boolean;
  ready: boolean;
  host: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-ink/10 bg-paper/60 px-3 py-2">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          ready ? "bg-leaf" : present ? "bg-honey" : "bg-ink/15"
        }`}
      />
      <span className="text-sm font-medium text-ink/85">{label}</span>
      {host && (
        <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink/55">
          host
        </span>
      )}
      <span className="ml-auto text-[11px] text-ink/45">
        {!present ? "not here" : ready ? "camera on" : "no camera"}
      </span>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard can be blocked; the code and QR are still on screen. */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!url}
      className="self-start rounded-full border border-ink/15 px-3 py-1 text-[11px] font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
    >
      {copied ? "Link copied" : "Copy join link"}
    </button>
  );
}

function ConnectionBanner({
  state,
  kind,
}: {
  state: string;
  kind: "local" | "supabase";
}) {
  if (kind === "local") {
    return (
      <div className="rounded-xl border border-honey/60 bg-honey/15 p-3">
        <p className="text-xs font-semibold text-ink/80">Same-browser mode</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink/60">
          No Supabase credentials, so the room runs over <code>BroadcastChannel</code>{" "}
          — other tabs in this browser only, not a second device. See docs/setup.md.
        </p>
      </div>
    );
  }

  if (state === "connected") return null;

  return (
    <div className="rounded-xl border border-ink/10 bg-paper/60 p-3 text-xs text-ink/60">
      {state === "failed"
        ? "Could not reach the session server."
        : "Connecting to the room…"}
    </div>
  );
}
