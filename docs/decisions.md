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

**Status:** decided

One writer for room settings and countdown timing. The guest mirrors state and may
only signal readiness or request a retake.

Two writers would mean reconciling concurrent edits to photo count or a double-started
countdown — real distributed-systems work, in exchange for flexibility nobody asked
for. If the guest needs to change a setting, they can ask out loud; they are on a
video call with the host by definition.

---

## D7 — Colours are duplicated between CSS and TypeScript

**Status:** accepted wart

Card colours live in `THEMES` (`layouts.ts`) as hex **and** in the `@theme` block in
`globals.css` as Tailwind tokens. A canvas cannot read CSS custom properties, so one
source of truth is not available without reading computed styles at render time —
which would make the renderer DOM-dependent and break D2's portability.

Mitigation is a comment in both files. If it starts biting, the fix is to generate the
CSS block from the TypeScript at build time, not to make the renderer read the DOM.
