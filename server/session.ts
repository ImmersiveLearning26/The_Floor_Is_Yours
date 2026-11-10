import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { config, DATA_DIR } from './config';
import { store, newId, now } from './store';

// Anonymous learner identity (httpOnly signed cookie). The typed display name is NOT identity.
function loadSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  const f = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const sign = (v: string) => `${v}.${crypto.createHmac('sha256', SECRET).update(v).digest('base64url')}`;
function verify(signed: string | undefined) {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const v = signed.slice(0, i);
  const a = Buffer.from(sign(v)), b = Buffer.from(signed);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
}
export function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
export function setCookie(res: Response, name: string, value: string, maxAgeDays = 180) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(sign(value))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}${config.production ? '; Secure' : ''}`);
}
export const verifiedCookie = (req: Request, name: string) => verify(readCookie(req, name));

declare module 'express-serve-static-core' { interface Request { learnerId: string } }

export function learnerSession(req: Request, res: Response, next: NextFunction) {
  let id = verifiedCookie(req, 'fiy_sid');
  if (!id || !store.db.learners[id]) {
    id = newId('lrn');
    store.db.learners[id] = { id, displayName: '', createdAt: now() };
    void store.save();
    setCookie(res, 'fiy_sid', id);
  }
  req.learnerId = id;
  next();
}
