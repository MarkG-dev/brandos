// Brand OS — GitHub connectivity diagnostic.
//
// GET /api/brand-os/github-check
//   → { env, repoRead, branchExists, writeTest, verdict }
//
// Runs three live probes against the configured GitHub repo/branch and
// returns exact status codes + GitHub error bodies so we can tell whether
// the PAT / repo / branch is the problem. Admin-only via middleware.

export default async function handler(req, res) {
  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO || 'MarkG-dev/brandos';
  const branch = process.env.GITHUB_BRANCH || 'main';

  const env = {
    GITHUB_PAT_set: !!pat,
    GITHUB_PAT_prefix: pat ? pat.slice(0, 8) + '…' : null,
    GITHUB_PAT_length: pat ? pat.length : 0,
    GITHUB_REPO: repo,
    GITHUB_BRANCH: branch,
  };

  if (!pat) {
    return res.status(200).json({
      env,
      verdict: 'GITHUB_PAT is not set on this deployment. Set it in Vercel env vars (all three environments) and redeploy.',
    });
  }

  const headers = {
    'authorization': `Bearer ${pat}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };

  const repoRead = await probe(
    `https://api.github.com/repos/${repo}`,
    { headers },
  );

  const branchExists = await probe(
    `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`,
    { headers },
  );

  const testPath = 'brand-os-pat-check.txt';
  const writeTest = await probe(
    `https://api.github.com/repos/${repo}/contents/${testPath}`,
    {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Brand OS: PAT diagnostic',
        content: Buffer.from(`ok ${new Date().toISOString()}`).toString('base64'),
        branch,
      }),
    },
  );

  let verdict;
  if (repoRead.status === 404) {
    verdict = `Repo ${repo} not visible to this PAT. If fine-grained, check "Repository access" includes ${repo}. If classic, needs \`repo\` scope.`;
  } else if (repoRead.status === 401) {
    verdict = 'PAT is invalid, expired, or malformed. Regenerate and re-paste (watch for extra whitespace).';
  } else if (repoRead.status === 403 || writeTest.status === 403) {
    verdict = 'PAT can reach GitHub but lacks Contents:Write permission on this repo. Fine-grained: Repository permissions → Contents → Read and write.';
  } else if (branchExists.status === 404) {
    verdict = `Branch "${branch}" does not exist on ${repo}. Create it or set GITHUB_BRANCH to an existing branch.`;
  } else if (writeTest.ok) {
    verdict = 'All good. Repo readable, branch exists, write succeeded — save-brand should work.';
  } else {
    verdict = `Unexpected write failure (${writeTest.status}). See writeTest.body.`;
  }

  return res.status(200).json({ env, repoRead, branchExists, writeTest, verdict });
}

async function probe(url, init) {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { ok: r.ok, status: r.status, url, body: pickBody(body) };
  } catch (e) {
    return { ok: false, status: 0, url, error: e.message };
  }
}

function pickBody(b) {
  if (b && typeof b === 'object') {
    const { message, documentation_url, status, name, default_branch, private: priv } = b;
    return { message, documentation_url, status, name, default_branch, private: priv };
  }
  return b;
}
