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

**Phases 0, 1 and 2 are complete.**

- `/` starts or joins a session. `/room/[code]` is the two-person room: a code and QR
  to share, a live roster showing who is present and whose camera is on, and settings
  the host owns and the guest receives.
- `/solo` is the full single-device booth — countdown, captures, 300 DPI PNG, retake.
- `/studio` is the layout and theme harness on synthetic photos.

```bash
npm run dev
```

**Rooms need Supabase credentials to reach a second device.** Without them the channel
is `BroadcastChannel`, which reaches other tabs in the same browser and nothing else;
the room says so in a banner. See [setup.md](./setup.md).

**Next up: Phase 2.5, deploy to Vercel** — not a victory lap but test infrastructure:
Phase 3 needs two real devices, which needs HTTPS. See [setup.md](./setup.md).

**Then Phase 3** — synchronised capture. Clock-offset estimation, a broadcast
`captureAt`, both shutters firing together, frame exchange, and the dual composite.
This is the milestone where the product actually arrives.
