// Local development identity: an anonymous learner id in a signed httpOnly cookie.
// (On Lovable Cloud the learner is an anonymous Supabase user instead — see supabase/functions/api.)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function cookieIdentity(dataDir: string, secure: boolean) {
  const f = path.join(dataDir, '.session-secret');
  let secret = (process.env.SESSION_SECRET ?? '').trim();
  if (!secret) {
    try { secret = fs.readFileSync(f, 'utf8').trim(); } catch {
      secret = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(f, secret, { mode: 0o600 });
    }
  }
  const sign = (v: string) => `${v}.${crypto.createHmac('sha256', secret).update(v).digest('base64url')}`;
  const verify = (signed: string | undefined) => {
    if (!signed) return null;
    const i = signed.lastIndexOf('.');
    if (i < 1) return null;
    const v = signed.slice(0, i), a = Buffer.from(sign(v)), b = Buffer.from(signed);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
  };
  const read = (req: Request, name: string) => {
    for (const part of (req.headers.get('cookie') ?? '').split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  };
  return {
    sign, verify,
    async learner(req: Request) {
      const id = verify(read(req, 'fiy_sid'));
      if (id) return { id };
      const fresh = `lrn_${crypto.randomBytes(9).toString('base64url')}`;
      return { id: fresh, setCookie: `fiy_sid=${encodeURIComponent(sign(fresh))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${secure ? '; Secure' : ''}` };
    },
  };
}
