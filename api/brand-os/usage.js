// Brand OS — usage read API.
//
// GET /api/brand-os/usage?slug=<x>&monthsBack=6
//   → { slug, months: [...], totalCostUsd, pricing }
//
// Middleware requires admin.

import { readUsage } from '../../lib/brand-os-usage.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug');
  const monthsBack = Math.min(Math.max(parseInt(url.searchParams.get('monthsBack') || '6', 10) || 6, 1), 12);
  if (!slug) return res.status(400).json({ error: 'slug required' });
  try {
    const data = await readUsage(slug, monthsBack);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
