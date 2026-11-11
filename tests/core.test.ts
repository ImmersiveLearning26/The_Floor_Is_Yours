import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, bandFor } from '../supabase/functions/_shared/scoring.ts';
import { validateJudgement, validateDelivery } from '../supabase/functions/_shared/validate.ts';
import { cuesFromAlignment, groupWords, evenCues } from '../supabase/functions/_shared/captions.ts';
import { answerFromGuide } from '../supabase/functions/_shared/taskGuide.ts';
import { encodeWav, parseWav, trimWav, peakDb } from '../supabase/functions/_shared/wav.ts';
import type { Rating } from '../supabase/functions/_shared/types.ts';

const r = (id: Rating['id'], level: number) => ({ id, level } as Rating);

test('documentation arithmetic: 3/2/4/3 → 73.75 → 74 Effective', () => {
  const s = calculateScore([r('position', 3), r('reasoning', 2), r('structure', 4), r('delivery', 3)]);
  assert.equal(s.exact, 73.75); assert.equal(s.rounded, 74); assert.equal(s.band, 'Effective');
});
test('4/4/4/4 → 100 Strong; 0/0/0/0 → 0 Needs improvement', () => {
  assert.deepEqual([calculateScore(['position', 'reasoning', 'structure', 'delivery'].map(id => r(id as Rating['id'], 4))).rounded, 'Strong'], [100, 'Strong']);
  assert.equal(calculateScore(['position', 'reasoning', 'structure', 'delivery'].map(id => r(id as Rating['id'], 0))).band, 'Needs improvement');
});
test('band derives from rounded score at boundaries (84.5 → 85 Strong, 69.5 → 70, 49.5 → 50)', () => {
  // position 4 (30) + reasoning 4 (30) + structure 3 (18.75) + delivery 2 (7.5) = 86.25
  assert.equal(bandFor(Math.floor(84.5 + 0.5)), 'Strong');
  assert.equal(bandFor(Math.floor(69.5 + 0.5)), 'Effective');
  assert.equal(bandFor(Math.floor(49.5 + 0.5)), 'Developing');
  assert.equal(bandFor(84), 'Effective'); assert.equal(bandFor(69), 'Developing'); assert.equal(bandFor(49), 'Needs improvement');
  const s = calculateScore([r('position', 3), r('reasoning', 3), r('structure', 3), r('delivery', 2)]); // 22.5+22.5+18.75+7.5 = 71.25
  assert.equal(s.rounded, 71);
});
test('rejects duplicate criteria, missing criteria and out-of-range levels', () => {
  assert.throws(() => calculateScore([r('position', 3), r('position', 2), r('structure', 4), r('delivery', 3)]));
  assert.throws(() => calculateScore([r('position', 3), r('reasoning', 2), r('structure', 4)]));
  assert.throws(() => calculateScore([r('position', 5), r('reasoning', 2), r('structure', 4), r('delivery', 3)]));
  assert.throws(() => calculateScore([r('position', 2.5), r('reasoning', 2), r('structure', 4), r('delivery', 3)]));
});

const transcript = 'Universities should allow students to use AI in assignments, as long as they disclose how they used it. First, AI tools can support learning.';
const ev = (quote: string | null, start = 0.5, end = 4, source: 'transcript' | 'audio' = 'transcript') => [{ start, end, quote, observation: 'Observed.', source }];
const good = () => ({
  needsReview: false, reviewReason: null,
  ratings: [
    { id: 'position', level: 3, evidence: ev('allow students to use AI in assignments'), justification: 'Explicit early stance.' },
    { id: 'reasoning', level: 2, evidence: ev('AI tools can support learning', 6, 9), justification: 'One developed reason.' },
    { id: 'structure', level: 3, evidence: ev(null, 0, 10), justification: 'Signposted sequence.' },
  ],
  strength: 'Clear early position.', improvement: 'Explain why each reason supports the position.',
  turns: [{ judgeId: 'ada', text: 'Your stance was clear.' }, { judgeId: 'tunde', text: 'You signposted with "first".' }, { judgeId: 'zainab', text: 'Your pace was steady; next, link each reason.' }],
});

test('valid judgement passes', () => {
  const v = validateJudgement(good(), { transcript, duration: 40 });
  assert.deepEqual(v.errors, []);
});
test('fabricated quote is rejected', () => {
  const j = good(); j.ratings[0].evidence = ev('students must be banned from AI');
  assert.ok(validateJudgement(j, { transcript, duration: 40 }).errors.some((e: string) => e.includes('not in the transcript')));
});
test('out-of-bounds timestamp is rejected', () => {
  const j = good(); j.ratings[1].evidence = ev(null, 55, 59);
  assert.ok(validateJudgement(j, { transcript, duration: 40 }).errors.some((e: string) => e.includes('outside')));
});
test('duplicate criterion and wrong judge order are rejected', () => {
  const j = good(); j.ratings[2] = { ...j.ratings[0] };
  assert.ok(validateJudgement(j, { transcript, duration: 40 }).errors.length > 0);
  const k = good(); k.turns = [k.turns[1], k.turns[0], k.turns[2]];
  assert.ok(validateJudgement(k, { transcript, duration: 40 }).errors.some((e: string) => e.includes('order')));
});
test('model cannot supply delivery from transcript or mention scores', () => {
  const j = good(); j.ratings[2].evidence = ev(null, 0, 10, 'audio');
  assert.ok(validateJudgement(j, { transcript, duration: 40 }).errors.some((e: string) => e.includes('must come from the transcript')));
  const k = good(); k.turns[0].text = 'That earns you 74/100.';
  assert.ok(validateJudgement(k, { transcript, duration: 40 }).errors.some((e: string) => e.includes('numerical')));
});
test('invalid schema (level 7, extra field) is rejected', () => {
  const j = good() as Record<string, unknown> & ReturnType<typeof good>; j.ratings[0].level = 7; (j as Record<string, unknown>).score = 100;
  assert.ok(validateJudgement(j, { transcript, duration: 40 }).errors.length > 0);
});
test('needsReview passes through without a publishable score', () => {
  const v = validateJudgement({ needsReview: true, reviewReason: 'Delivery evidence missing', ratings: [], strength: '', improvement: '', turns: [] }, { transcript, duration: 40 });
  assert.equal(v.value?.needsReview, true);
});
test('delivery requires audio evidence inside the recording', () => {
  const d: Rating = { id: 'delivery', level: 3, justification: 'x', evidence: ev(null, 1, 5, 'transcript') };
  assert.ok(validateDelivery(d, 40).some((e: string) => e.includes('audio')));
  const ok: Rating = { id: 'delivery', level: 3, justification: 'x', evidence: ev(null, 1, 5, 'audio') };
  assert.deepEqual(validateDelivery(ok, 40), []);
  assert.ok(validateDelivery({ ...ok, evidence: ev(null, 50, 61, 'audio') }, 60).length > 0);
});
test('captions group into readable phrases', () => {
  const text = 'Your position was clear: allow AI with disclosure. Explain how that safeguard would work in practice for every assignment.';
  const chars = [...text]; const t = chars.map((_, i) => i * 0.05);
  const cues = cuesFromAlignment({ characters: chars, character_start_times_seconds: t, character_end_times_seconds: t.map(x => x + 0.05) });
  assert.ok(cues.length >= 2);
  assert.equal(cues.map((c: { text: string }) => c.text).join(' '), text);
  assert.ok(cues.every((c: { text: string }) => c.text.split(' ').length <= 16));
  assert.equal(groupWords([]).length, 0);
});
test('task guide refuses to write the argument', () => {
  assert.match(answerFromGuide('Can you write my argument for me?', null), /can’t suggest/);
  assert.match(answerFromGuide('Which side is best?', null), /can’t suggest/);
});

test('even captions cover the text when the voice engine gives no timings', () => {
  const cues = evenCues('One two three four. Five six seven eight nine ten.', 5);
  assert.equal(cues.map(c => c.text).join(' '), 'One two three four. Five six seven eight nine ten.');
  assert.ok(Math.abs(cues[cues.length - 1].end - 5) < 0.01);
});
test('WAV: parse, server-side trim to 60.0 s, peak level', () => {
  const rate = 16000, pcm = new Int16Array(rate * 62);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 20) * 16384);
  const wav = encodeWav(pcm, rate);
  const info = parseWav(wav)!;
  assert.equal(info.sampleRate, 16000); assert.equal(info.channels, 1); assert.equal(info.duration, 62);
  const cut = trimWav(wav, info, 60);
  assert.equal(parseWav(cut)!.duration, 60);
  assert.ok(Math.abs(peakDb(wav, info) - -6.0) < 0.2);
  assert.equal(peakDb(encodeWav(new Int16Array(1600), rate), parseWav(encodeWav(new Int16Array(1600), rate))!), -120);
  assert.equal(parseWav(new TextEncoder().encode('not a wav file at all, definitely not')), null);
});
