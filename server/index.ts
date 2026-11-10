import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT, capabilities } from './config';
import { store, RECORDINGS_DIR } from './store';
import { learnerSession } from './session';
import { api } from './routes';
import { facilitator } from './facilitator';
import { resumeInterruptedJobs } from './assessment';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true, capabilities: capabilities() }));
app.use('/api/facilitator', facilitator);
app.get('/facilitator', (_req, res) => res.sendFile(path.join(ROOT, 'server', 'facilitator.html')));
app.use('/api', learnerSession, api);

if (config.production) {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Institution retention: delete recording audio older than RECORDING_RETENTION_DAYS (metadata and audit stay).
function retentionSweep() {
  const days = config.retentionDays;
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 86400_000;
  for (const rec of Object.values(store.db.recordings)) {
    if (Date.parse(rec.createdAt) < cutoff) {
      const f = path.join(RECORDINGS_DIR, rec.file);
      if (fs.existsSync(f)) { fs.unlinkSync(f); void store.audit({ runId: rec.runId, learnerId: rec.learnerId, actor: 'system', event: 'recording.deleted-retention' }); }
    }
  }
}
setInterval(retentionSweep, 3600_000).unref();
retentionSweep();

app.listen(config.port, () => {
  const c = capabilities();
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] reasoning=${c.reasoning} transcription=${c.transcription} delivery=${c.delivery} voices=${c.voices} reviewQueue=${c.reviewQueue}`);
  resumeInterruptedJobs();
});
