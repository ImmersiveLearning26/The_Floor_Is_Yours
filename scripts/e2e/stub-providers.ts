// TEST ONLY — loaded with `tsx --import` by scripts/e2e/run.mjs, never by the application.
// Replaces provider HTTP calls (ElevenLabs, Gemini, Anthropic) with deterministic local responses so the
// real server pipeline (upload → decode → transcript → delivery → reasoning → validation → scoring →
// voicing) can be exercised end to end without credentials. Outputs are derived from the actual audio's
// duration and a fixed test transcript; they are fixtures, not assessments.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TRANSCRIPT = process.env.E2E_TRANSCRIPT ?? 'Universities should allow students to use AI in assignments, as long as they disclose how they used it. First, AI tools can support learning. Second, banning AI is not enforceable. So my recommendation is simple: permit AI with transparent disclosure.';
const realFetch = globalThis.fetch;

function fixture(ev: { durationSeconds: number }) {
    const dur = Math.max(5, Math.min(ev.durationSeconds, 59));
  return {
      needsReview: false, reviewReason: null,
      ratings: [
        { id: 'position', level: 3, justification: 'Explicit, early stance that is sustained (test fixture).', evidence: [{ start: 0, end: Math.min(4, dur), quote: 'allow students to use AI in assignments', observation: 'Position stated in the first sentence.', source: 'transcript' }] },
        { id: 'reasoning', level: 2, justification: 'Two reasons, briefly developed (test fixture).', evidence: [{ start: dur * 0.3, end: dur * 0.5, quote: 'AI tools can support learning', observation: 'First reason given without explaining the link.', source: 'transcript' }] },
        { id: 'structure', level: 4, justification: 'Signposted sequence and reinforcing close (test fixture).', evidence: [{ start: dur * 0.8, end: dur, quote: 'So my recommendation is simple', observation: 'Clear concluding signpost.', source: 'transcript' }] },
      ],
      strength: 'Clear, logical structure (test fixture).',
      improvement: 'Explain why each reason supports your position (test fixture).',
      turns: [
        { judgeId: 'ada', text: 'Your position was clear: allow AI with disclosure. Explain how that safeguard would work.' },
        { judgeId: 'tunde', text: 'You signposted with first and second, and your close restated the recommendation.' },
        { judgeId: 'zainab', text: 'Your pace was steady. Next time, link each reason back to your position.' },
      ],
  };
}


function words(text: string, duration: number) {
  const w = text.split(/\s+/);
  const step = duration / w.length;
  return w.map((t, i) => ({ text: t, start: +(i * step).toFixed(2), end: +((i + 1) * step - 0.05).toFixed(2), type: 'word' }));
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('api.elevenlabs.io/v1/speech-to-text')) {
    const form = init?.body as FormData;
    const file = form.get('file') as Blob;
    const tmp = path.join(os.tmpdir(), `e2e-${Date.now()}.webm`);
    fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
    let duration = 30;
    try { duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).toString()) || 30; } catch { /* keep */ }
    fs.unlinkSync(tmp);
    const d = Math.min(duration, 59);
    return json({ text: TRANSCRIPT, language_code: 'eng', words: words(TRANSCRIPT, d) });
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ uncertain: false, level: 3, justification: 'Mostly intelligible with a steady, appropriate pace (test fixture).', evidence: [{ start: 1, end: 6, observation: 'Steady pace in the opening (test fixture).' }] }) }] } }] });
  }
  if (url.includes('/judge-reasoning')) {
    // Lovable edge function stand-in: OpenAI-style chat completions with a forced tool call
    const body = JSON.parse(String(init?.body ?? '{}'));
    if ((init?.headers as Record<string, string>)?.['x-fiy-secret'] !== process.env.LOVABLE_FUNCTION_SECRET) return new Response('forbidden', { status: 403 });
    if (!body.tools) return json({ model: body.model, choices: [{ message: { content: 'You have one speech of up to 60 seconds (test fixture).' } }] });
    const ev = JSON.parse(body.messages[1].content);
    const out = fixture(ev);
    return json({ model: body.model, choices: [{ message: { content: null, tool_calls: [{ type: 'function', function: { name: 'submit_assessment', arguments: JSON.stringify(out) } }] } }] });
  }
  if (url.includes('/v1/messages')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (!body.tools) return json({ model: 'stub', content: [{ type: 'text', text: 'You have one speech of up to 60 seconds (test fixture).' }] });
    const ev = JSON.parse(body.messages[0].content);
    return json({ model: 'stub-reasoner', content: [{ type: 'tool_use', name: 'submit_assessment', input: fixture(ev) }] });
  }
  if (false) {
    const ev = { durationSeconds: 30 };
    return json({});
  }
  if (url.includes('api.elevenlabs.io/v1/text-to-speech')) {
    const { text } = JSON.parse(String(init?.body ?? '{}'));
    const base = path.join(os.tmpdir(), `e2e-tts-${Date.now()}`);
    execFileSync('say', ['-o', `${base}.aiff`, text]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.aiff`, '-b:a', '64k', `${base}.mp3`]);
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${base}.mp3`]).toString());
    const audio = fs.readFileSync(`${base}.mp3`).toString('base64');
    const chars = [...text]; const step = dur / chars.length;
    return json({ audio_base64: audio, alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * step), character_end_times_seconds: chars.map((_, i) => (i + 1) * step) } });
  }
  return realFetch(input as RequestInfo, init);
};
console.log('[e2e] provider stubs active (TEST ONLY)');
