// TEST ONLY — selected by FIY_AI=stub in the local dev server (scripts/e2e). Never used on Lovable Cloud.
// Deterministic stand-in for the Lovable AI connection so the real pipeline (upload → WAV checks →
// transcript → delivery → judges → validation → code-computed score → voices) can be exercised end to end.
// Outputs are fixtures derived from the recording's duration, not assessments.
import { encodeWav } from '../../supabase/functions/_shared/wav.ts';
import type { Ai } from '../../supabase/functions/_shared/ports.ts';

const TRANSCRIPT = process.env.E2E_TRANSCRIPT ?? 'Universities should allow students to use AI in assignments, as long as they disclose how they used it. First, AI tools can support learning. Second, banning AI is not enforceable. So my recommendation is simple: permit AI with transparent disclosure.';

function fixture(durationSeconds: number) {
  const dur = Math.max(5, Math.min(durationSeconds, 59));
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

/** A quiet tone, so the browser has a real audio clip to play for each judge. */
function tone(seconds: number) {
  const rate = 16000, pcm = new Int16Array(Math.round(seconds * rate));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / rate * 2 * Math.PI * 220) * 600);
  return encodeWav(pcm, rate);
}

export function stubAi(): Ai {
  return {
    status: () => ({ provider: 'test-stub', transcription: true, delivery: true, reasoning: true, voices: true, taskHelp: true }),
    async transcribe({ durationSeconds }) {
      const w = TRANSCRIPT.split(/\s+/), d = Math.min(durationSeconds, 59), step = d / w.length;
      return { text: TRANSCRIPT, languageCode: 'en', provider: 'test-stub', words: w.map((t, i) => ({ text: t, start: +(i * step).toFixed(2), end: +((i + 1) * step - 0.05).toFixed(2) })) };
    },
    async assessDelivery() {
      return { uncertain: false, level: 3, justification: 'Mostly intelligible with a steady, appropriate pace (test fixture).', evidence: [{ start: 1, end: 6, observation: 'Steady pace in the opening (test fixture).' }], model: 'stub-delivery' };
    },
    async judge({ evidence }) { return { output: fixture((evidence as { durationSeconds: number }).durationSeconds), model: 'stub-judges' }; },
    async speak({ text }) { return { audio: tone(Math.max(1.5, text.split(/\s+/).length / 2.6)), mimeType: 'audio/wav', cues: null }; },
    async taskHelp() { return 'You have one speech of up to 60 seconds (test fixture).'; },
  };
}
