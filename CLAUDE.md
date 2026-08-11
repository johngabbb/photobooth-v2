@AGENTS.md

# Pamkin and Bee

A web photobooth for two people on **two different devices**. Both cameras stay live
in a shared session, one countdown fires **both shutters at the same instant**, and
each shot becomes a single composed frame containing both people. N shots stack into
a downloadable photocard.

Read `docs/plan.md` for the phased build and `docs/architecture.md` for the system
design. Decisions with a rationale live in `docs/decisions.md` — check there before
reversing something that looks arbitrary.

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
src/app/          routes (App Router)
src/components/   React components — all client-side
src/lib/
  types.ts        domain types; Layout is the declarative card geometry
  layouts.ts      card formats and themes (data, not logic)
  render.ts       canvas renderer + geometry math — the single source of truth
  placeholders.ts synthetic photos for building without a camera
docs/             plan, architecture, decisions
```

## Conventions

- **Card geometry is data.** Photo counts and formats come from `LAYOUTS`; every
  rectangle is derived by `slotRects` / `halfRects`. Adding a size or a photo count
  should be an entry in `layouts.ts`, never a new branch in the renderer.
- **The booth does not server-render.** Canvas, `document`, and `getUserMedia` are all
  client-only, so the studio mounts through `CardStudioMount` with `ssr: false`. That
  is deliberate: it lets components read browser APIs during render without
  `typeof window` guards or hydration mismatches. Keep new booth UI under that mount.
- **Avoid `setState` inside `useEffect`.** The React 19 lint rules reject it and they
  are usually pointing at a real problem — derive with `useMemo` or a lazy `useState`
  initializer instead.
- **Design pixels are 300 DPI.** A 4x6 card is 1200x1800. `scale` multiplies at export;
  the preview uses a fraction. Never hardcode a pixel size outside `layouts.ts`.

## Known trap

Card colours exist **twice**: as Tailwind tokens in `globals.css` and as plain hex in
the `THEMES` array in `layouts.ts`. This is unavoidable — a canvas cannot read CSS
custom properties — but it means a colour change in one place silently diverges from
the other. Change both together.
