// Renders the fixed setup audio ONCE with APPROVED Nigerian voices:
//   public/media/audio/briefing-t0{1,2,3}.mp3 + .json captions (narrator voice)
//   public/media/audio/chair-introduction.mp3 + .json captions (Ada's voice)
//   public/media/audio/setup-ambience.mp3 (ElevenLabs sound effects, crossfaded into a seamless loop)
// Usage: npx tsx --env-file=.env scripts/audio/generate-static-audio.ts [--only=briefing|chair|ambience] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { topics, chairScript } from '../../shared/content';
import { cuesFromAlignment } from '../../supabase/functions/_shared/captions.ts';

const key = process.env.ELEVENLABS_API_KEY ?? '';
const model = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';
const narrator = process.env.ELEVENLABS_NARRATOR_VOICE_ID ?? '';
const ada = process.env.ELEVENLABS_ADA_VOICE_ID ?? '';
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const force = process.argv.includes('--force');
const dir = path.resolve('public/media/audio');
fs.mkdirSync(dir, { recursive: true });
if (!key) { console.error('ELEVENLABS_API_KEY is required.'); process.exit(1); }

async function speak(text: string, voiceId: string, base: string) {
  const mp3 = path.join(dir, `${base}.mp3`);
  if (fs.existsSync(mp3) && !force) { console.log('exists', base); return; }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
  });
  if (!r.ok) throw new Error(`${base}: TTS failed (${r.status})`);
  const data = await r.json() as { audio_base64: string; alignment: Parameters<typeof cuesFromAlignment>[0] };
  fs.writeFileSync(mp3, Buffer.from(data.audio_base64, 'base64'));
  fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ voiceId, model, cues: cuesFromAlignment(data.alignment) }, null, 1));
  console.log('rendered', base);
}

const AMBIENCE_PROMPT = 'A very quiet, calming outdoor natural atmosphere heard softly through an open window: gentle wind moving through leaves, a soft distant air texture, and only occasional very faint faraway birds. Stable volume and smooth continuous texture. No close chirps, people, voices, traffic, rainstorm, thunder, insects, sudden events, rhythm, melody, musical instruments or dramatic swells. Peaceful unobtrusive backdrop for a student preparing to speak. Seamless loop, no noticeable beginning or ending.';

async function ambience() {
  const out = path.join(dir, 'setup-ambience.mp3');
  if (fs.existsSync(out) && !force) { console.log('exists ambience'); return; }
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: AMBIENCE_PROMPT, duration_seconds: 22, prompt_influence: 0.5 }),
  });
  if (!r.ok) throw new Error(`ambience: sound generation failed (${r.status})`);
  const raw = path.join(dir, 'setup-ambience.raw.mp3');
  fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  // Seamless loop: crossfade the tail into the head (3 s), then normalise to a soft level.
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]).toString());
  const xf = 3;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-filter_complex',
    `[0]atrim=0:${dur - xf},asetpts=PTS-STARTPTS[body];[0]atrim=${dur - xf}:${dur},asetpts=PTS-STARTPTS[tail];[0]atrim=0:${xf},asetpts=PTS-STARTPTS[head];` +
    `[tail][head]acrossfade=d=${xf}:c1=tri:c2=tri[seam];[body]atrim=${xf}:${dur - xf},asetpts=PTS-STARTPTS[mid];[seam][mid]concat=n=2:v=0:a=1,loudnorm=I=-38:TP=-12:LRA=7[out]`,
    '-map', '[out]', '-b:a', '128k', out]);
  fs.unlinkSync(raw);
  console.log('rendered ambience loop');
}

if (!only || only === 'briefing') {
  if (!narrator) throw new Error('ELEVENLABS_NARRATOR_VOICE_ID (approved Nigerian narrator) is required.');
  for (const t of topics) await speak(t.narration, narrator, `briefing-${t.id.toLowerCase()}`);
}
if (!only || only === 'chair') {
  if (!ada) throw new Error('ELEVENLABS_ADA_VOICE_ID (approved) is required.');
  await speak(chairScript, ada, 'chair-introduction');
}
if (!only || only === 'ambience') await ambience();
