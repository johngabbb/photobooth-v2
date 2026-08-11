# Docs

| Document | What's in it |
|---|---|
| [plan.md](./plan.md) | What we're building and the phased path to it. Start here. |
| [architecture.md](./architecture.md) | System design — realtime transport, shutter synchronisation, frame handoff, session model. |
| [decisions.md](./decisions.md) | Choices that look arbitrary from the code, with reasoning. Read before reversing one. |

Project-level conventions and traps for contributors (human or agent) live in
[`../CLAUDE.md`](../CLAUDE.md).

## Where things stand

**Phase 0 is complete.** The card renderer, layout system, design tokens, and PNG
export all work against synthetic placeholder photos — six layouts (solo and duo ×
2/3/4 photos), four themes, mirroring, and a 300 DPI export.

No camera and no networking yet. That is deliberate: Phase 0 exists to get the
geometry and export pipeline right while they are still cheap to change.

```bash
npm run dev   # then open the studio at the printed URL
```

**Next up: Phase 1** — the solo booth, end to end on one device. Camera permission,
live preview, countdown, N captures, composite, download. It is a complete photobooth
on its own and it proves the capture path before any distributed-systems work lands.
