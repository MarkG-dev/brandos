// Brand OS — public/private brand hub data.
//
// GET /api/brand-os/hub?slug=<x>
//
// Auth-optional:
//   - No session (or invalid) → public subset { slug, name, tagline }.
//     Enough to render the login prompt header for a client-shareable URL.
//   - Session role === 'admin' OR session.slug === slug → full payload
//     (assets, strategy, palette). Session mismatch → still returns the
//     public subset — the URL leaks no more than a slug already does.
//
// This endpoint is NOT in the middleware matcher, so unauthenticated
// requests reach the handler and get the public subset.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verify, readCookie } from '../../lib/brand-os-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug');
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid slug' });
  }

  let brand;
  try {
    const raw = await readFile(join(process.cwd(), 'brands', `${slug}.json`), 'utf8');
    brand = JSON.parse(raw);
  } catch {
    return res.status(404).json({ error: 'Brand not found' });
  }

  const publicSubset = {
    slug: brand.slug || slug,
    name: brand.name || slug,
    tagline: brand.strategy?.belief
      || (brand.strategy?.positioning || '').split(/\.|—/)[0]
      || '',
  };

  const secret = process.env.AUTH_SECRET;
  let payload = null;
  if (secret) payload = await verify(readCookie(req.headers.cookie || ''), secret);

  const fullAccess = payload && (payload.role === 'admin' || payload.slug === slug);

  if (!fullAccess) {
    return res.status(200).json(publicSubset);
  }

  return res.status(200).json({
    ...publicSubset,
    strategy: {
      positioning: brand.strategy?.positioning || '',
      belief: brand.strategy?.belief || '',
    },
    palette: brand.art?.palette || [],
    primaryStyle: brand.art?.primaryStyle || 'Photographic',
    lineStyle: !!brand.art?.lineStyle,
    assets: brand.assets || {},
    // Preset labels drive the workshop pills. Prompts/hints stay
    // server-side — the agent APIs look content up by label.
    presets: {
      copywriter: (brand.presets?.copywriter || []).map(p => ({ label: p.label })),
      artDirector: (brand.presets?.artDirector || []).map(p => ({ label: p.label, aspect: p.aspect })),
    },
  });
}
