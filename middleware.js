// Vercel Edge middleware — Brand OS route guards.
//
// Protects:
//   /brand-os/(brand|copywriter|art-director|admin)      → require session
//   /api/brand-os/(copywriter|art-director|save-brand)   → require session
//
// Missing / invalid cookie → 302 to /brand-os/login (pages) or 401 JSON (API).
// Admin routes require role === "admin".

import { verify, readCookie } from './lib/brand-os-auth.js';

export const config = {
  matcher: [
    '/brand-os/copywriter',
    '/brand-os/art-director',
    '/brand-os/admin',
    '/api/brand-os/copywriter',
    '/api/brand-os/art-director',
    '/api/brand-os/save-brand',
    '/api/brand-os/brands',
    '/api/brand-os/preview-prompts',
    '/api/brand-os/blob-token',
    '/api/brand-os/usage',
    '/api/brand-os/github-check',
  ],
};

export default async function middleware(req) {
  const url = new URL(req.url);
  const isApi = url.pathname.startsWith('/api/');
  const isAdmin = url.pathname.endsWith('/admin')
    || url.pathname.endsWith('/save-brand')
    || url.pathname.endsWith('/brands')
    || url.pathname.endsWith('/preview-prompts')
    || url.pathname.endsWith('/usage')
    || url.pathname.endsWith('/github-check');

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return jsonOrRedirect(isApi, 500, 'AUTH_SECRET not configured', url);
  }

  const cookieHeader = req.headers.get('cookie') || '';
  const token = readCookie(cookieHeader);
  const payload = await verify(token, secret);

  if (!payload) return jsonOrRedirect(isApi, 401, 'Not signed in', url);
  if (isAdmin && payload.role !== 'admin') {
    return jsonOrRedirect(isApi, 403, 'Admin only', url);
  }
  return; // pass through
}

function jsonOrRedirect(isApi, status, message, url) {
  if (isApi) {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const login = new URL('/brand-os/login', url.origin);
  login.searchParams.set('next', url.pathname + url.search);
  return Response.redirect(login.toString(), 302);
}
