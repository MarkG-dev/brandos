// Brand OS — save a brand config.
//
// POST /api/brand-os/save-brand
//   Body: {
//     name, slug, password,
//     voice: { guidelines, examples, doNotUse },
//     art:   { palette, photography, framing, grade, referenceCues },
//     presets: { copywriter, artDirector },
//     model?: { copywriter, artDirector }
//   }
//   → { path, committed, sha? }
//
// Behaviour:
//   - Validates slug (kebab-case, unique-ish).
//   - Hashes password with bcryptjs.
//   - Renders brands/<slug>.json content.
//   - If GITHUB_PAT + GITHUB_REPO are set → commits via GitHub Contents API and returns { committed: true, sha }.
//   - Otherwise → returns the file content + hash so the admin can commit manually.
//
// Middleware already ensures the caller is an admin.

import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  if (!b.name || !b.slug || !b.password) {
    return res.status(400).json({ error: 'name, slug, and password required' });
  }
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(b.slug)) {
    return res.status(400).json({ error: 'slug must be kebab-case, 2–40 chars, starting with a letter' });
  }

  const passwordHash = await bcrypt.hash(b.password, 10);

  const config = {
    name: b.name,
    slug: b.slug,
    passwordHash,
    createdAt: new Date().toISOString(),
    strategy: {
      positioning: b.strategy?.positioning || '',
      audience: b.strategy?.audience || '',
      products: b.strategy?.products || [],
      belief: b.strategy?.belief || '',
    },
    voice: {
      guidelines: b.voice?.guidelines || '',
      examples: b.voice?.examples || [],
      doNotUse: b.voice?.doNotUse || [],
    },
    art: {
      palette: b.art?.palette || [],
      photography: b.art?.photography || '',
      framing: b.art?.framing || '',
      grade: b.art?.grade || '',
      referenceCues: b.art?.referenceCues || [],
    },
    presets: {
      copywriter: b.presets?.copywriter || defaultCopywriterPresets(),
      artDirector: b.presets?.artDirector || defaultArtDirectorPresets(),
    },
    model: {
      copywriter: b.model?.copywriter || 'claude-opus-4-8',
      artDirector: b.model?.artDirector || 'realism',
    },
    assets: {
      assetLibraryUrl:  b.assets?.assetLibraryUrl  || b.assets?.brandAssetsUrl || '',
      pdfGuidelines:    Array.isArray(b.assets?.pdfGuidelines)
        ? b.assets.pdfGuidelines.filter(f => f && f.url).map(f => ({ name: f.name || '', url: f.url }))
        : (b.assets?.pdfGuidelinesUrl ? [{ name: 'Brand Guidelines.pdf', url: b.assets.pdfGuidelinesUrl }] : []),
      guidelinesZipUrl: b.assets?.guidelinesZipUrl || '',
    },
  };

  const path = `brands/${b.slug}.json`;
  const content = JSON.stringify(config, null, 2) + '\n';

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO || 'MarkG-dev/brandos';
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!pat) {
    return res.status(200).json({
      committed: false,
      path,
      content,
      instructions: 'GITHUB_PAT env var not set. Copy the content field and commit it manually to the repo at the given path.',
    });
  }

  try {
    // Check for existing file to get its sha (for update-in-place).
    const getRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      { headers: authHeaders(pat) },
    );
    let existingSha;
    if (getRes.ok) {
      const existing = await getRes.json();
      existingSha = existing.sha;
    } else if (getRes.status !== 404) {
      const err = await getRes.text();
      return res.status(getRes.status).json({ error: `GitHub GET failed: ${err}` });
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: { ...authHeaders(pat), 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `Brand OS: ${existingSha ? 'update' : 'add'} ${b.slug}`,
          content: Buffer.from(content).toString('base64'),
          branch,
          sha: existingSha,
        }),
      },
    );
    const putData = await putRes.json();
    if (!putRes.ok) {
      return res.status(putRes.status).json({ error: putData.message || 'GitHub PUT failed', raw: putData });
    }

    // If the client told us this is a rename, delete the old file.
    let renamedFrom = null;
    const oldSlug = (b.renameFrom || '').trim();
    if (oldSlug && oldSlug !== b.slug) {
      const oldPath = `brands/${oldSlug}.json`;
      const oldGet = await fetch(
        `https://api.github.com/repos/${repo}/contents/${oldPath}?ref=${encodeURIComponent(branch)}`,
        { headers: authHeaders(pat) },
      );
      if (oldGet.ok) {
        const oldMeta = await oldGet.json();
        await fetch(
          `https://api.github.com/repos/${repo}/contents/${oldPath}`,
          {
            method: 'DELETE',
            headers: { ...authHeaders(pat), 'content-type': 'application/json' },
            body: JSON.stringify({
              message: `Brand OS: rename ${oldSlug} → ${b.slug}`,
              sha: oldMeta.sha,
              branch,
            }),
          },
        );
        renamedFrom = oldSlug;
      }
    }

    return res.status(200).json({
      committed: true,
      path,
      sha: putData.content?.sha,
      commit: putData.commit?.html_url,
      renamedFrom,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function authHeaders(pat) {
  return {
    'authorization': `Bearer ${pat}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

function defaultCopywriterPresets() {
  return [
    { label: 'Tighten', prompt: 'Cut every unnecessary word. Preserve meaning, sharpen tone.' },
    { label: 'Rewrite as tagline', prompt: 'One line, max 8 words, in brand voice.' },
    { label: 'Headline', prompt: 'A display headline in the brand voice. UPPERCASE if the brand direction calls for it.' },
    { label: 'Explain simply', prompt: 'Rewrite in plain language for someone unfamiliar with the category.' },
  ];
}

function defaultArtDirectorPresets() {
  return [
    { label: 'Hero horizontal', aspect: '3:2', hint: 'wide landscape composition, low horizon, headroom for wordmark' },
    { label: 'Product still', aspect: '1:1', hint: 'product-first, off-white surface, hairline shadow' },
    { label: 'Social square', aspect: '1:1', hint: 'eye-level composition, headroom for wordmark, negative space bottom-left' },
    { label: 'Story portrait', aspect: '9:16', hint: 'vertical, subject centred, minimal background clutter' },
  ];
}
