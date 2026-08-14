# Decisions

Choices that look arbitrary from the code, with the reasoning that produced them.
Read before reversing one.

---

## D1 — Duo cards are 4" x 6", not a 2" x 6" strip

**Status:** decided in Phase 0, open to revisiting

A classic photostrip is 2x6 inches. Split vertically for two people, each person gets
a **1-inch column** — and since a webcam hands us a 4:3 frame, filling a 1x1.2-inch
slot crops away most of the width. Faces land badly.

At 4x6 each half is ~1.8 inches. Measured half-frame sizes at 300 DPI:

| Photos | Half size | Aspect |
|---|---|---|
| 2 | 547 x 750 | 0.73 (portrait) |
| 3 | 547 x 492 | 1.11 (square-ish) |
| 4 | 547 x 363 | 1.51 (3:2 landscape) |

All three are comfortable crops for a face. The cost is losing the iconic tall-strip
silhouette, so the 2x6 strip stays available for **solo** mode where the full width
belongs to one person.

The rejected alternative was keeping 2x6 and splitting *horizontally* — stacking
Pamkin above Bee inside each slot. That preserves the silhouette but gives each person
a letterbox band roughly 2 x 0.7 inches, which flatters faces even less than the
narrow column did.

`SplitMode` still supports `"horizontal"`, so switching is a data change in
`layouts.ts`, not a rewrite.

---

## D2 — One renderer for preview and export

**Status:** load-bearing, do not reverse

The obvious build is a React/CSS card for the preview and a canvas routine for the
download. It is also a trap: two implementations of the same visual drift, and the
failure mode is the worst kind — the user downloads something that does not match
what they approved.

So `renderCard` draws into whatever 2D context it is handed, the preview is a
`<canvas>` at `scale: 0.42`, and the export is the same call at `scale: 1`. WYSIWYG is
structural rather than maintained by discipline.

Cost: card text and layout cannot use CSS, so typography is hand-drawn via
`fillText`. Accepted — a photocard has perhaps two lines of text.

---

## D3 — Card geometry is declarative data

**Status:** load-bearing

"2, 3, or 4 photos" could be three components. Instead a `Layout` describes padding,
gap, footer, and split, and `slotRects` / `halfRects` derive every rectangle. A new
photo count or paper size is an entry in `layouts.ts`.

This paid off immediately: verifying all six layouts meant checking pure functions in
Node — no browser, no canvas — which caught the footer-collision and slot-overlap
classes of bug before any pixels existed.

---

## D4 — The booth does not server-render

**Status:** decided in Phase 0

Canvas, `document`, and `getUserMedia` are all client-only. Rather than scattering
`typeof window` guards and pushing browser work into effects to dodge hydration
mismatches, the studio mounts via `next/dynamic` with `ssr: false`
(`CardStudioMount.tsx`).

This surfaced concretely: computing today's date for the caption during render caused
a server/client mismatch, and moving it into a `useEffect` tripped React 19's
`set-state-in-effect` rule. Both symptoms of pretending a client-only app renders on a
server. Opting out let the code become a plain lazy `useState` initializer.

There is nothing to server-render here anyway — no SEO surface beyond the landing
page, no data to stream.

---

## D5 — Frame handoff via Storage, not a WebRTC data channel

**Status:** decided, revisit if it feels slow

A data channel avoids the upload round-trip, but costs NAT traversal, TURN fallback,
and manual chunking of multi-hundred-KB JPEGs. The latency it saves falls between
shots, where nobody is waiting.

Storage upload plus a broadcast path is a handful of lines and fails in ways that are
easy to see and retry. WebRTC still arrives in Phase 4 — for *live peer video*, where
it is genuinely the only option, and where the signaling channel already exists.

---

## D6 — Host is authoritative

**Status:** superseded in part by D28 — settings are now shared; countdown timing
remains host-only

One writer for room settings and countdown timing. The guest mirrors state and may
only signal readiness or request a retake.

Two writers would mean reconciling concurrent edits to photo count or a double-started
countdown — real distributed-systems work, in exchange for flexibility nobody asked
for. If the guest needs to change a setting, they can ask out loud; they are on a
video call with the host by definition.

---

## D8 — The palette is sampled from the logo, not chosen beside it

**Status:** decided

Brand colours were extracted per-region from `public/brand/photobee.png` and recorded
in `BRAND` (`src/lib/brand.ts`). Nothing was picked by eye.

Sampling caught two things eyeballing would have got wrong: the linework is `#1E1F18`,
a warm charcoal rather than black, and the leaf is `#598718` — a deep olive that
*looks* like bright grass green at a glance. Guessing either would have left the UI
subtly out of tune with the artwork it sits next to.

Only `cream` and `paper` are invented, because the logo ships with a transparent
background and the app needs a surface to sit on. Method is in `docs/brand.md`.

---

## D9 — Card text uses a concrete font stack

**Status:** load-bearing, do not "tidy"

`CARD_FONT` names real families (`system-ui`, `Segoe UI`, `Roboto`, `Arial`,
`DejaVu Sans`, …) rather than the tidier CSS-style `ui-sans-serif, system-ui,
sans-serif`.

Canvas `font` parsing is not CSS. An unresolvable leading entry can drop the entire
declaration to the platform default, and on several renderers that default is a serif.
Headless renders here came out in DejaVu Serif until real families were named — the
first visible symptom of a bug that would only ever have shown up in the *exported
file*, never in the browser UI, and only for some users.

Nothing about the shorter stack is safe just because it looks like valid CSS.

---

## D15 — The session transport is an interface with two implementations

**Status:** decided in Phase 2

`Transport` (`src/lib/session/types.ts`) is presence + broadcast, and nothing else.
Two implementations sit behind it: `SupabaseTransport` for real cross-device rooms,
and `LocalTransport` over `BroadcastChannel` for same-browser development.

The seam pays for itself three times over:

- **The flow could be built and tested before any account existed.** Codes, joining,
  presence, role assignment, and settings sync were all verified with two tabs.
- **The app degrades honestly.** With no credentials it still runs, behind a banner
  that says plainly it cannot reach another device — rather than appearing to work
  and failing silently when a second phone joins.
- **Phase 3 needs no new surface.** Broadcasting `captureAt` is a `send()` on the
  channel that already exists.

The interface is deliberately smaller than what Supabase offers. Anything richer
would be a Supabase shape that `BroadcastChannel` could not honestly implement, and
the point of the seam is that both sides really satisfy it.

---

## D23 — The host always offers; WebRTC is additive

**Status:** decided in Phase 4

Peer video signals over the realtime channel that already exists — SDP and ICE are
just messages, and a broadcast channel is exactly the thing they need.

**The host is always the offerer**, decided by role rather than by whoever is ready
first. Two peers offering at once is "glare", the classic WebRTC failure, and
recovering from it needs rollback negotiation. With a fixed offerer the situation
cannot arise, and the cost is nothing: there is already a host.

**Nothing depends on it.** If the connection never establishes, the countdown still
fires, frames still cross, and the card is still produced — the peer half shows a
placeholder saying so. That is the point of layering it after Phase 3 rather than
building both together.

Two ordering rules that are easy to get wrong and were handled explicitly:

- **Offer only once the peer publishes `cameraReady`.** Offering earlier negotiates a
  one-way connection, and nothing renegotiates it afterwards. An offer arriving
  before the local camera exists is buffered rather than answered.
- **ICE candidates routinely arrive before the description they belong to.** They are
  queued and drained after `setRemoteDescription`. This is normal operation, not an
  error path.

---

## D26 — The stage reshapes on a phone

**Status:** decided after real-device testing

Below `lg` the stage shows **your own half filling the frame, with the other person
as an inset**, rather than the two halves side by side.

Side by side is right on a laptop and wrong on a phone, for a reason that is
arithmetic rather than taste: a 4-photo slot is 1104x363, a **3:1** ratio. In portrait
the fitted box is width-limited, so it collapses to roughly 130px tall — too small to
frame a face, and too small to hold the "Enable camera" prompt, whose button
overflowed the box and was clipped by `overflow-hidden`. The button was on screen and
untappable.

Two supporting fixes came out of the same report:

- **Overlays scroll** (`overflow-y-auto`) instead of pushing content out through a
  clipped edge. A box whose height is dictated by a card aspect ratio can always end
  up shorter than its own contents.
- **The mobile grid allocates rows explicitly** (`grid-rows-[3fr_2fr]`). Left to auto
  sizing, the controls' content won and squeezed the stage to ~150px.

Found by running the room on an actual phone. The desktop suites were all green
throughout — nothing in them constrains how a 3:1 box behaves in portrait.

---

## D27 — Signalling is buffered until the peer connection exists

**Status:** load-bearing

Both devices construct their `PeerVideo` when they observe the *other* side publish
`cameraReady`, so which effect runs first is a race. If the host wins, its offer
arrives at a guest that has no connection to hand it to — and since the host never
re-offers, the video link silently never forms.

`useSession` therefore queues any `rtc-*` message that arrives with no `PeerVideo`
present and replays the queue when one is created. That removes the ordering
dependency rather than trying to win the race.

`rtc.ts` buffers at two more points for the same class of reason: an offer arriving
before the local camera exists (answering early would negotiate a one-way
connection), and ICE candidates arriving before the description they belong to
(routine, not an error).

---

## D30 — The live preview wears the filter; the capture never does

**Status:** load-bearing

You could not see what a look did until after the shoot, which is the wrong time to
find out. The stages now put the selected filter on the `<video>` itself.

This costs one prop and no new logic, because `CardFilter.css` was already written in
the grammar both sides share — `types.ts` says so — so the *same string* tints the
preview and the canvas. There is no second definition of a look to drift.

**The filter goes on the `<video>` element, never on its wrapper.** The countdown
digit, the shutter flash and the permission prompts sit in that box too, and they are
chrome rather than picture: greying the "Enable camera" button along with the frame
behind it would be the same category error as filtering the card stock.

**Capture stays raw, and that is what makes this safe.** `captureFrame` calls
`drawImage(video)`, which reads the decoded frame and not the CSS-composited result —
so the photograph is unfiltered and `renderCard` applies the look exactly once. Worth
stating because the failure it avoids is silent: were it otherwise, every card would
come out double-filtered while the preview looked correct. Verified by drawing the
same video frame twice in one tick, once with the CSS filter on the element and once
with it removed: byte-identical, while a genuinely greyscaled draw of that frame
measured zero saturation.

Note the asymmetry with D29 — the two routes fail on opposite platforms. WebKit has
no `ctx.filter`, so the *card* needs a software fallback there; CSS `filter` on a
video is supported everywhere, so the *preview* needs nothing.

---

## D29 — Filters have a software fallback, because WebKit has no `ctx.filter`

**Status:** load-bearing

Every filter in the app went through `CanvasRenderingContext2D.filter`. WebKit does
not implement it: MDN's compat data has it arriving only in Safari **18**, and then
only behind a `Canvas Filters` preference that is **off by default**. `safari_ios`
mirrors desktop, and every browser on iOS is WebKit underneath — so on an iPhone,
in Safari *and* Chrome *and* Firefox, `ctx.filter = "grayscale(1)"` was a silent
no-op. Nothing threw. Photos came out untouched and all five picker swatches looked
identical, which meant the feature was not merely broken on iOS but invisible.

The fallback in `src/lib/colorFilter.ts` recolours the drawn pixels instead. It is
worth writing because of what we happen to ship: `saturate`, `contrast`, `sepia`,
`grayscale`, `brightness` — every one an affine transform of RGB with an exact
definition in Filter Effects Level 1, and not a blur or drop-shadow among them. So
this reproduces the native result rather than approximating it. Affine transforms
also compose, so a whole filter list collapses to one matrix and the pixel loop runs
once regardless of how many functions were chained.

`renderCard` picks a route once per render via `planFilter` and the rest of the
renderer is unchanged. An unsupported function aborts the parse and leaves the photo
alone, which is what the native path does with a string it cannot use.

Measured against Chromium's own implementation, with `ctx.filter` deleted from the
prototype to force the software path: mean error **under 1/255 per channel** across
the card, and identical output for `Original`.

**The one difference is a one-pixel rim**, and it is structural rather than a bug to
fix. The native filter runs *before* compositing and only ever sees the photograph;
this one runs *after* and sees the photograph already blended into the card stock
along its antialiased rounded edge. The pass is therefore snapped inward, leaving
that rim unfiltered — the alternative, rounding outward, tinted the cream stock and
drew a visible grey outline around all eight photos. Corner masking is done by hand
because `putImageData` ignores both the clip and the transform, and it tests the
pixel *centre* against the arc: rounding up instead stacked into a staircase of
unfiltered colour down each corner, the only artefact in this that was visible to
the eye.

At 300 DPI that rim is 1/300 of an inch. The comparison worth making is not against
a perfect filter but against no filter at all, which is what iOS had.

---

## D24 — STUN only, no TURN

**Status:** accepted limitation

`rtc.ts` configures public STUN servers and no TURN. STUN is enough to discover a
public address, which covers most home networks.

**Symmetric NATs and restrictive corporate networks will fail to connect.** Fixing
that requires a TURN server relaying the actual media, which costs real money and is
hard to justify for a feature that only makes posing easier — especially when capture
works without it.

The failure is handled rather than hidden: the peer half shows "Could not open a
video link — you can still take photos together", which is true.

Revisit if two-people-on-mobile-networks turns out to be the common case; that is
exactly the scenario STUN-only handles worst.

---

## D25 — The stage previews a whole slot, not your half

**Status:** decided in Phase 4

Once peer video exists, the natural stage is the **entire card slot**: both halves
side by side, split where the card splits, each person filling their own side. Same
framing, same cover-crop, same mirroring, same seam.

The preview stopped being "your camera" and became a live rehearsal of what the card
will hold — which is the actual thing either person wants to know while posing.

Both videos are mirrored, including the remote one. It looks wrong in isolation
(you would not mirror a video call) but it is right here, because `renderCard` applies
one `mirror` flag to both halves. Un-mirroring the peer would make the preview
disagree with the card.

---

## D22 — A queued capture always wins the stage

**Status:** load-bearing, this shipped broken once

The room shows the finished card when every slot is full. But "every slot is full" is
still true during a **retake** — the old halves are there until new ones replace them.
So the card kept the stage, the `<video>` element was never mounted, and
`captureFrame` had nothing to read from: the shutter fired, captured nothing, and the
shot silently never changed. From the outside it looked like the retake button did
nothing.

The fix is an explicit `pending` flag — a capture is queued and has not fired — which
takes precedence over completeness when deciding what the stage shows. A retake now
puts the camera and its countdown back on **both** devices, which is also the only
way for either person to know they are about to be photographed again.

The same flag now drives the scheduler loop, which previously ran a
`requestAnimationFrame` for the entire review doing nothing.

The general shape is worth remembering: *derived* state ("all slots full") is not the
same as *intended* state ("we are reviewing"), and conflating them breaks exactly when
a new action begins before the old data is replaced.

---

## D19 — Frames cross on the realtime channel, not object storage

**Status:** revises D5

D5 planned to hand frames over via Supabase Storage. Phase 3 changed course: frames
are JPEG-encoded, chunked, and sent as broadcast messages on the channel that already
carries settings and `captureAt`.

Three reasons, in order of weight:

1. **Storage needs provisioning that cannot be verified from here** — a bucket plus
   RLS policies, created by hand in a dashboard. Anything the build depends on but
   cannot check is a support burden and a silent-failure surface.
2. **It rides the `Transport` interface**, so the whole feature works on the local
   transport too. Synchronised capture and frame exchange were developed and tested
   with two tabs before ever touching the network — and the local path stays testable
   afterwards.
3. **Nothing is persisted.** A frame exists in two browsers and in transit. There is
   no bucket filling with other people's faces, no retention policy to write, and no
   cleanup job. For a photobooth that is the better default, not a compromise.

Chunking is not tuning — a JPEG of a camera frame exceeds a single realtime message,
and slicing at a conservative 24 KB means never depending on a provider's exact
ceiling. Frames are downscaled to a 1000px long edge first: the largest card half is
547x750 at 300 DPI, so full sensor resolution would be several times the bytes for no
visible gain.

Revisit if frames ever need to outlive the session — a shareable `/card/[id]` link
would genuinely need storage.

---

## D20 — Each device keeps its own half at full quality

**Status:** decided, with a consequence worth knowing

Both devices composite the same card, but not bit-identically. A device draws **its
own** half from the raw capture canvas and the **peer's** from the JPEG it received,
so the two copies differ by compression noise on opposite halves — measured at
0.0008% signature drift across a full card.

The alternative was round-tripping your own frame through the same encode/decode so
both halves are treated identically and the files match exactly. Rejected: it
degrades a perfectly good local frame to buy a symmetry nobody can see. At a 1000px
long edge compressed into a 547px-wide slot, the artefacts are not visible.

The consequence is only for tests: "both devices produce the same card" has to be
asserted with a tolerance, never as equality.

---

## D21 — Shots are scheduled up front, not chained

**Status:** decided

Pressing start broadcasts **all** `capture` messages at once, each carrying its own
absolute instant. It does not send one, wait for it to fire, then send the next.

A chain would make every shot depend on the previous message arriving on time, so one
slow delivery would shift everything after it — and shift it differently on each
device, which is precisely the failure this phase exists to prevent. With absolute
instants, a delayed message gives the receiver less warning but does not move the
shutter.

It also makes retake trivial: re-broadcasting one `capture` for an existing index
overwrites that slot on both devices, with no notion of "current shot" to rewind.

---

## D18 — The Supabase client is shared; channels are not

**Status:** load-bearing

`createClient` is memoised per credential pair (`getClient`). Constructing one per
room join spawns competing GoTrue auth clients contending for the same localStorage
key, which Supabase explicitly warns is undefined behaviour. Auth is disabled
outright too — rooms are anonymous, so there is no session to persist or refresh.

Sharing the client creates a second problem that must be handled: `client.channel(topic)`
returns an **existing** channel if one is already registered for that topic, and
attaching listeners to a channel that has already subscribed throws
`cannot add 'presence' callbacks after subscribe()`.

That fires in ordinary development, because React Strict Mode mounts effects twice:
the second mount asks for the same topic and gets back the first mount's subscribed
channel. The topic cannot be made unique to dodge it — both peers must meet on
`room:CODE`. So `join()` removes any channel already registered for the topic before
creating its own.

`join()` also resolves on a timeout. Without it, a channel that goes straight to
`CLOSED` leaves the promise pending forever and the room sits on "Connecting…" with
nothing to explain why — which is exactly how this bug first presented.

---

## D16 — The host is decided by a sessionStorage claim, not by timing

**Status:** decided

The creator writes `pamkin:host:<code>` to `sessionStorage` *before* navigating into
the room; whoever holds that claim joins as host (`pamkin`), everyone else as guest
(`bee`). Session roles and card roles are the same enum, so a captured frame already
knows which half of the card it belongs to.

Deciding by arrival order instead would depend on comparing wall clocks across two
devices, which is exactly the thing Phase 3 has to work hard to correct for. A local
claim needs no clock at all.

`joinedAt` survives only as a tiebreaker: if two tabs somehow both hold a claim, the
later joiner detects the conflict in the presence roster and demotes itself, so the
room never has two writers.

---

## D17 — Presence must not churn

**Status:** load-bearing

Both transports can deliver an unchanged roster many times a second — the local one
gossips on an 800 ms heartbeat, and Supabase re-syncs presence liberally. Pushing
each of those into React state re-renders the room continuously.

Two guards, and both are needed:

- `LocalTransport` only emits when a peer's presence actually differs, so heartbeats
  are invisible.
- `useSession` compares a roster key before calling `setPeers`, which covers any
  transport including Supabase.

This was not theoretical. `useSession` returns a fresh object every render, so a
component effect depending on `session` rather than on the specific callback it uses
re-fired every render — and because publishing presence *causes* a render, that was
an infinite loop, not a performance nit. Depend on the destructured callback.

---

## D12 — The capture loop schedules against absolute wall-clock time

**Status:** load-bearing for Phase 3

The booth does not chain relative `setTimeout`s. It sets a `captureAt` timestamp and
a `requestAnimationFrame` loop fires when `Date.now() >= captureAt`.

On one device this is merely tidy — a stalled frame self-corrects instead of adding
drift to every subsequent shot. The reason it is built this way now is Phase 3:
synchronising two devices means broadcasting exactly this timestamp and letting each
device schedule against its own clock-corrected copy. Keeping the single-device loop
in that shape means Phase 3 adds a transport, not a rewrite.

rAF drives the countdown *animation*; the decision to fire is always a comparison
against the clock, never a count of elapsed frames.

The pending-shot queue is a ref (`queueRef`) rather than state, and holds slot
indices. That is what makes "retake photo 3" the same code path as "take all four" —
one queues `[2]`, the other `[0,1,2,3]`.

---

## D13 — Camera failures are distinguished, not collapsed

**Status:** decided

`useCamera` maps `getUserMedia` rejections onto specific states — `denied`,
`notfound`, `busy`, `insecure`, `unsupported` — each with its own message and fix.

This is most of the module by volume, and deliberately so. "Camera error" is useless
when the real problem is that the page is on plain http (`getUserMedia` simply does
not exist there), or that a video call already holds the device. `NotReadableError`
in particular means "hardware is fine, something else has it" — worth saying plainly.

Constraints use `ideal`, never `exact`: an unsatisfiable exact constraint throws
`OverconstrainedError`, which would surface to the user as "no camera found" on a
machine that has one.

The visibility handler is not optional. iOS ends camera tracks when the tab
backgrounds and does not resume them, so without it the preview is a frozen frame
after any notification.

---

## D14 — Aspect-ratio fitting uses an intrinsic-size spacer

**Status:** structural

**The card canvas** fits by CSS: its bitmap gives it an intrinsic aspect ratio, so
`max-h-full max-w-full` scales it down with the ratio intact.

**The camera stage measures instead** (`useFitBox`, a ResizeObserver). CSS cannot
express it, and three plausible-looking approaches all fail:

- A bare `aspect-ratio` div has no intrinsic size to scale from — one axis wins and
  the ratio breaks.
- An `<svg>` spacer looks like the canvas trick but is not. SVG `width`/`height` are
  *presentation attributes*: they become CSS declarations, so `max-width` clamps the
  width and leaves the height untouched. A canvas's attributes set its bitmap, which
  is why only the canvas gets an intrinsic ratio. Adding a `viewBox` does not rescue
  it.
- Percentage `max-height` resolves against the parent's height, so any auto-height
  wrapper in the chain silently turns it into `none`.

This was shipped broken in Phase 1 and only caught in Phase 2, because a portrait
slot in a portrait column looks plausible when the box is silently taking its
container's shape. It became obvious the moment a *landscape* slot appeared. Both
E2E suites now assert the preview box ratio against the slot it claims to represent.

Related trap: `max-h-full` resolves against the whole flex column, not the space left
after siblings. The stage therefore lives in its own `flex-1 min-h-0` box, or the
caption line beneath it gets clipped out of the viewport.

---

## D10 — The app is viewport-locked; the page never scrolls

**Status:** structural — new UI must fit inside it

`<html>` and `<body>` are `h-full overflow-hidden`. The booth is an app, not a
document: a photobooth that scrolls away from the live camera during a countdown
would be broken. Anything that overflows scrolls inside its own pane instead — the
studio's controls column is `overflow-y-auto`.

Two details make this work, and both are easy to undo by accident:

- **`min-h-0` on every flex/grid ancestor of the preview.** A flex child defaults to
  `min-height: auto`, which refuses to shrink below its content's intrinsic size and
  silently pushes the page taller than the viewport. Removing one `min-h-0` breaks
  the whole thing.
- **The preview canvas gets no CSS width or height** — only `max-h-full max-w-full`.
  It keeps its intrinsic bitmap size and scales down with its aspect ratio intact.
  Setting both CSS dimensions would stretch the bitmap instead of fitting it.

Verified in Chromium at 1440x900, 1280x700, and 1280x600, on both the 4x6 card and
the much taller solo strip: no page scroll, aspect ratio preserved.

---

## D11 — The card footer is the mark alone, no wordmark text

**Status:** decided

The footer originally printed "pamkin photo bee" next to the logo. The logo *is* the
wordmark, so that said the same thing twice. `CardContent` has no `title` field as a
result — only a caption.

The mark is pinned to the card's left padding so it lines up with the left edge of the
photos above it. The caption is centred on **the card's true centre**.

Centring it in the space beside the mark instead was tried and rejected: it reads as
pushed to the right, because the eye centres against the card edges, not against the
logo. Collision with the mark is prevented by the text box's *width* rather than its
position — the box is symmetric about the card centre and stops short of the mark on
both sides, so wrapped lines stay clear while the caption still looks centred.

Captions wrap rather than overflow (`wrapText`), with three behaviours worth keeping:

- Words too wide for a line of their own are **hard-broken**, so a pasted URL or an
  unbroken string cannot push past the margin.
- The block is clamped to whatever fits the footer band, with an ellipsis marking the
  cut, so a long caption cannot grow into the photos.
- `ctx.font` must be set **before** calling `wrapText` — measurement depends on it.

Verified against short, wrapping, unbreakable (400 characters, no spaces), and
mixed inputs, plus empty and whitespace-only.

---

## D7 — Colours are duplicated between CSS and TypeScript

**Status:** accepted wart

Brand colours live in `BRAND` (`src/lib/brand.ts`) as hex **and** in the `@theme` block
in `globals.css` as Tailwind tokens. A canvas cannot read CSS custom properties, so a
single source of truth is not available without reading computed styles at render
time — which would make the renderer DOM-dependent and break D2's portability.

Mitigation is a comment in both files. If it starts biting, the fix is to generate the
CSS block from the TypeScript at build time, not to make the renderer read the DOM.

---

## D28 — Both people edit settings; only the host fires the shutter

**Status:** the shutter half is superseded by D32; the settings half stands

Either device can change photo count, theme, border, and filter. Starting the
countdown, retaking a shot, and starting over stay host-only.

D6 refused this to avoid reconciling concurrent edits. That reasoning holds for the
*countdown* — two writers there means a double-started session and two conflicting
`captureAt` values, which is exactly the distributed-systems work worth avoiding.
It does not hold for settings, where the cost turned out to be one line: broadcast
the **patch** rather than the merged object.

```ts
// clobbers a simultaneous edit to a different field
send({ type: "settings", settings: { ...current, ...patch } })

// composes with it
send({ type: "settings", patch })
```

Receivers merge into their own copy. Two people changing the theme and the filter in
the same second both keep their change; only a genuine conflict — the same field,
same moment — resolves last-write-wins, and both then see the same value because the
loser's device re-renders from the merged state.

`hello` is now answered by whoever is *not* the sender rather than by the host, which
also fixes a pre-existing wart: a host who reloaded used to reset the room to
defaults, because it came back with `DEFAULT_SETTINGS` and nothing corrected it.

The practical argument for the change: D6 assumed the guest could "ask out loud"
because they are on a video call. They are looking at each other's cameras, not
necessarily talking, and the guest is the one person who can see how the card looks
to them.

---

## D31 — The story export mats the card; it does not reshape it

**Status:** decided

An Instagram story is 1080x1920 — 9:16. A duo card is 2:3 and a solo strip is 1:3.
Neither becomes the other, so "download it at story size" has to pick a loss:

- **Distort.** Stretch the card to 9:16. Faces get taller. Not a candidate.
- **Reframe.** Add 9:16 entries to `LAYOUTS` and re-derive the slots at that shape.
  This is the cheap change on paper — the renderer already takes every rectangle from
  `layout.canvas` — and for a duo card it is even a decent crop (487x532 halves at 3
  photos, against 547x492 today). It fails on solo: a 1080-wide strip gives each slot
  a 1.8:1 letterbox, and a 4:3 camera frame loses its top and bottom to fill it. It
  also forks the shoot — the photos would have to be *taken* knowing which output was
  wanted, because the crop differs.
- **Mat.** Keep the card exactly as it prints and centre it on a 1080x1920 field.

Matting wins because the story copy is then the *same card*, not a second edit of the
same photos. `storyFit` scales it to 84% of the width and 76% of the height; the
vertical margin is the load-bearing number, since Instagram's header and reply bar
cover roughly the first and last 200px of the frame.

The field is `mixHex(paper, ink, 0.10 → 0.26)` — the card's own stock walked toward
its own ink — so every theme including the two dark ones gets a field that belongs to
it, with no per-theme entry to keep in sync.

This does not fork the renderer (D2). `renderStory` paints a background and then asks
`renderCard` for the card, which is why `RenderInput` gained an optional `origin`:
the card can be drawn at an offset instead of only at 0,0. `applyColorTransform`
already read the translation out of the live transform, so the WebKit software filter
path (D29) followed the card into the frame with no change — verified by rendering
both routes offset.

The story frame has no preview. It is a fixed, derived view of a card you are already
looking at, and previewing it would mean a second canvas showing the same photos at a
smaller size.

---

## D32 — Either person may start or cancel a shoot

**Status:** decided, supersedes the shutter half of D28

D28 kept the countdown host-only on the grounds that two writers means "a double-
started session and two conflicting `captureAt` values". That risk is real, but the
cost of the restriction is paid every session: the host is just whoever happened to
create the room, and the other person — who can see both cameras, and often the one
who is actually ready — could only wait to be photographed.

Both may now start, and either may cancel. Cancelling is the existing broadcast
`reset`, because stopping locally would leave the other device firing on the old
schedule.

The conflict D28 named is resolved by making the two devices agree without talking.
Every `capture` message carries `issued`, the sender's decision instant on the host's
clock, and both devices apply one rule per shot in `winsSchedule`:

- later `issued` wins — a retake is always issued after the shot it replaces, so this
  is the same rule for both cases;
- an exact millisecond tie falls to a fixed role order, evaluated identically on both
  sides;
- anything issued at or before the last `reset` is dropped, which is what stops a
  schedule already in flight from restarting the shoot on one device after somebody
  cancels.

Two people pressing start half a second apart therefore both converge on the later
schedule, rather than each keeping whichever message it happened to see last. No
round trip, no leader election, no lock.

The clock work is unchanged in substance but now runs in both directions: the
scheduler converts its local instant *to* host time with `toHostTime` before sending,
where before only the host scheduled and the conversion was a no-op it could skip.
`canStart` gained the presser's own `clock.synced` for the same reason — a guest
starting a countdown before it has measured its offset would send a garbage instant.
For the host that term is true from the start, so the gate reads exactly as it did.

Retaking a single photo is still host-only. It is the one control where two writers
would be genuinely confusing rather than merely concurrent — two people retaking
different photos of a finished card, each watching slots they did not ask for refill.

---

## D33 — People get names; roles keep the identity

**Status:** decided

Both seats used to be called what the app calls them: Pamkin and Bee. Each person now
picks a name, asked for **once, in the room**, by a modal with no dismiss.

Fields on the create and join screens were tried first and removed. The second person
usually arrives by QR straight at `/room/CODE` and passes through neither screen, so
the room has to ask anyway — and two implementations of one question is one too many.
Asking in the room also puts the question where its answer is about to be used: the
cameras and the roster are visible behind the modal, dimmed and unclickable, so you
can see the thing you are naming yourself to.

**The name is only ever a label.** `Role` still is the identity: which half of the card
a photo lands in, which side of the stage you stand on, who a `capture` came from, how
frames are keyed on the wire. Nothing under the UI knows names exist. Making the name
the identity would have reached into `halfKey`, `ROLES` order, `render.ts`, the frame
assembler, and the RTC offer/answer direction, all to change some text.

It rides in `Presence` rather than a message: it is state the other device needs
whenever it looks, including on the first roster it sees, and presence is already
gossiped for exactly that reason. The name published at *join* is empty even when
storage holds one, because nothing is confirmed until the modal is answered — a
browser-driven run caught the alternative announcing an arrival as "Gab is here" when
the person arriving was Mara, under a name the previous occupant of that browser had
used. For the same reason a peer is announced when their **name** lands rather than
when their presence does, which is why `onPeerChange` fires on a rename too. Two consequences that are easy to miss and were both
bugs before they were fixed — `samePresence` in `localTransport` and the roster key in
`useSession` compare field by field, and a rename is invisible to a comparison that
does not list it.

`""` is a legal name at the type level and everything falls back to the role label, so
a peer on an older build still reads as `Pamkin`/`Bee` rather than as a blank. The
modal itself does not accept one: it is required, and the button stays disabled until
something is typed. What it does *not* do is gate the session — joining, the camera,
and the clock sync all run behind it, so answering costs no setup time.

Stored in `localStorage`, not `sessionStorage` — a reload mid-shoot must not drop your
name, and a second session should not ask again. (The host claim next door is
deliberately the opposite: per-tab, because two tabs are two seats.) It stays editable
from the create and join screens, which pre-fill it.

---

*(D7 predates D8 and D9; kept at its original number so references stay valid.)*
