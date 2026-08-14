# Architecture

How two phones end up holding the same photocard.

## The shape of the problem

Everything unusual about this app follows from one requirement: **two cameras, on two
devices, firing on the same countdown.** A normal photobooth is a single-device
canvas exercise. This one is a small distributed system with a hard real-time
constraint, wrapped in a canvas exercise.

Two consequences worth internalising:

1. **Every slot holds both people.** Simultaneous capture means there is no "Pamkin's
   frame" and "Bee's frame" — each slot is a composite of two halves taken at the same
   moment. The only open choice is where the seam runs (see `docs/decisions.md`).
2. **Serverless alone is not enough.** Two devices coordinating in real time need a
   persistent channel, and a Vercel function cannot hold one open.

```
   Device A (host)                     Device B (guest)
   ┌──────────────┐                    ┌──────────────┐
   │  cam preview │                    │  cam preview │
   └──────┬───────┘                    └───────┬──────┘
          │                                    │
          │      { type: "capture",            │
          │        shot: 2,                    │
          │        at: 1765432100.000 }        │
          └──────────►  realtime  ◄────────────┘
                            │
              each device schedules its own shutter
              against its own clock-corrected copy of `at`
                            │
          ┌─────────────────┴─────────────────┐
          │   halves uploaded, both fetched   │
          └─────────────────┬─────────────────┘
                            ▼
              renderCard() runs on BOTH devices
                            ▼
                    ┌─────────────┐
                    │  photocard  │
                    └─────────────┘
```

## Realtime transport

Recommendation: **Supabase Realtime**, with Next.js on Vercel.

| Option | Why | Why not |
|---|---|---|
| **Supabase Realtime** | Channels for signaling, Storage for frame handoff, Postgres if a gallery ever happens — one vendor covers all three. Generous free tier. | One more service to hold accounts for. |
| Socket.IO on Railway/Render | Single deploy target, no third party. | Loses Vercel's preview deployments, which matter here because cross-device testing needs a real HTTPS URL. |
| Pusher / Ably | Cleanest pub-sub API. | Message quotas, and no storage — you would still need somewhere to put the frames. |

The deciding factor is that Supabase covers the *frame handoff* too. The alternatives
solve messaging and leave the harder half unsolved.

## Synchronising two shutters

Naively broadcasting "shoot now" puts the two captures a full network latency apart —
tens to hundreds of milliseconds, and unpredictably so. The fix is standard:

1. **Estimate clock offset on join.** The guest pings the host through the channel
   ~5 times. Keep the sample with the lowest round-trip time, since that one has the
   least queuing noise, and take `offset ≈ hostTime - (guestTime - rtt/2)`.
2. **Broadcast an absolute time, not an imperative.** Whichever device starts the
   shoot sends `captureAt` as a timestamp on the *host's* clock. Each device converts
   to its own corrected clock and schedules a `setTimeout`. Late-arriving messages
   self-correct; a dropped message is detectable.
3. **Drive the countdown from the same timestamp**, so both screens tick in step and
   the two people are actually posing together.
4. **Capture locally.** Draw the `<video>` element straight to an offscreen canvas.

Accuracy lands around a few tens of milliseconds, which is far below what anyone can
perceive in a still photo.

> Do not reach for `ImageCapture`. Support outside Chromium is still patchy;
> `ctx.drawImage(videoEl, …)` works everywhere and is what `render.ts` already expects.

## Frame handoff and compositing

After a shot each device holds one JPEG — of itself. The halves have to meet.

**Chosen approach:** each device uploads its half to Storage at
`session/{code}/shot/{n}/{role}.jpg` and broadcasts the path. Once a device has both
halves, it composites that slot locally.

Both devices run the *same* deterministic `renderCard`, which buys three things:

- each person gets an instant download without waiting on the other
- no "whose file is it" ownership question
- a shareable `/card/[id]` link becomes optional rather than load-bearing

A WebRTC data channel would skip the storage round-trip, but it adds NAT traversal
and chunking of multi-hundred-KB JPEGs to save latency between shots that nobody is
waiting on. Storage first; revisit only if it measurably drags.

## Session model

The **host** is the clock reference — every `captureAt` on the wire is in its time —
and the only one who can retake a single photo. Everything else is shared: both
devices edit the settings as patches that merge (D28), and either may start or cancel
a shoot (D32). Concurrency is resolved by rule rather than by a single writer: for
settings, whoever touched a field last owns that field; for the countdown, both sides
independently keep the later-issued schedule for each shot.

```
/                    landing — start a session
/join                enter a room code
/room/[code]         the booth; host and guest render one page in two roles
/card/[id]           shareable result
/api/session         POST create · GET validate
```

## Rendering

See `src/lib/render.ts`. The contract that matters: **one renderer, used for both the
preview and the export**, differing only by `scale`. Card geometry is derived from a
declarative `Layout` via `slotRects` and `halfRects`, so photo counts and card formats
are data. The renderer is pure with respect to its 2D context — no DOM, no React —
which keeps it verifiable in Node and portable to an OffscreenCanvas later.

## Platform constraints

- `getUserMedia` requires **HTTPS**. `localhost` will not reach your phone, so
  cross-device testing needs a tunnel or a Vercel preview URL.
- iOS Safari needs a **user gesture** before opening the camera — never auto-start it.
- iOS suspends camera tracks when the tab backgrounds. Reacquire on
  `visibilitychange`, or the guest's stream dies the moment they read a notification.
- Assume phones. Mobile-first is the default, not an adaptation.
