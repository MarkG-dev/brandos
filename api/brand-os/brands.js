// Brand OS — admin brand catalogue.
//
//   GET /api/brand-os/brands
//     Middleware requires admin. Returns [{ slug, name, createdAt, updatedAt? }].
//
//   GET /api/brand-os/brands?slug=<x>
//     Returns full brand config (without passwordHash) for the editor.
//
// Reads brand configs from brands/*.json at process.cwd().

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const brandsDir = join(process.cwd(), 'brands');
  const slug = req.query?.slug || (new URL(req.url, 'http://x').searchParams.get('slug'));

  if (slug) {
    try {
      const raw = await readFile(join(brandsDir, `${slug}.json`), 'utf8');
      const brand = JSON.parse(raw);
      delete brand.passwordHash;
      return res.status(200).json(brand);
    } catch (e) {
      return res.status(404).json({ error: `Brand ${slug} not found` });
    }
  }

  try {
    let files = [];
    try { files = await readdir(brandsDir); } catch { files = []; }
    const brands = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = join(brandsDir, f);
        const raw = await readFile(p, 'utf8');
        const j = JSON.parse(raw);
        const s = await stat(p);
        brands.push({
          slug: j.slug || f.replace(/\.json$/, ''),
          name: j.name || j.slug,
          createdAt: j.createdAt,
          updatedAt: s.mtime.toISOString(),
        });
      } catch { /* skip malformed */ }
    }
    brands.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return res.status(200).json({ brands });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
