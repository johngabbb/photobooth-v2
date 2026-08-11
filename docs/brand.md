# Brand

The logo is the design system. Every colour in the app is sampled from it rather than
chosen alongside it, so the UI and the artwork cannot drift out of tune.

## Assets

All live in `public/brand/`, plus the favicon at `src/app/icon.png` (Next's App Router
picks that filename up automatically).

| File | What it is | Use for |
|---|---|---|
| `photobee.png` | The original supplied artwork, untouched | Archive — regenerate the others from this |
| `photobee-logo.png` | Mark + wordmark, trimmed | Headers, landing page, the full lockup |
| `photobee-mark.png` | Bee-on-pumpkin, square, trimmed | Favicon, compact headers, the card footer stamp |
| `photobee-wordmark.png` | Wordmark alone | Where the mark already appears nearby |
| `src/app/icon.png` | 256px square mark | Browser tab |

Reference them through `BRAND_ASSETS` in `src/lib/brand.ts` rather than typing paths.

### How the derived assets were made

The supplied file is a 1024x1536 product mockup: the artwork sits on a dark grey
backdrop with a soft glow. Most of that backdrop is transparent, but a vignette around
the artwork is not, and it reads as a grey halo on a cream page.

A brightness threshold cannot remove it — the artwork's outline (`#1E1F18`, max
channel 31) and the vignetted backdrop (max channel ~54) are too close, and cutting
between them is fragile. What works is a **flood fill from the image border**: the
artwork is fully enclosed by its own thick linework, so a fill from the edges reaches
every backdrop pixel and stops dead at the outline.

The scripts that did this are one-shot and live in the session scratchpad, not the
repo. If the logo is ever replaced, the method to repeat is:

1. Flood-fill from the border, clearing pixels that are desaturated (saturation < 0.22)
   and neither very dark (max ≤ 45, the linework) nor very light (max ≥ 232, the wings).
2. Zero any residual alpha below 30 — antialiasing against the old backdrop.
3. Trim to the content bounding box.
4. Split the lockup at the widest empty row band to separate mark from wordmark.
5. Downscale in **premultiplied** space for the favicon, or transparent pixels bleed
   dark fringes into the edges.

## Palette

Measured per-region from the artwork, not eyeballed. Definitive copy lives in
`BRAND` (`src/lib/brand.ts`), mirrored as Tailwind tokens in `src/app/globals.css`.

| Token | Hex | Sampled from |
|---|---|---|
| `ink` | `#1E1F18` | The linework — a very dark warm charcoal, not black |
| `pumpkin` | `#FA8730` | Pumpkin body, and the bee's cheeks (identical colour) |
| `honey` | `#FCC44D` | Bee body and stripes |
| `leaf` | `#598718` | The leaf — deeper and more olive than it looks |
| `wing` | `#E0EFEE` | Wings — a cool off-white, distinctly not pure white |

Two surfaces are **derived**, since the logo has no background of its own:

| Token | Hex | Why |
|---|---|---|
| `cream` | `#FFF4E2` | Warm page background; cools the oranges without competing |
| `paper` | `#FFFCF6` | Raised surfaces and card stock |

Card themes in `layouts.ts` are built purely from these, so a printed card and the app
around it use the exact same oranges.

## Typography on cards

Card text is drawn with `fillText`, not CSS, so it needs `CARD_FONT` from
`brand.ts` — a stack of **concrete families only**.

This matters more than it looks. A canvas `font` string does not degrade the way CSS
does: an unresolvable leading entry such as `ui-sans-serif` can drop the whole
declaration to the platform default, which on some renderers is a **serif**. That
happened here — headless renders came out in DejaVu Serif until real families were
named. Browsers on Windows, macOS, and Android were never affected, but the failure is
silent and only visible in the exported file, so keep the stack concrete.

## Naming

The wordmark reads **pamkin photo bee**, and `APP_NAME` matches it. Note this differs
from the "Pamkin and Bee" working title used when the project started — the logo won.
The spelling is *pamkin*, not *pumpkin*.
