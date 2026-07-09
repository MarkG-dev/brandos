# Brand OS

Turn a brand's guidelines into an executable system: a client-facing hub with two agents (Copywriter, Art Director) that generate on-brand output, plus an admin panel to configure brand strategy, voice, art direction, models, and assets.

## Stack

- Static HTML pages under `brand-os/`
- Vercel serverless functions under `api/brand-os/` (9 functions; Vercel Hobby cap is 12)
- Edge middleware (`middleware.js`) gating authenticated routes
- Brand configs committed to `brands/<slug>.json`
- Uploads + usage logs in Vercel Blob

## Routes

- `/` — Brand OS landing (Client / Admin cards)
- `/login` — client login
- `/login?admin=1` — admin login
- `/admin` — brand config studio
- `/<slug>` — client hub (login prefilled with slug if not authed)
- `/<slug>/copywriter`, `/<slug>/art-director` — agent workshops

Middleware resolves `/<slug>` paths — rewrites to `/brand-os/hub.html` (or
`/brand-os/login.html`) internally so the browser URL stays `/loopx`.

## Environment variables

Required:
- `AUTH_SECRET` — HMAC secret for the session cookie
- `BRAND_OS_ADMIN_USER` — admin username
- `BRAND_OS_ADMIN_PASS` — admin password
- `ANTHROPIC_API_KEY` — Copywriter agent (Claude)
- `MAGNIFIC_API_KEY` — Art Director agent (Magnific)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (uploads + usage logs)

Optional:
- `GITHUB_PAT` — commits brand configs to GitHub Contents API (falls back to returning file content for manual commit)
- `GITHUB_REPO` — defaults to `MarkG-dev/brandos`
- `GITHUB_BRANCH` — defaults to `main`

## Layout

```
api/brand-os/          serverless functions
brand-os/              HTML pages, CSS, starfield.js
brands/                <slug>.json brand configs (git-committed)
lib/                   shared auth + usage modules
middleware.js          Edge auth guard
vercel.json            rewrites + function config
```
