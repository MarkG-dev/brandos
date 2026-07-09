// Brand OS — compiled prompt previews.
//
//   POST /api/brand-os/preview-prompts   body: { brand: {...current form config...} }
//   GET  /api/brand-os/preview-prompts?slug=<x>   (legacy, reads from disk)
//   → { copywriter: { systemTemplate, model, presets },
//       artDirector: { promptTemplate, model, presets, apiParams } }
//
// POST compiles from the in-memory config the admin is editing — no slug
// dependency, no disk read, always up to date with unsaved edits.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function handler(req, res) {
  let brand;

  if (req.method === 'POST') {
    brand = req.body?.brand || {};
    if (!brand.name) return res.status(400).json({ error: 'brand.name required in body' });
  } else if (req.method === 'GET') {
    const slug = req.query?.slug || (new URL(req.url, 'http://x').searchParams.get('slug'));
    if (!slug) return res.status(400).json({ error: 'slug required' });
    try {
      brand = JSON.parse(await readFile(join(process.cwd(), 'brands', `${slug}.json`), 'utf8'));
    } catch {
      return res.status(404).json({ error: `Brand ${slug} not found` });
    }
  } else {
    return res.status(405).json({ error: 'GET or POST' });
  }

  return res.status(200).json(compile(brand));
}

function compile(brand) {
  const examples = (brand.voice?.examples || []).map(e => `- ${e}`).join('\n') || '(none provided)';
  const doNotUse = (brand.voice?.doNotUse || []).map(d => `- ${d}`).join('\n') || '(none)';
  const strategy = brand.strategy || {};
  const products = (strategy.products || []).map(p => `- ${p}`).join('\n');
  const strategyBlock = [
    strategy.positioning && `Positioning:\n${strategy.positioning}`,
    strategy.audience && `Audience:\n${strategy.audience}`,
    products && `Products:\n${products}`,
    strategy.belief && `Core belief:\n${strategy.belief}`,
  ].filter(Boolean).join('\n\n');

  const copywriterSystem = `You are the ${brand.name} copywriter.

Task: {TASK}
${strategyBlock ? `\nStrategy — what the brand is:\n${strategyBlock}\n` : ''}
Voice guidelines:
${brand.voice?.guidelines || '(unspecified — default to the brand tone examples below)'}

Voice examples (write in this register):
${examples}

Do NOT use:
${doNotUse}

Return ONLY the rewritten text. No preface, no explanation, no quote marks around it.`;

  const palette = (brand.art?.palette || []).map(p => `${p.name} ${p.hex}`).join(', ');
  const artTemplate = [
    '{USER_PROMPT}',
    '{PRESET_HINT}',
    brand.art?.photography && `Photography: ${brand.art.photography}.`,
    brand.art?.framing && `Framing: ${brand.art.framing}.`,
    brand.art?.grade && `Grade: ${brand.art.grade}.`,
    palette && `Palette: ${palette}.`,
  ].filter(Boolean).join(' ');

  return {
    copywriter: {
      systemTemplate: copywriterSystem,
      model: brand.model?.copywriter || 'claude-opus-4-8',
      presets: brand.presets?.copywriter || [],
    },
    artDirector: {
      promptTemplate: artTemplate,
      model: brand.model?.artDirector || 'realism',
      presets: brand.presets?.artDirector || [],
      apiParams: {
        endpoint: 'POST https://api.magnific.com/v1/ai/mystic',
        model: brand.model?.artDirector || 'realism',
        resolution: '2k',
        aspect_ratio: '(from selected preset)',
        engine: 'automatic',
        creative_detailing: 33,
        adherence: 50,
        hdr: 20,
      },
    },
  };
}
