// Brand OS — Vercel Blob client-upload token endpoint.
//
// The browser calls @vercel/blob/client's upload() and passes
// handleUploadUrl: '/api/brand-os/blob-token'. This route hands back a
// short-lived, single-file upload token; the browser then uploads DIRECTLY
// to Blob storage — no bytes flow through this serverless function, so we
// bypass Vercel's 4 MB body-size limit.
//
// Path constraint: uploads must land under brand-os/... — we reject any
// other prefix so callers can't scribble over unrelated blobs.

import { handleUpload } from '@vercel/blob/client';
import { verify, readCookie } from '../../lib/brand-os-auth.js';

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB per file

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/zip', 'application/x-zip-compressed',
  'text/markdown', 'text/plain', 'text/html',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(500).json({ error: 'AUTH_SECRET not configured' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Vercel Blob storage not configured. Add a Blob store in Vercel → Storage.' });
  }

  const payload = await verify(readCookie(req.headers.cookie || ''), secret);
  if (!payload) return res.status(401).json({ error: 'Not signed in' });

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('brand-os/')) {
          throw new Error('Invalid upload path — must live under brand-os/');
        }
        // Admin can upload anywhere under brand-os/; clients only under their own brand.
        if (payload.role !== 'admin') {
          const expectedPrefix = `brand-os/refs/${payload.slug}/`;
          const assetsPrefix   = `brand-os/assets/${payload.slug}/`;
          if (!pathname.startsWith(expectedPrefix) && !pathname.startsWith(assetsPrefix)) {
            throw new Error('Clients may only upload under their own brand path');
          }
        }
        return {
          allowedContentTypes: ALLOWED_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_BYTES,
        };
      },
      onUploadCompleted: async () => {
        // Optional: log to KV / analytics. No-op for v1.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
