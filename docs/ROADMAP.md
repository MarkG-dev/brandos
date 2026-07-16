# Brand OS — Roadmap

The board. Updated as things ship. Context: agency-owned product — Spacecadet
configures, clients consume. Target price point $500–2000/mo per brand.

## Shipped (v1 — Loop X pilot)

- Copywriter agent (Claude) — brand voice + strategy locked, Write/Rewrite
  modes, word-count pills, brand-driven presets
- Art Director agent (Magnific Mystic) — brand art direction locked,
  style/structure refs, shot presets, two render styles (photographic +
  CAD-style line drawing)
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

### 1. HTML asset generation ("Design" agent — 4th tile)
- Landing pages, one-page proposals, social carousel HTML, email templates,
  deck slides — rendered against the brand's design system
- Primed by the Agent Guidelines ZIP (design-system format)
- Outputs land in the Library like everything else
- NOTE: serverless functions at 12/12 (Vercel Hobby cap) — retire
  github-check.js or consolidate an endpoint before adding the next function

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
