// Brand OS — GitHub Contents API helpers.
//
// Brand configs live in git; the deployed brands/ dir lags one deploy
// behind every save. Anything that needs CURRENT data (login, admin
// editor, user management) reads GitHub first and falls back to disk.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function ghEnv() {
  return {
    pat: process.env.GITHUB_PAT,
    repo: process.env.GITHUB_REPO || 'MarkG-dev/brandos',
    branch: process.env.GITHUB_BRANCH || 'main',
  };
}

function headers(pat) {
  return {
    'authorization': `Bearer ${pat}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

// → { sha, json } or null (missing file / no PAT / parse failure)
export async function ghGetJson(path) {
  const { pat, repo, branch } = ghEnv();
  if (!pat) return null;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      { headers: headers(pat) },
    );
    if (!r.ok) return null;
    const data = await r.json();
    return {
      sha: data.sha,
      json: JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf8')),
    };
  } catch {
    return null;
  }
}

// PUT with one automatic retry on sha conflict. → { ok, status, data }
export async function ghPutJson(path, obj, sha, message) {
  const { pat, repo, branch } = ghEnv();
  if (!pat) return { ok: false, status: 0, data: { message: 'GITHUB_PAT not set' } };
  const content = JSON.stringify(obj, null, 2) + '\n';

  const attempt = async (useSha) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers(pat), 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha: useSha,
      }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  };

  let result = await attempt(sha);
  if (result.status === 409 || result.status === 422) {
    const fresh = await ghGetJson(path);
    result = await attempt(fresh?.sha);
  }
  return result;
}

// Brand config from GitHub, falling back to the deployed brands/ dir.
// → { config, sha } — sha is undefined when served from disk.
export async function readBrand(slug) {
  const gh = await ghGetJson(`brands/${slug}.json`);
  if (gh) return { config: gh.json, sha: gh.sha };
  try {
    const raw = await readFile(join(process.cwd(), 'brands', `${slug}.json`), 'utf8');
    return { config: JSON.parse(raw), sha: undefined };
  } catch {
    return null;
  }
}
