// Vercel Edge middleware — pretty client URLs + auth gates.
//
// Client URLs (no /brand-os/ prefix):
//   /<slug>                    → hub if authed, login-for-that-brand otherwise
//   /<slug>/copywriter         → copywriter workshop (auth required)
//   /<slug>/art-director       → art director workshop (auth required)
//   /login                     → client login (rewrite to /brand-os/login.html)
//   /admin                     → admin editor (auth-gated: role === 'admin')
//
// API gates:
//   /api/brand-os/(copywriter|art-director|save-brand|brands|preview-prompts|
//                  blob-token|usage|github-check)  → require session
//   Admin-only APIs additionally require role === 'admin'.

import { verify, readCookie } from './lib/brand-os-auth.js';

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/brand-os/copywriter',
    '/api/brand-os/art-director',
    '/api/brand-os/save-brand',
    '/api/brand-os/brands',
    '/api/brand-os/preview-prompts',
    '/api/brand-os/blob-token',
    '/api/brand-os/usage',
    '/api/brand-os/github-check',
    // Catch-all for slug routes; excludes reserved directories and any file with a dot.
    '/((?!brand-os|api|_next|_vercel|.*\\..*).*)',
  ],
};

// Single-segment reserved words — never treated as a brand slug.
const RESERVED = new Set(['login', 'admin', 'favicon.ico', '']);

const SLUG_RE = /^\/([a-z][a-z0-9-]{1,40})(?:\/(copywriter|art-director))?\/?$/;

export default async function middleware(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  const isApi = p.startsWith('/api/');

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return isApi
      ? json(500, { error: 'AUTH_SECRET not configured' })
      : rewrite('/brand-os/index.html', req.url);
  }

  const cookieHeader = req.headers.get('cookie') || '';
  const payload = await verify(readCookie(cookieHeader), secret);

  // Admin routes
  if (p === '/admin' || p.startsWith('/admin/')) {
    if (!payload || payload.role !== 'admin') {
      const login = new URL('/login', req.url);
      login.searchParams.set('admin', '1');
      login.searchParams.set('next', p + url.search);
      return Response.redirect(login.toString(), 302);
    }
    return; // pass through — vercel.json rewrites /admin → /brand-os/admin.html
  }

  // API gates
  if (isApi) {
    if (!payload) return json(401, { error: 'Not signed in' });
    const adminOnly = ['save-brand', 'brands', 'preview-prompts', 'usage', 'github-check']
      .some(x => p.endsWith('/' + x));
    if (adminOnly && payload.role !== 'admin') return json(403, { error: 'Admin only' });
    return; // pass through to the function
  }

  // Slug routes: /<slug> or /<slug>/copywriter or /<slug>/art-director
  const m = p.match(SLUG_RE);
  if (m && !RESERVED.has(m[1])) {
    const slug = m[1];
    const sub = m[2]; // 'copywriter' | 'art-director' | undefined
    const authedForBrand = payload && (payload.slug === slug || payload.role === 'admin');

    if (!authedForBrand) {
      // Show the client login pre-filled with this slug, URL stays /<slug>.
      const dest = new URL('/brand-os/login.html', req.url);
      dest.searchParams.set('slug', slug);
      return rewrite(dest.toString(), req.url);
    }

    if (sub === 'copywriter') {
      return rewriteWith(`/brand-os/copywriter.html`, { slug }, req.url);
    }
    if (sub === 'art-director') {
      return rewriteWith(`/brand-os/art-director.html`, { slug }, req.url);
    }
    return rewriteWith(`/brand-os/hub.html`, { slug }, req.url);
  }

  return; // pass through for anything else
}

function rewrite(destination, base) {
  const url = new URL(destination, base);
  return new Response(null, {
    headers: { 'x-middleware-rewrite': url.toString() },
  });
}
function rewriteWith(path, params, base) {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    headers: { 'x-middleware-rewrite': url.toString() },
  });
}
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
