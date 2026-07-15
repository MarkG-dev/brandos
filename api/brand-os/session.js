// Brand OS session API.
//
//   POST   /api/brand-os/session
//     Body A (brand client, shared password): { slug, password }
//     Body B (brand client, named user):      { slug, email, password }
//     Body C (admin):                         { username, password }
//     → sets brand_os_session cookie, returns { slug, role, name?, user? }
//
//     `slug` accepts either the real slug OR the brand's display name —
//     "Loop X", "loop-x", and "loopx" all resolve to the same brand, so
//     clients can type their company name at the generic /login.
//
//   GET    /api/brand-os/session  (also served as /session/me for clarity)
//     → { slug, role, name?, user? } if signed in, 401 otherwise
//
//   DELETE /api/brand-os/session
//     → clears cookie
//
// Brand reads go through readBrand (GitHub first, disk fallback) so a
// just-added user can sign in before the next deploy lands.

import bcrypt from 'bcryptjs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBrand } from '../../lib/brand-os-github.js';
import {
  sign,
  verify,
  readCookie,
  buildSetCookie,
  buildClearCookie,
  DEFAULT_TTL_SECONDS,
} from '../../lib/brand-os-auth.js';

export default async function handler(req, res) {
  const secret0 = process.env.AUTH_SECRET;

  if (req.method === 'GET') {
    if (!secret0) return res.status(500).json({ error: 'AUTH_SECRET not configured' });
    const payload = await verify(readCookie(req.headers.cookie || ''), secret0);
    if (!payload) return res.status(401).json({ error: 'Not signed in' });
    if (payload.role === 'admin') return res.status(200).json({ slug: payload.slug, role: 'admin' });
    const found = await readBrand(payload.slug);
    return res.status(200).json({
      slug: payload.slug,
      role: payload.role,
      name: found?.config?.name,
      user: payload.user || null,
    });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', buildClearCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'GET, POST or DELETE only' });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(500).json({ error: 'AUTH_SECRET not configured' });

  const body = req.body || {};

  try {
    // Admin login path.
    if (body.username) {
      const adminUser = process.env.BRAND_OS_ADMIN_USER;
      const adminPass = process.env.BRAND_OS_ADMIN_PASS;
      if (!adminUser || !adminPass) {
        return res.status(500).json({ error: 'Admin credentials not configured' });
      }
      if (body.username !== adminUser || body.password !== adminPass) {
        return res.status(401).json({ error: 'Invalid admin credentials' });
      }
      const token = await sign(
        { slug: '__admin__', role: 'admin', exp: nowSecs() + DEFAULT_TTL_SECONDS },
        secret,
      );
      res.setHeader('Set-Cookie', buildSetCookie(token));
      return res.status(200).json({ slug: '__admin__', role: 'admin' });
    }

    // Brand client login path.
    const { slug: brandInput, password, email } = body;
    if (!brandInput || !password) return res.status(400).json({ error: 'brand and password required' });

    const resolved = await resolveBrand(brandInput);
    if (!resolved) {
      // Constant-time-ish rejection: still hash to avoid timing leaks.
      await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvwxyzabcdefghij0123456789');
      return res.status(401).json({ error: 'Invalid brand or password' });
    }
    const { slug, config: brand } = resolved;

    let user = null;
    if (email && email.trim()) {
      // Named-user login: email + personal password.
      const normEmail = email.trim().toLowerCase();
      const match = (brand.users || []).find(u => (u.email || '').toLowerCase() === normEmail);
      if (!match || match.disabled) {
        await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvwxyzabcdefghij0123456789');
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const ok = await bcrypt.compare(password, match.passwordHash || '');
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      user = { id: match.id, name: match.name };
    } else {
      // Shared brand password.
      const ok = await bcrypt.compare(password, brand.passwordHash || '');
      if (!ok) return res.status(401).json({ error: 'Invalid brand or password' });
    }

    const token = await sign(
      { slug, role: 'client', user, exp: nowSecs() + DEFAULT_TTL_SECONDS },
      secret,
    );
    res.setHeader('Set-Cookie', buildSetCookie(token));
    return res.status(200).json({ slug, role: 'client', name: brand.name, user });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function nowSecs() { return Math.floor(Date.now() / 1000); }

// Resolve whatever the client typed — "Loop X", "loop-x", "loopx" — to a
// brand. Tries slug candidates first, then scans configs by display name.
async function resolveBrand(input) {
  const raw = String(input).trim();
  const candidates = [...new Set([
    raw.toLowerCase(),
    raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), // kebab
    raw.toLowerCase().replace(/[^a-z0-9]+/g, ''),                        // squashed
  ])];
  for (const c of candidates) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(c)) continue;
    const found = await readBrand(c);
    if (found) return { slug: c, config: found.config };
  }
  // Display-name match against the deployed configs.
  try {
    const dir = join(process.cwd(), 'brands');
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(await readFile(join(dir, f), 'utf8'));
        if ((j.name || '').trim().toLowerCase() === raw.toLowerCase()) {
          const slug = j.slug || f.replace(/\.json$/, '');
          const fresh = await readBrand(slug); // GitHub-first for current users/hashes
          return { slug, config: fresh?.config || j };
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* no brands dir */ }
  return null;
}
