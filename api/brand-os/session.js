// Brand OS session API.
//
//   POST   /api/brand-os/session
//     Body A (brand client): { slug: string, password: string }
//     Body B (admin):        { username: string, password: string }
//     → sets brand_os_session cookie, returns { slug, role, name? }
//
//   GET    /api/brand-os/session  (also served as /session/me for clarity)
//     → { slug, role, name? } if signed in, 401 otherwise
//
//   DELETE /api/brand-os/session
//     → clears cookie
//
// Reads brand configs from brands/<slug>.json at process.cwd().

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
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
    try {
      const raw = await readFile(join(process.cwd(), 'brands', `${payload.slug}.json`), 'utf8');
      const brand = JSON.parse(raw);
      return res.status(200).json({ slug: payload.slug, role: payload.role, name: brand.name });
    } catch {
      return res.status(200).json({ slug: payload.slug, role: payload.role });
    }
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
    const { slug, password } = body;
    if (!slug || !password) return res.status(400).json({ error: 'slug and password required' });

    let brand;
    try {
      const raw = await readFile(join(process.cwd(), 'brands', `${slug}.json`), 'utf8');
      brand = JSON.parse(raw);
    } catch {
      // Constant-time-ish rejection: still hash to avoid timing leaks.
      await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvwxyzabcdefghij0123456789');
      return res.status(401).json({ error: 'Invalid brand or password' });
    }

    const ok = await bcrypt.compare(password, brand.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid brand or password' });

    const token = await sign(
      { slug, role: 'client', exp: nowSecs() + DEFAULT_TTL_SECONDS },
      secret,
    );
    res.setHeader('Set-Cookie', buildSetCookie(token));
    return res.status(200).json({ slug, role: 'client', name: brand.name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function nowSecs() { return Math.floor(Date.now() / 1000); }
