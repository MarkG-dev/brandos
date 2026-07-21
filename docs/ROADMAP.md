# Brand OS — Roadmap

The board. Updated as things ship. Context: agency-owned product — Spacecadet
configures, clients consume. Target price point $500–2000/mo per brand.

## Shipped (v1 — Loop X pilot)

- Copywriter agent (Claude) — brand voice + strategy locked, Write/Rewrite
  modes, word-count pills, brand-driven presets
- Art Director agent (Magnific Mystic) — brand art direction locked, one
  reference-image field, shot presets, brand-driven style label, and a
  per-brand reference kit (one-click brand images, e.g. Cenotian watercolors)
- Client hub with asset kit (PDF guidelines, Agent Guidelines ZIP, library URL)
- Clean URLs: `/<slug>`, `/<slug>/copywriter`, `/<slug>/art-director`,
  `/<slug>/library` — password gate keeps URL stable
- Output persistence — every generation saved to Blob with metadata; images
  re-hosted (Magnific URLs expire, ours don't)
- Library page — filterable grid of everything generated
- Admin studio: config, assets, preset editor, compiled-prompt preview,
  per-brand usage + cost rollups, GitHub diagnostic
- Brand configs in git (versioned); saves preserve fields the UI doesn't send
- Copywriter Write/Rewrite modes; brand-driven preset pills
- **Studio-managed users** — Users tab in admin: add/remove/disable/reset,
  stored on the brand JSON (no external DB, no env vars). Clients sign in
  with email + personal password at the brand URL; shared team password
  still works alongside. Outputs attributed by name in the Library.

## Next up (in order)

### 1. Designer agent — 4th tile (tile shipped as "Coming soon")
The hub tile is already live, grayed out. Build order below.

**Approach: generate our own, don't API into Claude Design.** Claude generates
HTML/SVG against the brand's design system; we render it server-side with the
pre-installed headless Chromium; the client downloads in a chosen format. Same
shape as Copywriter (Claude→text) and Art Director (Magnific→image). Keeps the
brand lock and Library persistence — an external Design API would break both.

**Fed by (most-specific first):** the Agent Guidelines ZIP (already shipped in
the hub — this is its payoff: tokens/colors.css, spacing, type, voice) → brand
config (palette, voice, logo.svg, strategy) → PDF guidelines (reference only).

**Killer feature — pick your file format.** One HTML/SVG generation exports to
several formats via headless Chromium (HTML→PNG/JPG at any dimension) and
SVG→PNG:
  - Social assets / banners (LinkedIn 1200×627, Twitter 1600×900, IG 1080×1080)
    → PNG/JPG. *Build this first — cleanest fit, highest value.*
  - Icons (SVG → svg/png) — overlaps the Art Director line-drawing mode; prototype.
  - LinkedIn post content — arguably already a Copywriter preset; Designer could
    compose copy + a generated banner into one download.
  - Full layouts (one-pagers, decks) — highest complexity, defer.
Ship as format-preset pills (locked dimensions + tuned prompt), like the
shot/task presets. Outputs land in the Library with a format picker on download.

**Serverless-slot plan (blocks the build).** At 12/12 on Vercel Hobby, a
Designer render endpoint needs a slot first:
  1. Retire `github-check.js` (admin diagnostic) — fold into save-brand as a
     `?check=1` mode, or drop it. Frees 1 slot → Designer fits, no plan change.
     *This is the unblock step.*
  2. Alt: merge `outputs.js` + `usage.js` into one `library.js` (`?view=`).
  3. Budget Vercel Pro (~$20/mo) for when render volume is real — Pro raises the
     maxDuration ceiling, which the HTML→PNG render step wants (Art Director
     already rides at maxDuration 60). Noise at $500–2k/mo per brand.

### 2. Brand chatbot ("Ask" agent)
- "What's our tagline?", "Can I say X?", "What's our position on Y?"
- Needs a messages[] endpoint (copywriter is one-shot today)

### Deferred: self-serve account creation
Client invites their own team — needs email verification, password reset,
abuse handling: a real auth system. Revisit when ≥3 brands are live.
(Decision 2026-07: studio-managed accounts give 80% of the value at 20%
of the surface. Supabase is the likely backend when this lands.)

## Later (v3 — don't scope-creep these in)

- Batch generation (4 hero shots at once, pick winner)
- Feedback loop (client rates outputs → prompt refinement)
- Slack integration (prompt in channel, branded reply)
- Brand health dashboard (usage over time, re-engagement signals)
- Rate limiting / spend caps per brand
- Supabase migration (users, outputs index, feedback)

## Known limits (priced into client conversations)

- Single admin account (env-var credentials)
- One image model per brand (no A/B against Ideogram/Midjourney)
- Magnific cost estimates are approximate (plan-tier dependent)
- Usage rollup is last-write-wins under heavy concurrency
