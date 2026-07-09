// Brand OS — usage & cost tracking.
//
// Storage: Vercel Blob, one JSON rollup per brand per month.
//   Path: usage/<slug>/<yyyy-mm>.json
//   Shape:
//     {
//       slug, month,
//       copywriter: { calls, inputTokens, outputTokens, costUsd },
//       artDirector: { calls, costUsd },
//       events: [
//         { ts, type: "copywriter" | "artDirector", model,
//           inputTokens?, outputTokens?, aspect?, costUsd }
//       ],
//       totalCostUsd
//     }
//
// Read-modify-write via the Blob REST API. Under heavy concurrency an event
// can be dropped; acceptable for v1 traffic.

import { put, list, head } from '@vercel/blob';

// Claude pricing (USD per 1M tokens).
// Cross-checked against the claude-api skill catalogue. If Anthropic
// changes pricing, update this table.
const CLAUDE_PRICES = {
  'claude-fable-5':            { in: 10, out: 50 },
  'claude-mythos-5':           { in: 10, out: 50 },
  'claude-opus-4-8':           { in: 5,  out: 25 },
  'claude-opus-4-7':           { in: 5,  out: 25 },
  'claude-opus-4-6':           { in: 5,  out: 25 },
  'claude-sonnet-5':           { in: 3,  out: 15 },
  'claude-sonnet-4-6':         { in: 3,  out: 15 },
  'claude-haiku-4-5-20251001': { in: 1,  out: 5 },
  'claude-haiku-4-5':          { in: 1,  out: 5 },
};

// Magnific Mystic — rough estimate. Credit consumption varies by plan
// (roughly $0.01–$0.03/credit); this is a mid-range estimate.
const MAGNIFIC_CREDIT_USD = 0.02;
const MAGNIFIC_CREDITS_PER_IMAGE = {
  realism:  12,
  zen:      10,
  flexible: 14,
  fluid:    18,
};

export function computeCopywriterCost(model, inputTokens, outputTokens) {
  const p = CLAUDE_PRICES[model] || CLAUDE_PRICES['claude-opus-4-8'];
  const inCost  = (inputTokens  / 1_000_000) * p.in;
  const outCost = (outputTokens / 1_000_000) * p.out;
  return round4(inCost + outCost);
}

export function estimateArtDirectorCost(model) {
  const credits = MAGNIFIC_CREDITS_PER_IMAGE[model] || 12;
  return round4(credits * MAGNIFIC_CREDIT_USD);
}

function round4(n) { return Math.round(n * 10000) / 10000; }

function monthKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function rollupPath(slug, month) {
  return `usage/${slug}/${month}.json`;
}

function emptyRollup(slug, month) {
  return {
    slug, month,
    copywriter:  { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    artDirector: { calls: 0, costUsd: 0 },
    events: [],
    totalCostUsd: 0,
  };
}

async function fetchExisting(slug, month) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    // list at prefix and find the exact path to get its public URL.
    const l = await list({ prefix: `usage/${slug}/`, limit: 100 });
    const target = l.blobs.find(b => b.pathname === rollupPath(slug, month));
    if (!target) return null;
    const r = await fetch(target.url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function logEvent(slug, event) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return; // silently skip if Blob isn't set up
  if (!slug || !event) return;

  const month = monthKey();
  const existing = (await fetchExisting(slug, month)) || emptyRollup(slug, month);

  // Trim events list to the most recent 200 to bound file size.
  const trimmedEvents = [event, ...existing.events].slice(0, 200);

  const rollup = {
    ...existing,
    slug,
    month,
    events: trimmedEvents,
  };

  if (event.type === 'copywriter') {
    rollup.copywriter = {
      calls:        (existing.copywriter?.calls || 0) + 1,
      inputTokens:  (existing.copywriter?.inputTokens || 0) + (event.inputTokens || 0),
      outputTokens: (existing.copywriter?.outputTokens || 0) + (event.outputTokens || 0),
      costUsd:      round4((existing.copywriter?.costUsd || 0) + (event.costUsd || 0)),
    };
  } else if (event.type === 'artDirector') {
    rollup.artDirector = {
      calls:   (existing.artDirector?.calls || 0) + 1,
      costUsd: round4((existing.artDirector?.costUsd || 0) + (event.costUsd || 0)),
    };
  }
  rollup.totalCostUsd = round4(
    (rollup.copywriter?.costUsd || 0) + (rollup.artDirector?.costUsd || 0)
  );

  try {
    await put(rollupPath(slug, month), JSON.stringify(rollup), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (e) {
    console.error('brand-os usage write failed:', e.message);
  }
}

export async function readUsage(slug, monthsBack = 6) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(monthKey(d));
  }
  const results = await Promise.all(
    months.map(m => fetchExisting(slug, m).then(r => r || emptyRollup(slug, m)))
  );
  const total = results.reduce((sum, r) => sum + (r.totalCostUsd || 0), 0);
  return {
    slug,
    months: results,
    totalCostUsd: round4(total),
    pricing: {
      claude: CLAUDE_PRICES,
      magnificCreditUsd: MAGNIFIC_CREDIT_USD,
      magnificCreditsPerImage: MAGNIFIC_CREDITS_PER_IMAGE,
    },
  };
}
