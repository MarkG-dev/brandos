// Brand OS — save a brand config.
//
// POST /api/brand-os/save-brand
//   Body: {
//     name, slug, password?, renameFrom?,
//     strategy, voice, art, presets?, model?, assets?
//   }
//   → { path, committed, sha?, commit?, renamedFrom? }
//
// Behaviour:
//   - Validates slug (kebab-case).
//   - Loads the existing config (GitHub first, disk fallback) and PRESERVES
//     passwordHash / createdAt / presets when the request omits them —
//     a save from the admin panel never silently resets fields it doesn't
//     know about.
//   - Password only required when there is no existing brand to inherit from.
//   - If GITHUB_PAT is set → commits via GitHub Contents API (retrying once
//     on a sha conflict) and returns { committed: true, sha }.
//   - On rename (renameFrom ≠ slug) deletes the old file after writing the
//     new one.
//   - Without a PAT → returns the file content for manual commit.
//
// Middleware already ensures the caller is an admin.

import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  if (!b.name || !b.slug) {
    return res.status(400).json({ error: 'name and slug required' });
  }
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(b.slug)) {
    return res.status(400).json({ error: 'slug must be kebab-case, 2–40 chars, starting with a letter' });
  }

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO || 'MarkG-dev/brandos';
  const branch = process.env.GITHUB_BRANCH || 'main';

  const isRename = !!(b.renameFrom && b.renameFrom !== b.slug);
  const sourceSlug = isRename ? b.renameFrom : b.slug;

  // ---- Load existing config: GitHub is the source of truth, disk is the
  // fallback (disk lags until the next deploy picks up the config commit).
  let existing = null;
  let targetSha;   // sha of brands/<slug>.json if it already exists
  let oldSha;      // sha of brands/<renameFrom>.json when renaming

  if (pat) {
    const targetGet = await ghGet(pat, repo, branch, ghPath(b.slug));
    if (targetGet.ok) {
      targetSha = targetGet.data.sha;
      if (!isRename) existing = parseGhContent(targetGet.data);
    } else if (targetGet.status !== 404) {
      return res.status(targetGet.status).json({ error: `GitHub GET failed: ${targetGet.text}` });
    }
    if (isRename) {
      const oldGet = await ghGet(pat, repo, branch, ghPath(sourceSlug));
      if (oldGet.ok) {
        oldSha = oldGet.data.sha;
        existing = parseGhContent(oldGet.data);
      }
    }
  }
  if (!existing) {
    try {
      existing = JSON.parse(await readFile(join(process.cwd(), 'brands', `${sourceSlug}.json`), 'utf8'));
    } catch { /* genuinely new brand */ }
  }

  if (!b.password && !existing?.passwordHash) {
    return res.status(400).json({ error: 'A new brand needs a password' });
  }
  const passwordHash = b.password ? await bcrypt.hash(b.password, 10) : existing.passwordHash;

  const config = {
    name: b.name,
    slug: b.slug,
    passwordHash,
    createdAt: existing?.createdAt || new Date().toISOString(),
    // Users are managed via /api/brand-os/users — always carried through.
    users: existing?.users || [],
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
      copywriter: firstNonEmpty(b.presets?.copywriter, existing?.presets?.copywriter, defaultCopywriterPresets()),
      artDirector: firstNonEmpty(b.presets?.artDirector, existing?.presets?.artDirector, defaultArtDirectorPresets()),
    },
    model: {
      copywriter: b.model?.copywriter || existing?.model?.copywriter || 'claude-opus-4-8',
      artDirector: b.model?.artDirector || existing?.model?.artDirector || 'realism',
    },
    assets: {
      assetLibraryUrl:  b.assets?.assetLibraryUrl  || b.assets?.brandAssetsUrl || '',
      pdfGuidelines:    Array.isArray(b.assets?.pdfGuidelines)
        ? b.assets.pdfGuidelines.filter(f => f && f.url).map(f => ({ name: f.name || '', url: f.url }))
        : (b.assets?.pdfGuidelinesUrl ? [{ name: 'Brand Guidelines.pdf', url: b.assets.pdfGuidelinesUrl }] : []),
      guidelinesZipUrl: b.assets?.guidelinesZipUrl || '',
    },
  };

  const path = ghPath(b.slug);
  const content = JSON.stringify(config, null, 2) + '\n';

  if (!pat) {
    return res.status(200).json({
      committed: false,
      path,
      content,
      instructions: 'GITHUB_PAT env var not set. Copy the content field and commit it manually to the repo at the given path.',
    });
  }

  try {
    let putData = await ghPut(pat, repo, branch, path, content, targetSha, `Brand OS: ${targetSha ? 'update' : 'add'} ${b.slug}`);
    if (putData.status === 409 || putData.status === 422) {
      // sha conflict — another save landed between our GET and PUT. Refetch and retry once.
      const refetch = await ghGet(pat, repo, branch, path);
      const freshSha = refetch.ok ? refetch.data.sha : undefined;
      putData = await ghPut(pat, repo, branch, path, content, freshSha, `Brand OS: update ${b.slug} (retry)`);
    }
    if (!putData.ok) {
      return res.status(putData.status).json({ error: putData.data?.message || 'GitHub PUT failed', raw: putData.data });
    }

    let renamedFrom = null;
    if (isRename && oldSha) {
      await fetch(`https://api.github.com/repos/${repo}/contents/${ghPath(sourceSlug)}`, {
        method: 'DELETE',
        headers: { ...authHeaders(pat), 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `Brand OS: rename ${sourceSlug} → ${b.slug}`,
          sha: oldSha,
          branch,
        }),
      });
      renamedFrom = sourceSlug;
    }

    return res.status(200).json({
      committed: true,
      path,
      sha: putData.data.content?.sha,
      commit: putData.data.commit?.html_url,
      renamedFrom,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function ghPath(slug) { return `brands/${slug}.json`; }

function firstNonEmpty(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  return [];
}

function parseGhContent(data) {
  try {
    return JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function ghGet(pat, repo, branch, path) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: authHeaders(pat) },
  );
  if (!r.ok) return { ok: false, status: r.status, text: await r.text() };
  return { ok: true, status: r.status, data: await r.json() };
}

async function ghPut(pat, repo, branch, path, content, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(pat), 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha,
    }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
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
    { label: 'Tagline', prompt: 'One line, max 8 words, in brand voice.' },
    { label: 'Headline', prompt: 'A display headline in the brand voice. UPPERCASE if the brand direction calls for it.' },
    { label: 'Social post', prompt: 'A social post in the brand voice. First line is the hook. Short paragraphs. No hashtags, no emoji.' },
    { label: 'Explain simply', prompt: 'Rewrite in plain language for someone unfamiliar with the category.' },
  ];
}

function defaultArtDirectorPresets() {
  return [
    { label: 'Hero horizontal', aspect: '3:2', hint: 'wide landscape composition, low horizon, headroom for wordmark' },
    { label: 'Product still', aspect: '1:1', hint: 'product-first, hairline shadow, orthogonal composition' },
    { label: 'Social square', aspect: '1:1', hint: 'eye-level composition, headroom for wordmark, negative space bottom-left' },
    { label: 'Story portrait', aspect: '9:16', hint: 'vertical, subject centred, minimal background clutter' },
  ];
}
