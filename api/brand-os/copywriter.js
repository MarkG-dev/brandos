// Brand OS — Copywriter API.
//
// POST /api/brand-os/copywriter
//   Body: { slug, task, source, presetLabel? }
//   → { output }
//
// The system prompt is built server-side from the brand's voice guidelines.
// Client-supplied system fields are ignored entirely.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verify, readCookie } from '../../lib/brand-os-auth.js';
import { logEvent, computeCopywriterCost } from '../../lib/brand-os-usage.js';
import { saveCopyOutput } from '../../lib/brand-os-outputs.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(500).json({ error: 'AUTH_SECRET not configured' });

  const cookieHeader = req.headers.cookie || '';
  const payload = await verify(readCookie(cookieHeader), secret);
  if (!payload) return res.status(401).json({ error: 'Not signed in' });

  const { slug, task, source, presetLabel, wordCount, mode } = req.body || {};
  if (!slug || !source) return res.status(400).json({ error: 'slug and source required' });
  const writeMode = mode === 'write'; // default is rewrite
  if (payload.role !== 'admin' && payload.slug !== slug) {
    return res.status(403).json({ error: 'Session does not match slug' });
  }

  const anthKey = process.env.ANTHROPIC_API_KEY;
  if (!anthKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  let brand;
  try {
    brand = JSON.parse(await readFile(join(process.cwd(), 'brands', `${slug}.json`), 'utf8'));
  } catch {
    return res.status(404).json({ error: `Brand ${slug} not found` });
  }

  const preset = (brand.presets?.copywriter || []).find(p => p.label === presetLabel);
  let taskInstruction = preset?.prompt || task
    || (writeMode ? 'Write new copy in the brand voice.' : 'Rewrite in brand voice.');

  // Word-count constraint (15 / 50 / 100 boilerplates or arbitrary integer).
  const wc = parseInt(wordCount, 10);
  if (Number.isFinite(wc) && wc >= 5 && wc <= 500) {
    taskInstruction += ` The result MUST be no more than ${wc} words. Count carefully. Prefer the exact target length, ±2 words.`;
  }

  const system = buildSystemPrompt(brand, taskInstruction, writeMode);
  const model = brand.model?.copywriter || 'claude-opus-4-8';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: source }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Anthropic error' });
    const output = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const costUsd = computeCopywriterCost(model, inputTokens, outputTokens);

    // Fire-and-forget: don't block the response on Blob write.
    logEvent(slug, {
      ts: new Date().toISOString(),
      type: 'copywriter',
      model,
      preset: presetLabel || null,
      wordCount: Number.isFinite(wc) && wc >= 5 && wc <= 500 ? wc : null,
      inputTokens,
      outputTokens,
      costUsd,
    }).catch(e => console.error('usage log failed:', e.message));

    // Persist to the brand's output library. Await so the write survives
    // the function teardown — it's one small JSON put.
    try {
      await saveCopyOutput(slug, {
        source,
        text: output,
        mode: writeMode ? 'write' : 'rewrite',
        preset: presetLabel || null,
        wordCount: Number.isFinite(wc) && wc >= 5 && wc <= 500 ? wc : null,
        model,
        author: payload.user?.name || (payload.slug === '__admin__' ? 'admin' : payload.slug),
      });
    } catch (e) {
      console.error('output save failed:', e.message);
    }

    return res.status(200).json({ output, usage: { inputTokens, outputTokens, costUsd } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function buildSystemPrompt(brand, taskInstruction, writeMode = false) {
  const examples = (brand.voice?.examples || []).map(e => `- ${e}`).join('\n') || '(none provided)';
  const doNotUse = (brand.voice?.doNotUse || []).map(d => `- ${d}`).join('\n') || '(none)';
  const strategy = brand.strategy || {};
  const products = (strategy.products || []).map(p => `- ${p}`).join('\n');

  const strategyBlock = [
    strategy.positioning && `Positioning:\n${strategy.positioning}`,
    strategy.audience && `Audience:\n${strategy.audience}`,
    products && `Products:\n${products}`,
    strategy.belief && `Core belief:\n${strategy.belief}`,
    strategy.manifesto && `Manifesto (reference for tone, vocabulary, and beliefs — draw on it, don't quote it verbatim unless asked):\n${strategy.manifesto}`,
  ].filter(Boolean).join('\n\n');

  const inputFraming = writeMode
    ? 'The user message is a BRIEF describing what to write. Write new copy that fulfils it — do not restate or rewrite the brief itself.'
    : 'The user message is DRAFT TEXT. Transform it per the task.';

  return `You are the ${brand.name} copywriter.

Task: ${taskInstruction}
${inputFraming}
${strategyBlock ? `\nStrategy — what the brand is:\n${strategyBlock}\n` : ''}
Voice guidelines:
${brand.voice?.guidelines || '(unspecified — default to the brand tone examples below)'}

Voice examples (write in this register):
${examples}

Do NOT use:
${doNotUse}

Return ONLY the ${writeMode ? 'copy' : 'rewritten text'}. No preface, no explanation, no quote marks around it.`;
}
