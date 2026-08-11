@AGENTS.md

# pamkin photo bee

A web photobooth for two people on **two different devices**. Both cameras stay live
in a shared session, one countdown fires **both shutters at the same instant**, and
each shot becomes a single composed frame containing both people. N shots stack into
a downloadable photocard.

The name is spelled **pamkin**, not "pumpkin", and comes from the logo wordmark. Use
`APP_NAME` from `src/lib/brand.ts` rather than typing it.

Read `docs/plan.md` for the phased build and `docs/architecture.md` for the system
design. `docs/brand.md` covers the logo assets and palette. Decisions with a rationale
live in `docs/decisions.md` — check there before reversing something that looks
arbitrary.

## Stack

Next.js 16.3 (App Router, Turbopack) · React 19.2 · Tailwind CSS v4 · TypeScript.

Three things differ from older setups and cost time if assumed:

- **Next 16 is not the Next.js in your training data.** `AGENTS.md` says so, and it is
  right. Consult `node_modules/next/dist/docs/` before using an API from memory.
- **Tailwind v4 has no `tailwind.config.ts`.** The theme is CSS — see the `@theme`
  block in `src/app/globals.css`. A custom property there becomes a utility
  automatically (`--color-pumpkin` → `bg-pumpkin`, `text-pumpkin`, `ring-pumpkin`).
- **`params` and `searchParams` are Promises** and must be awaited.

## Commands

```bash
npm run dev     # dev server (port 3000, or the next free one)
npm run build   # production build, includes a TypeScript pass
npm run lint    # eslint
npx tsc --noEmit
```

## The one invariant

**`renderCard` in `src/lib/render.ts` is the only thing that draws a card.** The
on-screen preview and the downloaded PNG both call it, differing only in `scale`.
Never add a parallel DOM or CSS implementation of the card for previewing — the
moment two renderers exist, the preview starts lying about the download.

Everything in `render.ts` is pure with respect to a 2D context: no DOM lookups, no
React, no globals. That keeps it testable in Node and reusable on an OffscreenCanvas
if compositing ever moves to a worker.

## Layout

```
src/app/
  page.tsx        / — landing: start or join a session
  join/           /join — room code entry
  room/[code]/    /room/CODE — the two-person room (Phase 2)
  solo/           /solo — single-device booth (Phase 1)
  studio/         /studio — layout + theme harness on synthetic photos (Phase 0)
src/components/   React components — all client-side
  Booth.tsx       capture state machine and scheduler
  Lobby.tsx       the room: presence, code/QR, host-owned settings
  CameraStage.tsx live preview, countdown, flash
  Controls.tsx    shared control primitives — use these, don't re-roll them
src/lib/
  types.ts        domain types; Layout is the declarative card geometry
  brand.ts        palette, app name, font stack, asset paths
  layouts.ts      card formats and themes (data, not logic)
  render.ts       canvas renderer + geometry math — the single source of truth
  camera.ts       getUserMedia with per-failure-mode handling
  capture.ts      video frame -> canvas
  download.ts     render at 300 DPI and save
  session/        room codes, transport interface, presence, useSession
  placeholders.ts synthetic photos for building without a camera
public/brand/     logo assets; src/app/icon.png is the favicon
docs/             plan, architecture, brand, setup, decisions
```

Rooms fall back to `BroadcastChannel` (same browser only) unless
`NEXT_PUBLIC_SUPABASE_URL` and a key are set — see `docs/setup.md`. Both
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (current) and `..._ANON_KEY` (legacy) work.
`NEXT_PUBLIC_USE_LOCAL_TRANSPORT=1` forces the fallback with credentials left in
place — use it to test the local path, which is otherwise unreachable once a project
is configured.

## Conventions

- **Card geometry is data.** Photo counts and formats come from `LAYOUTS`; every
  rectangle is derived by `slotRects` / `halfRects`. Adding a size or a photo count
  should be an entry in `layouts.ts`, never a new branch in the renderer.
- **Nothing server-renders.** Canvas, `document`, and `getUserMedia` are all
  client-only, so both pages mount through `BoothMount` / `CardStudioMount` with
  `ssr: false`. That is deliberate: it lets components read browser APIs during render
  without `typeof window` guards or hydration mismatches. Keep new UI under a mount.
- **Aspect-fit needs an intrinsic size.** To fit a fixed-ratio box into an unknown
  container, use an element with real width/height attributes plus `max-h-full
  max-w-full` (canvas bitmap, or the `<svg>` spacer in `CameraStage`). A plain
  `aspect-ratio` div does not work. See D14.
- **Avoid `setState` inside `useEffect`.** The React 19 lint rules reject it and they
  are usually pointing at a real problem — derive with `useMemo` or a lazy `useState`
  initializer instead.
- **Design pixels are 300 DPI.** A 4x6 card is 1200x1800. `scale` multiplies at export;
  the preview uses a fraction. Never hardcode a pixel size outside `layouts.ts`.
- **The page never scrolls.** `html`/`body` are `overflow-hidden`; new UI must fit the
  viewport or scroll inside its own pane. This depends on `min-h-0` at every flex/grid
  level down to the preview — drop one and the layout silently overflows. See D10.

## Known traps

**Colours exist twice.** As Tailwind tokens in `globals.css` and as plain hex in
`BRAND` (`src/lib/brand.ts`). Unavoidable — a canvas cannot read CSS custom
properties — but a change in one place silently diverges from the other. Change both
together. All values are sampled from the logo artwork; don't invent new ones by eye.

**Canvas fonts are not CSS fonts.** Text drawn with `fillText` must use `CARD_FONT`,
which names concrete families. An unresolvable leading entry like `ui-sans-serif` can
drop the whole declaration to a **serif** on some renderers — a bug that appears only
in the exported file, never in the browser UI. See decisions D9.

**Verify card rendering headlessly.** `renderCard` is pure with respect to its 2D
context, so it runs under `@napi-rs/canvas` in Node — you can render a real card to a
PNG and look at it without a browser. That is how the serif bug above was caught.

**Never depend on the `session` object in an effect.** `useSession` returns a fresh
object every render. Depend on the specific destructured callback instead — and note
that publishing presence causes a render, so getting this wrong is an infinite loop,
not a slow render. See D17.

**Aspect-fitting the camera stage is measured, not CSS.** `useFitBox` uses a
ResizeObserver because CSS genuinely cannot express it — an `<svg>` spacer looks like
the canvas trick but its width/height are presentation attributes that become CSS, so
`max-width` breaks the ratio. This shipped broken once. See D14.

**Drive the booth with a fake camera.** Chromium's
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` provide a
synthetic webcam and auto-grant permission, so the whole capture flow — countdown,
captures, composite, download — is testable end to end without hardware.
