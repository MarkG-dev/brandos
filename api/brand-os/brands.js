// Brand OS — admin brand catalogue.
//
//   GET /api/brand-os/brands
//     Middleware requires admin. Returns [{ slug, name, createdAt, updatedAt? }].
//
//   GET /api/brand-os/brands?slug=<x>
//     Returns full brand config (without passwordHash) for the editor.
//
// Single-brand reads go to GitHub first (the source of truth — the deployed
// brands/ dir lags one deploy behind every save), then fall back to disk.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const brandsDir = join(process.cwd(), 'brands');
  const slug = req.query?.slug || (new URL(req.url, 'http://x').searchParams.get('slug'));

  if (slug) {
    let brand = await readFromGitHub(slug);
    if (!brand) {
      try {
        brand = JSON.parse(await readFile(join(brandsDir, `${slug}.json`), 'utf8'));
      } catch {
        return res.status(404).json({ error: `Brand ${slug} not found` });
      }
    }
    delete brand.passwordHash;
    return res.status(200).json(brand);
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

async function readFromGitHub(slug) {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return null;
  const repo = process.env.GITHUB_REPO || 'MarkG-dev/brandos';
  const branch = process.env.GITHUB_BRANCH || 'main';
  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/contents/brands/${slug}.json?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          'authorization': `Bearer ${pat}`,
          'accept': 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    return JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf8'));
  } catch {
    return null;
  }
}
