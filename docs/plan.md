# pamkin photo bee — Photobooth Plan

A web photobooth where two people, on **two different devices**, open their cameras
into a shared live session. One countdown fires **both cameras at the same instant**.
Each shot produces one composed frame containing both people. N shots stack into a
downloadable photocard.

**Stack:** Next.js (App Router) · React · Tailwind CSS

---

## 1. Core model

The defining constraint is *simultaneous capture*. Both cameras are live at once and a
single countdown triggers both. That has one consequence worth stating up front:

> Every slot on the card holds **both** people. There is no "person A's frame" and
> "person B's frame" — each slot is a composite of two half-frames captured at the
> same moment.

So the merge question answers itself: **split-frame, on every slot**. The remaining
choice is only *how* each slot splits (§5).

```
   Device A (host)                 Device B (guest)
   ┌──────────────┐                ┌──────────────┐
   │  cam preview │                │  cam preview │
   └──────┬───────┘                └───────┬──────┘
          │      "capture at T+3.000s"     │
          └──────────► realtime ◄──────────┘
                          │
          both shoot locally at the same wall-clock instant
                          │
          ┌───────────────┴───────────────┐
          │  frames exchanged, composited │
          └───────────────┬───────────────┘
                          ▼
                   ┌─────────────┐
                   │  photocard  │  ← both devices can download
                   └─────────────┘
```

---

## 2. Architecture

### Why there's a server component

Next.js on Vercel is serverless — it cannot hold an open WebSocket. Two devices that
need to coordinate in real time need a persistent channel. Three ways to get one:

| Option | How | Trade-off |
|---|---|---|
| **Supabase Realtime** *(recommended)* | Vercel-hosted Next.js + Supabase channels for signaling, Storage for frames | Free tier is generous; also gives you Storage and Postgres if you later want a gallery. One extra service. |
| Self-hosted Socket.IO | Next.js with a custom Node server on Railway/Render/Fly | One deploy target, no third party. Loses Vercel's edge/preview niceties. |
| Pusher / Ably | Vercel + managed pub-sub | Simplest API, but a message-quota ceiling and no storage. |

Recommendation is **Supabase Realtime**: it covers signaling, WebRTC handshake, *and*
frame handoff without adding a second vendor.

### Routes

```
/                    landing — "Start a session"
/join                enter a room code
/room/[code]         the booth (host and guest render the same page, different roles)
/card/[id]           shareable result page
/api/session         POST create room · GET validate code
```

### State ownership

The **host** device is authoritative. It owns the room settings (photo count, layout,
filter), fires the countdown, and is the default compositor. The guest mirrors host
state over the channel and can only signal "ready" / "retake please". Keeping one
writer avoids conflict resolution entirely.

---

## 3. The hard part: synchronizing two shutters

Independent countdowns drift by whatever the network latency happens to be. The fix
is standard and cheap:

1. **Estimate clock offset.** On join, the guest pings the host through the channel
   ~5 times. Take the sample with the lowest round-trip time; offset ≈
   `hostTime - (guestTime - rtt/2)`. Good to a few tens of milliseconds.
2. **Schedule, don't react.** The host broadcasts an *absolute* capture timestamp
   (`captureAt`), not a "go now" message. Each device converts to its own corrected
   clock and schedules `setTimeout`.
3. **Render the countdown off the same timestamp**, so both screens tick together.
4. **Capture is local.** Draw the `<video>` element to an offscreen canvas at the
   scheduled instant. Do *not* use `ImageCapture` — Safari and Firefox support is
   patchy; `ctx.drawImage(videoEl, ...)` works everywhere.

~50 ms of skew is imperceptible in a still photo, so this is comfortably good enough.

---

## 4. Frame exchange and compositing

After each shot, each device holds one JPEG of itself. To build the card, both halves
must meet somewhere.

**Approach:** each device uploads its half to Supabase Storage under
`session/{code}/shot/{n}/{role}.jpg` and broadcasts the path. Once a device has both
halves for a shot, it composites that slot locally.

Both devices run the *same* deterministic composite, which means:
- each person gets an instant local download, no waiting on the other
- no "who owns the file" question
- a shareable `/card/[id]` link is optional, not load-bearing

The alternative — WebRTC data channel for the frames — avoids the storage round-trip
but adds failure modes (NAT traversal, chunking large JPEGs) for a latency win nobody
will notice between shots. Storage first; revisit only if it feels slow.

**Export:** compose onto a canvas at 2× the display size, `canvas.toBlob('image/png')`,
trigger download. PNG for quality; offer JPEG as a smaller option.

---

## 5. Layout system

Layouts are declarative config, not hardcoded components — this is what makes "2, 3,
or 4 photos" a data change rather than three code paths.

```ts
type Layout = {
  id: string
  slots: number
  canvas: { w: number; h: number }      // export pixels
  padding: number
  gap: number
  split: 'vertical' | 'horizontal'      // how each slot divides between the two people
}
```

**Sizing — settled in Phase 0 (see decisions.md D1).** Duo cards are **4″×6″ with a
vertical split**; the 2″×6″ strip stays for solo mode. A 2″ strip split two ways gives
each person a 1″ column that crops a 4:3 webcam frame to ribbons. At 4″×6″ each half
measures:

| Photos | Half size | Aspect |
|---|---|---|
| 2 | 547 × 750 | 0.73 (portrait) |
| 3 | 547 × 492 | 1.11 (square-ish) |
| 4 | 547 × 363 | 1.51 (3:2 landscape) |

`SplitMode` still supports `horizontal`, so reversing this is a data change.

**Cropping:** camera gives 4:3 or 16:9; slots are portrait. Center-crop for v1. Face
detection to bias the crop is a nice later addition, not a v1 concern.

**Mirroring — settled in Phase 1.** The preview is always mirrored, because people
expect a mirror when facing a camera. The *output* now defaults to mirrored too, so
the card matches what you were looking at while posing; a toggle un-mirrors it.

---

## 6. Session flow

1. Host lands on `/`, hits **Start a session** → room created, 5-character code + QR shown
2. Guest scans the QR (or types the code at `/join`) → lands in the room
3. Both grant camera permission → lobby shows two live previews and two ready states
4. Host picks photo count (2 / 3 / 4), layout, and filter
5. Host starts → countdown → N synchronized shots with a pause between each
6. Review: retake any single shot, pick frame color, add a caption and date
7. Both download; optionally publish a `/card/[id]` link

---

## 7. Build phases

Each phase ends somewhere usable, so nothing is stuck behind a half-finished feature.

**Phase 0 — Scaffold** ✅ *done*
Next.js 16.3 + React 19.2 + Tailwind v4, design tokens, the declarative layout module,
the canvas renderer, and a card studio driven by synthetic placeholder photos. All six
layouts (solo and duo × 2/3/4 photos) render and export to PNG at 300 DPI.
Geometry verified by 39 assertions over the pure `slotRects` / `halfRects` functions.

**Phase 1 — Solo booth, end to end** ✅ *done*
One device, complete: camera permission → mirrored live preview framed to the card
slot → 3-2-1 countdown → N captures with a pause between → composite → PNG download,
plus per-slot retake. Lives at `/`; the Phase 0 layout harness moved to `/studio`.

The capture loop schedules against an absolute timestamp rather than chained
timeouts (decisions D12), which is the same shape Phase 3 needs for two devices.
Camera failures are distinguished rather than collapsed into "camera error" (D13).

Verified end to end in Chromium against a synthetic camera device: permission,
live stream, mirroring, countdown, four distinct captures landing in the right
slots, a 300 DPI PNG download, retake, and no clipping or page scroll.

**Phase 2 — Session plumbing** ✅ *done*
Landing page, Crockford-Base32 room codes with input normalisation, QR and copyable
join link, `/join` flow, `/room/[code]`, presence, role assignment, and
host-authoritative settings sync. No shared capture yet — exactly as scoped.

The transport is an interface (D15) with two implementations: Supabase Realtime for
real cross-device rooms, and `BroadcastChannel` for same-browser development. Both
are verified — the Supabase path against a live project, using two isolated browser
contexts that can only communicate over the network.

**Phase 2.5 — Deploy to Vercel** ✅ *done*
Live on Vercel from the GitHub `main` branch, Supabase variables set for Production
and Preview, and **a room confirmed working between two real devices** on the
deployed URL. That last part is the acceptance criterion — the rest is just a build.

Deployment sat here rather than at the end because it is **test infrastructure for
Phase 3, not a victory lap**. Phase 3 is two devices firing shutters together, and
that cannot be meaningfully tested without two devices — which needs HTTPS, because
`getUserMedia` does not exist over plain http and `localhost` cannot reach a phone.
Building synchronised capture before there is a URL to try it on means writing the
hardest part of the app blind.

A tunnel (`ngrok`, `cloudflared`) is the alternative and works fine for a quick trial,
but it is a worse fit for a phase of work: the URL changes every restart, and free
tunnels are slow enough to muddy the latency measurements that Phase 3's clock
correction depends on.

What it involves — the app is a stock Next.js build with no custom server, so there is
no configuration to speak of:

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new). Framework
   detection handles the rest; no build settings to change.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` under
   **Settings → Environment Variables**, for Production *and* Preview. `.env.local` is
   git-ignored, so these do not travel with the repo — this step is easy to forget and
   presents as "rooms silently only work between tabs".
3. **Do not set `NEXT_PUBLIC_USE_LOCAL_TRANSPORT`.** In production it would leave every
   room stuck in same-browser mode.
4. Open the deployed URL on two phones and confirm presence, camera state, and
   settings sync. Preview deployments get their own URLs, so branches can be tested
   without touching production.

HTTPS comes free, which is the whole point.

---

**Phase 3 — Synchronized capture** ✅ *done*
Clock offset estimation, `captureAt` broadcast, simultaneous shutter on both devices,
frame exchange, and a dual composite that leaves each person holding the same card.
**The product now exists.**

How it works: the host never says "shoot now". It broadcasts an *instant* on its own
clock; the guest converts using an offset measured by ping/pong through the channel
(lowest-RTT sample wins — see `clock.ts`) and schedules against its own clock. A late
message gives less warning but does not move the shutter.

Frames ride the same channel as chunked JPEGs rather than going through object
storage (D19), which means the whole feature works on the local transport and nothing
is ever persisted. All shots are scheduled up front rather than chained (D21), which
also makes retake a one-message operation.

Verified both ways: over the local transport with two tabs, and over **real Supabase
with the two peers in isolated browser contexts** — no shared storage, no
`BroadcastChannel`, so only the network can connect them. 175 ms round trip, both
devices reaching a complete card, both compositing the same result within compression
noise (D20), and either able to download its own copy.

**Phase 4 — Live peer preview**
WebRTC video so each person can see their partner while posing, using the existing
realtime channel for signaling. Genuinely improves the experience — you can't pose
together while blind to the other person — but the product works without it, so it
comes after Phase 3 rather than blocking it.

**Phase 5 — Polish**
Filters (CSS filter on preview, replayed on the export canvas), frame colors and
borders, captions, shareable card pages, retake-single-shot.

---

## 8. Known platform constraints

- `getUserMedia` requires **HTTPS** — use a tunnel or Vercel preview URLs for
  cross-device testing; `localhost` won't reach your phone.
- iOS Safari needs a **user gesture** before the camera opens; don't auto-start it.
- iOS suspends the camera when the tab backgrounds — handle reacquisition on
  `visibilitychange` or the guest's stream dies when they check a notification.
- Mobile-first layout is the right default; most people will do this on phones.

---

## 9. Open questions

1. **Persistence** — are cards ephemeral (download and gone), or is there a saved
   gallery per user? A gallery pulls in auth and changes the Supabase schema.
2. **Live peer preview priority** — Phase 4 as planned, or is seeing each other
   important enough to pull ahead of polish?
3. **Solo mode** — keep it as a shipped feature, or is it two-person only? Phase 0
   already renders solo cards and Phase 1 builds the solo capture path regardless, so
   keeping it costs almost nothing.

*Resolved:* card format (D1), transport (D5), host authority (D6).
