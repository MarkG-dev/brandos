// Brand OS — output library listing.
//
// GET /api/brand-os/outputs?slug=<x>&limit=<n>
//   → { outputs: [ record, ... ] }   newest first
//
// Auth: session slug must match, or admin. Enforced by middleware
// (session required) plus the slug cross-check here.

import { verify, readCookie } from '../../lib/brand-os-auth.js';
import { listOutputs } from '../../lib/brand-os-outputs.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(500).json({ error: 'AUTH_SECRET not configured' });

  const payload = await verify(readCookie(req.headers.cookie || ''), secret);
  if (!payload) return res.status(401).json({ error: 'Not signed in' });

  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug');
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (payload.role !== 'admin' && payload.slug !== slug) {
    return res.status(403).json({ error: 'Session does not match slug' });
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 60, 200);

  try {
    const outputs = await listOutputs(slug, { limit });
    return res.status(200).json({ outputs });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
