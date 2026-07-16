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
import { saveImageOutput } from '../../lib/brand-os-outputs.js';

export const config = { maxDuration: 60 };

const MAG_BASE = 'https://api.magnific.com/v1';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 55000;

// CSS-aspect-to-Magnific enum. Valid Mystic values (per Freepik API docs):
// square_1_1, classic_4_3, traditional_3_4, widescreen_16_9,
// social_story_9_16, portrait_2_3, standard_3_2, horizontal_2_1,
// vertical_1_2, social_post_4_5.
const ASPECT_MAP = {
  '1:1':  'square_1_1',
  '3:2':  'standard_3_2',
  '2:3':  'portrait_2_3',
  '4:3':  'classic_4_3',
  '3:4':  'traditional_3_4',
  '16:9': 'widescreen_16_9',
  '9:16': 'social_story_9_16',
  '2:1':  'horizontal_2_1',
  '1:2':  'vertical_1_2',
  '4:5':  'social_post_4_5',
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
  // Render style: 'photo' (default, brand-driven photography) or 'line'
  // (CAD-style white linework on black — a separate, brand-agnostic prompt).
  const renderStyle = (req.body?.renderStyle === 'line') ? 'line' : 'photo';
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

  const merged = renderStyle === 'line'
    ? buildLinePrompt(prompt)
    : buildPrompt(brand, prompt, preset);
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
      // Surface validation detail (e.g. bad aspect_ratio enum) so the
      // client sees WHY, not just "failed".
      const detail = [submitData.message, submitData.error]
        .concat((submitData.invalid_params || []).map(p => `${p.name}: ${p.reason || ''}`))
        .filter(Boolean).join(' — ');
      return res.status(submitRes.status).json({
        error: detail || `Magnific submit failed (${submitRes.status})`,
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
        const magnificUrl = Array.isArray(generated) ? generated[0] : generated;

        const costUsd = estimateArtDirectorCost(model);
        logEvent(slug, {
          ts: new Date().toISOString(),
          type: 'artDirector',
          model,
          aspect,
          preset: presetLabel || null,
          renderStyle,
          costUsd,
        }).catch(e => console.error('usage log failed:', e.message));

        // Persist to the brand's output library. Re-host the bytes into
        // Blob only if we still have headroom inside maxDuration.
        const elapsed = Date.now() - start;
        let record = null;
        try {
          record = await saveImageOutput(slug, {
            prompt,
            preset: presetLabel || null,
            renderStyle,
            model,
            aspect: preset.aspect || '1:1',
            author: payload.user?.name || (payload.slug === '__admin__' ? 'admin' : payload.slug),
            sourceUrl: magnificUrl,
          }, { rehost: elapsed < 40000 });
        } catch (e) {
          console.error('output save failed:', e.message);
        }

        const imageUrl = record?.imageUrl || magnificUrl;
        return res.status(200).json({ imageUrl, taskId, usage: { costUsd } });
      }
      if (state === 'FAILED' || state === 'ERROR') {
        const reason = inner.error || inner.message || inner.reason || '';
        return res.status(500).json({
          error: `Magnific job failed${reason ? `: ${reason}` : ''}`,
          raw: inner,
        });
      }
    }

    return res.status(504).json({ error: 'Magnific job timed out', taskId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Technical line illustration — CAD-style white vector linework on pure
// black. Deliberately brand-agnostic: monochromatic by definition, so it
// does NOT merge palette / photography / grade the way photo mode does.
// The subject is the only variable; everything else is a fixed house style.
function buildLinePrompt(userPrompt) {
  const subject = userPrompt.trim();
  return [
    `Generate one clean monochromatic line illustration of ${subject} using a refined editorial engineering style.`,
    `Illustrate the subject with crisp white vector linework on a pure black background, using a consistent monoline stroke with only subtle variations to establish visual hierarchy. Construct the illustration from clean contour lines and simplified structural edges, describing the object's volume through geometry rather than shading. Simplify complex forms while preserving the defining proportions, silhouette, and recognizable design language of the subject. Remove unnecessary bolts, branding, identifying graphics, logos, textures, small fasteners, vents, surface imperfections, and intricate internal mechanisms.`,
    `Reduce repeating elements into clean graphic patterns without losing the character of the object. Large surfaces should remain open and uncluttered, allowing negative space to become an integral part of the composition. Every visible edge should feel intentional, creating a balanced rhythm between detail and empty space. Straight lines must appear perfectly straight, curves should be smooth and continuous, and perspective should be technically accurate. Compose the subject in a three-quarter perspective with generous negative space surrounding it, allowing the object to become the sole focal point. The illustration should feel minimal, balanced, geometric, and highly refined, never busy or overly technical. Render with razor-sharp vector precision, museum-quality edge definition, and exceptional clarity suitable for large-format print, brand guidelines, signage, editorial applications, and digital interfaces. The final artwork should appear isolated on a pure black background with no environmental context, resembling a premium editorial technical drawing where industrial subjects are transformed into elegant graphic icons through disciplined linework and thoughtful simplification.`,
    `Avoid photorealism, sketch aesthetics, blueprint graphics, cross-hatching, stippling, gradients, shadows, solid fills, texture mapping, painterly effects, glow, distressed effects, decorative ornamentation, clutter, unnecessary detail, environmental backgrounds, typography, branding, logos, labels, or any visual element that distracts from the clarity, precision, and simplicity of the illustration.`,
  ].join(' ');
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
