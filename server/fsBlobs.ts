// Local development file storage with short-lived signed URLs (/api/files/<token>), mirroring
// Lovable Cloud Storage signed URLs so the browser code is identical in both places.
import fs from 'node:fs';
import path from 'node:path';
import type { Blobs } from '../supabase/functions/_shared/ports.ts';

export function fsBlobs(dir: string, sign: (v: string) => string, verify: (s: string) => string | null) {
  const full = (p: string) => {
    const f = path.resolve(dir, p);
    if (!f.startsWith(path.resolve(dir) + path.sep)) throw new Error('bad path');
    return f;
  };
  const blobs: Blobs = {
    async put(p, bytes) { const f = full(p); await fs.promises.mkdir(path.dirname(f), { recursive: true }); await fs.promises.writeFile(f, bytes, { mode: 0o600 }); },
    async get(p) { try { return new Uint8Array(await fs.promises.readFile(full(p))); } catch { return null; } },
    async remove(p) { await fs.promises.unlink(full(p)).catch(() => {}); },
    async signedUrl(p, ttl, downloadName) {
      if (!fs.existsSync(full(p))) return null;
      const payload = Buffer.from(JSON.stringify({ p, e: Date.now() + ttl * 1000, d: downloadName ?? null })).toString('base64url');
      return `/api/files/${sign(payload)}`;
    },
  };
  /** Serve a signed URL; null when the token is invalid or expired. */
  async function serve(token: string): Promise<Response | null> {
    const payload = verify(token);
    if (!payload) return null;
    const { p, e, d } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { p: string; e: number; d: string | null };
    if (Date.now() > e) return null;
    const bytes = await blobs.get(p);
    if (!bytes) return null;
    const type = p.endsWith('.wav') ? 'audio/wav' : p.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
    return new Response(bytes as unknown as BodyInit, { headers: { 'content-type': type, 'cache-control': 'private, no-store', ...(d ? { 'content-disposition': `attachment; filename="${d.replace(/[^\w.-]/g, '')}"` } : {}) } });
  }
  return { blobs, serve };
}
