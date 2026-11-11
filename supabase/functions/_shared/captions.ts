import type { Cue } from './types.ts';

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

/** Groups character alignment (as returned by some TTS engines) into readable phrase cues. */
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

/** Phrase cues of ~8–16 words, sentence and comma aware. */
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

/** When the voice engine gives no timings: spread the words evenly over the clip (or ~2.6 words/s). */
export function evenCues(text: string, durationSeconds: number | null): Cue[] {
  const w = text.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return [];
  const total = durationSeconds && durationSeconds > 0 ? durationSeconds : w.length / 2.6;
  const step = total / w.length;
  return groupWords(w.map((t, i) => ({ text: t, start: Number((i * step).toFixed(2)), end: Number(((i + 1) * step).toFixed(2)) })));
}
