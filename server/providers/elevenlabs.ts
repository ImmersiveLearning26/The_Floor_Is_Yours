import { config } from '../config';
import type { Cue } from '../../shared/types';
import type { Transcript } from '../store';
import { ProviderError } from './errors';

const BASE = 'https://api.elevenlabs.io/v1';

export async function transcribe(audio: Buffer, mimeType: string, filename: string): Promise<Transcript> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append('model_id', config.eleven.stt);
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: 'POST', headers: { 'xi-api-key': config.eleven.key }, body: form, signal: AbortSignal.timeout(90000),
  }).catch(e => { throw ProviderError.transport('Transcription', e); });
  if (!res.ok) throw ProviderError.http('Transcription', res.status);
  const data = await res.json() as { text?: string; language_code?: string; words?: { text: string; start: number; end: number; type?: string }[] };
  if (typeof data.text !== 'string' || !Array.isArray(data.words)) throw new ProviderError('Transcription returned an unexpected response.', true);
  const words = data.words.filter(w => (w.type ?? 'word') === 'word' && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map(w => ({ text: w.text, start: w.start, end: w.end }));
  return { text: data.text.trim(), words, languageCode: data.language_code ?? null, provider: `elevenlabs:${config.eleven.stt}` };
}

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

/** Groups character alignment into readable phrase cues (~8–16 words, sentence/comma aware). */
export function cuesFromAlignment(a: Alignment): Cue[] {
  const words: { text: string; start: number; end: number }[] = [];
  let cur = '', start = 0, end = 0;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) words.push({ text: cur, start, end }); cur = ''; return; }
    if (!cur) start = a.character_start_times_seconds[i];
    cur += ch; end = a.character_end_times_seconds[i];
  });
  if (cur) words.push({ text: cur, start, end });
  return groupWords(words);
}

export function groupWords(words: { text: string; start: number; end: number }[]): Cue[] {
  const cues: Cue[] = [];
  let bucket: typeof words = [];
  const flush = () => { if (bucket.length) cues.push({ start: bucket[0].start, end: bucket[bucket.length - 1].end, text: bucket.map(w => w.text).join(' ') }); bucket = []; };
  for (const w of words) {
    bucket.push(w);
    const n = bucket.length;
    if (/[.!?]["”']?$/.test(w.text) && n >= 4) flush();
    else if (/[,;:]$/.test(w.text) && n >= 8) flush();
    else if (n >= 16) flush();
  }
  flush();
  return cues;
}

export async function speakWithTimestamps(text: string, voiceId: string): Promise<{ audio: Buffer; cues: Cue[] }> {
  const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': config.eleven.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: config.eleven.tts, voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(60000),
  }).catch(e => { throw ProviderError.transport('Voice generation', e); });
  if (!res.ok) throw ProviderError.http('Voice generation', res.status);
  const data = await res.json() as { audio_base64?: string; alignment?: Alignment };
  if (!data.audio_base64 || !data.alignment) throw new ProviderError('Voice generation returned no audio.', true);
  return { audio: Buffer.from(data.audio_base64, 'base64'), cues: cuesFromAlignment(data.alignment) };
}
