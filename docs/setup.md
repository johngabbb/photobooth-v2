# Setup

## Running locally

```bash
npm install
npm run dev
```

| Route | What it is |
|---|---|
| `/` | Landing — start or join a session |
| `/join` | Enter a room code |
| `/room/[code]` | The two-person room |
| `/solo` | Single-device booth (Phase 1) |
| `/studio` | Layout and theme harness on synthetic photos (Phase 0) |

## The session transport

Rooms need a realtime channel, and there are two implementations behind one
interface (`src/lib/session/types.ts`). Which one runs is decided by whether Supabase
credentials are present — nothing else changes.

| | Reaches | When it is used |
|---|---|---|
| `LocalTransport` | Other tabs in the same browser profile | No credentials configured |
| `SupabaseTransport` | Any device, anywhere | `NEXT_PUBLIC_SUPABASE_URL` + a key set |

**The local transport is a development convenience, not a fallback that "sort of
works".** `BroadcastChannel` cannot reach a second device, a second browser, or even
a private window. Two people on two phones need Supabase. The room shows a banner
whenever it is running in same-browser mode so this is never ambiguous.

It exists so the whole session flow — codes, joining, presence, role assignment,
settings sync — can be developed and tested with two tabs, without provisioning
anything.

## Enabling cross-device sessions

1. Create a project at [supabase.com](https://supabase.com). The free tier is enough:
   this uses Realtime only — no database tables, no storage, no auth. (Creating a
   project provisions a Postgres instance and asks for a password. We never connect
   to it; generate one and forget it.)
2. Grab two values. The **Connect** button at the top of the project dashboard shows
   both together and is the quickest route; otherwise **Settings → API Keys**.

   - **Project URL** — `https://<project-ref>.supabase.co`. If the dashboard has been
     reorganised again, the ref is in the dashboard's own address bar:
     `supabase.com/dashboard/project/<project-ref>`.
   - **Publishable key** — looks like `sb_publishable_…`.

   Supabase now issues *publishable* keys alongside the older *anon* keys (long JWTs
   beginning `eyJ…`, under a separate **Legacy API Keys** tab). Both work and
   `supabase-js` accepts either, but legacy anon keys are due for deprecation at the
   end of 2026 — prefer the publishable one.

   Never use a `service_role` or secret key here. Both variables below are
   `NEXT_PUBLIC_` and are shipped to the browser.
3. Create `.env.local` in the repo root:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklm.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxx
   ```

   `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted too, for a legacy `eyJ…` anon key.
   The app checks the publishable name first and falls back, so the snippet
   Supabase's Connect dialog gives you can be pasted as-is.

   Leave both **empty** until you have real values. Empty is falsy, so the app falls
   back to the local transport and keeps working; a non-empty placeholder is truthy
   and would send it off to open a socket to a host that does not exist.

4. Restart `npm run dev` — env vars are read at startup only. The same-browser banner
   disappearing is how you know it connected.

Both variables are `NEXT_PUBLIC_` and therefore shipped to the browser. That is
correct for a publishable/anon key, which is designed to be public — but it means
Realtime is reachable anonymously, so do not put anything sensitive on these
channels. Rooms carry presence and settings only.

## Turning Supabase off again

Add this to `.env.local` and restart:

```bash
NEXT_PUBLIC_USE_LOCAL_TRANSPORT=1
```

Rooms go back to `BroadcastChannel` and **no connection to Supabase is opened at
all** — verified by watching the page's websockets: with the flag set, the only one
is Next's own HMR socket. Nothing counts against the Realtime quota.

Delete the line (or set it to anything other than `1`) and restart to switch back.

Preferred over blanking the credentials, for two reasons: the keys stay where they
are, and "deliberately off" stays distinguishable from "never configured". It is also
the only way to exercise the fallback path once real credentials exist — otherwise
that code becomes untestable the moment the project is provisioned.

> **Verified against a live project.** Two isolated browser contexts — which share no
> storage and no `BroadcastChannel`, so nothing can sync between them except over the
> network — joined the same room, saw each other's presence and camera state, and
> received host settings by broadcast in ~130-150 ms. A late joiner picked up current
> settings, and peers dropped from the roster on leaving.

## Deploying to Vercel

A stock Next.js build — no custom server, no build configuration.

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new).
2. **Settings → Environment Variables**: add `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for **Production and Preview**. `.env.local`
   is git-ignored, so nothing carries over from your machine — miss this and rooms
   silently degrade to same-browser mode on the deployed site.
3. Do **not** set `NEXT_PUBLIC_USE_LOCAL_TRANSPORT` in Vercel. It would pin every room
   to the local transport, which is the one thing a deployment exists to avoid.

HTTPS is automatic, which is what makes the camera work on phones. Preview
deployments get their own URLs, so a branch can be tested on two devices without
touching production.

Sanity check after deploying: open a room and confirm the yellow "Same-browser mode"
banner is absent. If it is there, the environment variables did not reach the build —
re-deploy after adding them, since they are inlined at build time rather than read at
runtime.

### How the deploy loop behaves

Pushing to `main` builds and, if the build succeeds, replaces production. Any other
branch produces a preview deployment on its own URL. Deployments are immutable —
production is whichever one is currently promoted, so rollback re-points the domain
rather than rebuilding. A failed build leaves the previous deployment serving.

Two traps, both of which fail silently rather than loudly:

- **`NEXT_PUBLIC_*` values are compiled into the bundle, not read at runtime.**
  Changing them in the dashboard does nothing to the running site until you redeploy.
  The symptom is the same-browser banner persisting after you have "definitely set"
  the variables — the build simply predates them.
- **Deployment Protection can gate preview URLs behind a Vercel login.** Fine on your
  laptop, fatal for testing on two phones: the other person's device is not signed
  into your account and will hit an auth wall. Check **Settings → Deployment
  Protection** before a two-device session.

Use a branch and its preview URL for Phase 3 work, so production stays stable while
synchronised capture is being shaken out on real devices.

## Cross-device testing

`getUserMedia` requires a secure context. `localhost` counts, but your phone cannot
reach your laptop's localhost, so testing with two devices needs a real https URL:

- a tunnel (`ngrok http 3000`, `cloudflared tunnel --url http://localhost:3000`), or
- a Vercel preview deployment, with the two env vars set in the project settings.

Plain http over a LAN address will not work — the camera API simply is not there.

## Verification scripts

Chromium's `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` give a
synthetic webcam and auto-granted permission, so the capture and session flows are
testable end to end without hardware or a second person. The suites used during
development are not committed; see `docs/decisions.md` for what they covered.
