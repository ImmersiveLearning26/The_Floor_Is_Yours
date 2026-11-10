// Lists Nigerian-English candidate voices from the ElevenLabs shared library and renders a short
// sample line for each, so a person can LISTEN and approve voices. Names/labels in the catalogue do
// not guarantee an accent — approval is by ear only.
// Usage: ELEVENLABS_API_KEY=... npx tsx scripts/audio/audition-voices.ts
import fs from 'node:fs';
import path from 'node:path';

const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Set ELEVENLABS_API_KEY (server-side key).'); process.exit(1); }
const out = path.resolve('docs/voice-audition');
fs.mkdirSync(out, { recursive: true });
const SAMPLE = 'Welcome. We will assess how clearly you make your case, not which side you take.';

type Shared = { voice_id: string; public_owner_id: string; name: string; accent?: string; gender?: string; age?: string; description?: string; preview_url?: string };
const res = await fetch('https://api.elevenlabs.io/v1/shared-voices?page_size=100&search=nigerian', { headers: { 'xi-api-key': key } });
if (!res.ok) { console.error(`Voice library request failed (${res.status}).`); process.exit(1); }
const { voices } = await res.json() as { voices: Shared[] };
const rows: string[] = ['| Name | Gender | Age | Accent | voice_id | owner | preview |', '|---|---|---|---|---|---|---|'];
for (const v of voices) rows.push(`| ${v.name} | ${v.gender ?? ''} | ${v.age ?? ''} | ${v.accent ?? ''} | ${v.voice_id} | ${v.public_owner_id} | ${v.preview_url ?? ''} |`);
fs.writeFileSync(path.join(out, 'candidates.md'), `# Nigerian voice candidates (unapproved)\n\nListen to each preview. Roles: narrator (female, distinct from Ada), Ada (~40 F), Tunde (~45 M), Zainab (~35 F).\nTo use a shared voice, add it to your library in ElevenLabs, then put the resulting voice IDs in .env.\n\n${rows.join('\n')}\n`);
console.log(`Wrote ${voices.length} candidates to docs/voice-audition/candidates.md`);

// Optional: render the sample line with voices already in your own library (by ID list).
const ids = (process.env.AUDITION_VOICE_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
for (const id of ids) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text: SAMPLE, model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2' }) });
  if (r.ok) { fs.writeFileSync(path.join(out, `${id}.mp3`), Buffer.from(await r.arrayBuffer())); console.log('sample', id); }
  else console.warn(`sample failed for ${id} (${r.status})`);
}
