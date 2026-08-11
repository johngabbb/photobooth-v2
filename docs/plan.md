# Pamkin and Bee — Photobooth Plan

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

**Mirroring:** show the preview mirrored (people expect their selfie view) but write
the output un-mirrored, with a toggle if it looks wrong in testing.

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

**Phase 1 — Solo booth, end to end** ← *the de-risking phase*
One device: camera permission → live preview → countdown → N shots → composite →
download. No session, no realtime, no second person. This is a complete, shippable
photobooth on its own, and it proves out the camera, canvas, cropping, and export
work before any distributed-systems complexity lands.

**Phase 2 — Session plumbing**
Room creation, codes, QR, join flow, Supabase Realtime channel, presence, role
assignment, host-authoritative settings sync. Still no shared capture — just two
people in a room seeing each other's ready state.

**Phase 3 — Synchronized capture**
Clock offset estimation, scheduled `captureAt` broadcast, simultaneous shutter, frame
upload and exchange, dual composite. **This is the milestone that delivers the actual
product.**

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
