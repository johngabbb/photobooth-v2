# Docs

| Document | What's in it |
|---|---|
| [plan.md](./plan.md) | What we're building and the phased path to it. Start here. |
| [architecture.md](./architecture.md) | System design — realtime transport, shutter synchronisation, frame handoff, session model. |
| [brand.md](./brand.md) | Logo assets, the sampled palette, and card typography. |
| [setup.md](./setup.md) | Running it, and enabling cross-device sessions with Supabase. |
| [decisions.md](./decisions.md) | Choices that look arbitrary from the code, with reasoning. Read before reversing one. |

Project-level conventions and traps for contributors (human or agent) live in
[`../CLAUDE.md`](../CLAUDE.md).

## Where things stand

**Phases 0 through 3 are complete — the product works.**

- `/` starts or joins a session. `/room/[code]` is the two-person booth: share a code
  or QR, both cameras go live, and **one countdown fires both shutters at the same
  instant**. Every frame ends up holding both of you, and each device composites the
  same card locally so you both download your own copy.
- `/solo` is the full single-device booth — countdown, captures, 300 DPI PNG, retake.
- `/studio` is the layout and theme harness on synthetic photos.

```bash
npm run dev
```

**Rooms need Supabase credentials to reach a second device.** Without them the channel
is `BroadcastChannel`, which reaches other tabs in the same browser and nothing else;
the room says so in a banner. See [setup.md](./setup.md).

**Phase 2.5 is complete**: deployed on Vercel, Supabase configured for Production and
Preview, and a room verified working between two real devices. See
[setup.md](./setup.md) for the deploy loop and its two silent-failure traps.

**Next up: Phase 4** — live peer preview over WebRTC, so you can see each other while
posing instead of composing blind. The signalling channel already exists; the product
works without it, which is why it comes after Phase 3.
