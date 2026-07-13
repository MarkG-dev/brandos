// Brand OS — studio-managed users per brand.
//
//   GET  /api/brand-os/users?slug=<x>
//     → { users: [{ id, name, email, createdAt, disabled }] }   (no hashes)
//
//   POST /api/brand-os/users
//     { slug, action: 'add',            name, email, password }
//     { slug, action: 'remove',         userId }
//     { slug, action: 'reset-password', userId, password }
//     { slug, action: 'toggle',         userId }              (enable/disable)
//     → { users: [...] } updated list
//
// Users are stored on the brand config (brands/<slug>.json) and committed
// to GitHub — no external database, no env vars. Admin-only (middleware
// enforces the session; role checked again here).

import bcrypt from 'bcryptjs';
import { verify, readCookie } from '../../lib/brand-os-auth.js';
import { readBrand, ghPutJson, ghEnv } from '../../lib/brand-os-github.js';

export default async function handler(req, res) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(500).json({ error: 'AUTH_SECRET not configured' });

  const payload = await verify(readCookie(req.headers.cookie || ''), secret);
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const slug = url.searchParams.get('slug');
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const found = await readBrand(slug);
    if (!found) return res.status(404).json({ error: `Brand ${slug} not found` });
    return res.status(200).json({ users: publicUsers(found.config) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const { slug, action, name, email, password, userId } = req.body || {};
  if (!slug || !action) return res.status(400).json({ error: 'slug and action required' });

  if (!ghEnv().pat) {
    return res.status(500).json({ error: 'GITHUB_PAT not set — user management needs the GitHub commit path.' });
  }

  const found = await readBrand(slug);
  if (!found) return res.status(404).json({ error: `Brand ${slug} not found` });
  const config = found.config;
  const users = Array.isArray(config.users) ? config.users : [];

  let message;
  if (action === 'add') {
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const normEmail = (email || '').trim().toLowerCase();
    if (normEmail && users.some(u => (u.email || '').toLowerCase() === normEmail)) {
      return res.status(409).json({ error: `A user with email ${normEmail} already exists` });
    }
    users.push({
      id: `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      email: normEmail,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString(),
      disabled: false,
    });
    message = `Brand OS: add user to ${slug}`;
  } else if (action === 'remove') {
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users.splice(idx, 1);
    message = `Brand OS: remove user from ${slug}`;
  } else if (action === 'reset-password') {
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!password) return res.status(400).json({ error: 'password required' });
    user.passwordHash = await bcrypt.hash(password, 10);
    message = `Brand OS: reset user password on ${slug}`;
  } else if (action === 'toggle') {
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.disabled = !user.disabled;
    message = `Brand OS: ${user.disabled ? 'disable' : 'enable'} user on ${slug}`;
  } else {
    return res.status(400).json({ error: `Unknown action ${action}` });
  }

  config.users = users;
  const put = await ghPutJson(`brands/${slug}.json`, config, found.sha, message);
  if (!put.ok) {
    return res.status(put.status || 500).json({ error: put.data?.message || 'GitHub commit failed' });
  }

  return res.status(200).json({ users: publicUsers(config) });
}

function publicUsers(config) {
  return (config.users || []).map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt,
    disabled: !!u.disabled,
  }));
}
