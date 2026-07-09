// Shared HMAC cookie sign/verify for Brand OS.
// Used by both middleware.js (Edge runtime) and api/brand-os/session.js (Node).
// Uses only Web Crypto so it runs in both environments.
//
// Cookie value shape:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 sig)
// Payload:  { slug: string, role: "client" | "admin", exp: number }

const COOKIE_NAME = 'brand_os_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // one week

function b64urlEncode(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = 4 - (str.length % 4);
  const s = str.replaceAll('-', '+').replaceAll('_', '/') + (pad < 4 ? '='.repeat(pad) : '');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  );
}

async function sign(payload, secret) {
  const key = await hmacKey(secret);
  const bodyJson = JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(bodyJson);
  const bodyB64 = b64urlEncode(bodyBytes);
  const sig = await crypto.subtle.sign('HMAC', key, bodyBytes);
  const sigB64 = b64urlEncode(sig);
  return `${bodyB64}.${sigB64}`;
}

async function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [bodyB64, sigB64] = token.split('.');
  if (!bodyB64 || !sigB64) return null;
  try {
    const key = await hmacKey(secret);
    const bodyBytes = b64urlDecode(bodyB64);
    const sigBytes = b64urlDecode(sigB64);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, bodyBytes);
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(bodyBytes));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(cookieHeader, name = COOKIE_NAME) {
  if (!cookieHeader) return null;
  for (const chunk of cookieHeader.split(';')) {
    const [k, ...rest] = chunk.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function buildSetCookie(value, {
  maxAge = DEFAULT_TTL_SECONDS,
  path = '/',
  name = COOKIE_NAME,
  secure = true,
} = {}) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function buildClearCookie(name = COOKIE_NAME) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  sign,
  verify,
  readCookie,
  buildSetCookie,
  buildClearCookie,
};
