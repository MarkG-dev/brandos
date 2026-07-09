// Brand OS — Art Director API.
//
// POST /api/brand-os/art-director
//   Body: { slug, prompt, presetLabel? }
//   → { imageUrl, taskId }
//
// Uses Magnific Mystic (text-to-image) with brand-locked art direction
// merged into the server-side prompt. Client-supplied model / references
// are ignored.
//
// Magnific HTTP API:
//   POST  https://api.magnific.com/v1/ai/mystic     → { data: { task_id } }
//   GET   https://api.magnific.com/v1/ai/mystic/:id → { data: { task_id, status, generated: [url] } }
//   Auth: header  x-magnific-api-key: <MAGNIFIC_API_KEY>

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verify, readCookie } from '../../lib/brand-os-auth.js';
import { logEvent, estimateArtDirectorCost } from '../../lib/brand-os-usage.js';

export const config = { maxDuration: 60 };

const MAG_BASE = 'https://api.magnific.com/v1';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 55000;

// Loose CSS-aspect-to-Magnific aspect-ratio mapping.
const ASPECT_MAP = {
  '1:1':  'square_1_1',
  '3:2':  'traditional_3_2',
  '2:3':  'portrait_2_3',
  '4:3':  'traditional_4_3',
  '3:4':  'traditional_3_4',
  '16:9': 'widescreen_16_9',
  '9:16': 'social_story_9_16',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(500).json({ error: 'AUTH_SECRET not configured' });

  const cookieHeader = req.headers.cookie || '';
  const payload = await verify(readCookie(cookieHeader), secret);
  if (!payload) return res.status(401).json({ error: 'Not signed in' });

  const magKey = process.env.MAGNIFIC_API_KEY;
  if (!magKey) return res.status(500).json({ error: 'MAGNIFIC_API_KEY not configured' });

  const { slug, prompt, presetLabel, styleReferenceUrl, structureReferenceUrl, modelOverride } = req.body || {};
  if (!slug || !prompt) return res.status(400).json({ error: 'slug and prompt required' });
  if (payload.role !== 'admin' && payload.slug !== slug) {
    return res.status(403).json({ error: 'Session does not match slug' });
  }

  let brand;
  try {
    brand = JSON.parse(await readFile(join(process.cwd(), 'brands', `${slug}.json`), 'utf8'));
  } catch {
    return res.status(404).json({ error: `Brand ${slug} not found` });
  }

  const preset = (brand.presets?.artDirector || []).find(p => p.label === presetLabel)
    || brand.presets?.artDirector?.[0]
    || {};

  const merged = buildPrompt(brand, prompt, preset);
  const aspect = ASPECT_MAP[preset.aspect] || 'square_1_1';
  // Admins can override the brand's default model per-call; clients cannot.
  const model = (payload.role === 'admin' && modelOverride)
    ? modelOverride
    : (brand.model?.artDirector || 'realism');

  try {
    // 1. Submit.
    const submitBody = {
      prompt: merged,
      aspect_ratio: aspect,
      resolution: '2k',
      model,
      engine: 'automatic',
      creative_detailing: 33,
      adherence: 50,
      hdr: 20,
    };
    if (styleReferenceUrl) submitBody.style_reference = styleReferenceUrl;
    if (structureReferenceUrl) submitBody.structure_reference = structureReferenceUrl;

    const submitRes = await fetch(`${MAG_BASE}/ai/mystic`, {
      method: 'POST',
      headers: {
        'x-magnific-api-key': magKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(submitBody),
    });
    const submitData = await submitRes.json().catch(() => ({}));
    if (!submitRes.ok) {
      return res.status(submitRes.status).json({
        error: submitData.message || submitData.error || `Magnific submit failed (${submitRes.status})`,
        raw: submitData,
      });
    }
    const taskId = submitData.data?.task_id || submitData.task_id;
    if (!taskId) return res.status(500).json({ error: 'No task_id from Magnific', raw: submitData });

    // 2. Poll.
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const statusRes = await fetch(`${MAG_BASE}/ai/mystic/${taskId}`, {
        headers: { 'x-magnific-api-key': magKey },
      });
      const statusData = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) {
        return res.status(statusRes.status).json({
          error: statusData.message || 'Magnific status failed',
          raw: statusData,
        });
      }
      const inner = statusData.data || statusData;
      const state = (inner.status || '').toUpperCase();
      if (state === 'COMPLETED' || state === 'SUCCESS' || state === 'DONE') {
        const generated = inner.generated || inner.output || [];
        const imageUrl = Array.isArray(generated) ? generated[0] : generated;

        const costUsd = estimateArtDirectorCost(model);
        logEvent(slug, {
          ts: new Date().toISOString(),
          type: 'artDirector',
          model,
          aspect,
          preset: presetLabel || null,
          costUsd,
        }).catch(e => console.error('usage log failed:', e.message));

        return res.status(200).json({ imageUrl, taskId, usage: { costUsd } });
      }
      if (state === 'FAILED' || state === 'ERROR') {
        return res.status(500).json({ error: 'Magnific job failed', raw: inner });
      }
    }

    return res.status(504).json({ error: 'Magnific job timed out', taskId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function buildPrompt(brand, userPrompt, preset) {
  const palette = (brand.art?.palette || [])
    .map(p => `${p.name} ${p.hex}`)
    .join(', ');
  const photography = brand.art?.photography || '';
  const framing = brand.art?.framing || '';
  const grade = brand.art?.grade || '';
  const hint = preset.hint || '';

  return [
    userPrompt.trim(),
    hint,
    photography && `Photography: ${photography}.`,
    framing && `Framing: ${framing}.`,
    grade && `Grade: ${grade}.`,
    palette && `Palette: ${palette}.`,
  ].filter(Boolean).join(' ');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
