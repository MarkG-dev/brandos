// Brand OS — output persistence (the brand's living archive).
//
// Storage: Vercel Blob.
//   Records: brand-os/outputs/<slug>/records/<id>.json
//   Images:  brand-os/outputs/<slug>/images/<id>.jpg
//
// Record shape:
//   { id, ts, type: "copy" | "image", preset, model,
//     author,                    // session slug or "__admin__"
//     // copy:
//     source?, text?, wordCount?,
//     // image:
//     prompt?, aspect?, imageUrl?, sourceUrl?, hosted? }
//
// One JSON per output — no shared index file, so concurrent saves never
// clobber each other (unlike the usage rollup).

import { put, list } from '@vercel/blob';

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function recordPath(slug, id) { return `brand-os/outputs/${slug}/records/${id}.json`; }
function imagePath(slug, id, ext) { return `brand-os/outputs/${slug}/images/${id}.${ext}`; }

// Persist a copywriter output. Fire-and-forget safe.
export async function saveCopyOutput(slug, meta) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const id = newId();
  const record = { id, ts: new Date().toISOString(), type: 'copy', ...meta };
  await put(recordPath(slug, id), JSON.stringify(record), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return record;
}

// Persist an art-director output. Re-hosts the image bytes into Blob when
// rehost=true (Magnific URLs eventually expire); falls back to recording
// the source URL if the copy fails or is skipped.
export async function saveImageOutput(slug, meta, { rehost = true } = {}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const id = newId();
  let imageUrl = meta.sourceUrl;
  let hosted = false;

  if (rehost && meta.sourceUrl) {
    try {
      const r = await fetch(meta.sourceUrl);
      if (r.ok) {
        const contentType = r.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png'
          : contentType.includes('webp') ? 'webp' : 'jpg';
        const bytes = await r.arrayBuffer();
        const blob = await put(imagePath(slug, id, ext), Buffer.from(bytes), {
          access: 'public',
          contentType,
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        imageUrl = blob.url;
        hosted = true;
      }
    } catch (e) {
      console.error('output image rehost failed:', e.message);
    }
  }

  const record = {
    id, ts: new Date().toISOString(), type: 'image',
    ...meta, imageUrl, hosted,
  };
  await put(recordPath(slug, id), JSON.stringify(record), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return record;
}

// List output records for a brand, newest first.
export async function listOutputs(slug, { limit = 60 } = {}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const l = await list({ prefix: `brand-os/outputs/${slug}/records/`, limit: 1000 });
  const blobs = l.blobs
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .slice(0, limit);

  const records = await Promise.all(blobs.map(async (b) => {
    try {
      const r = await fetch(b.url, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }));
  return records.filter(Boolean);
}
