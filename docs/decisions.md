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

*(D7 predates D8 and D9; kept at its original number so references stay valid.)*
