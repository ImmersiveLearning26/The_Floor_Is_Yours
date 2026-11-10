import Ajv from 'ajv/dist/2020';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config';
import type { CriterionId, FeedbackTurn, JudgeId, Rating } from '../shared/types';

export const judgementSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'assessment.schema.json'), 'utf8'));
// Anthropic tool input_schema must not carry $schema/title keys.
export const toolSchema = (() => { const { $schema: _s, title: _t, ...rest } = judgementSchema; return rest; })();

const ajv = new Ajv({ allErrors: true });
const check = ajv.compile(judgementSchema);

export type ModelJudgement = {
  needsReview: boolean; reviewReason: string | null; ratings: Rating[];
  strength: string; improvement: string; turns: FeedbackTurn[];
};

const norm = (s: string) => s.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const ORDER: JudgeId[] = ['ada', 'tunde', 'zainab'];
const CONTENT: CriterionId[] = ['position', 'reasoning', 'structure'];

/**
 * Validates a model judgement. Returns errors (empty = valid). In complete mode it enforces:
 * schema shape, exactly the three content criteria from the model (delivery comes only from the
 * trusted assessor), integer levels, quote membership in the transcript, timestamp bounds,
 * transcript-sourced content evidence, three distinct judges in order and non-empty texts.
 */
export function validateJudgement(raw: unknown, ctx: { transcript: string; duration: number }): { errors: string[]; value: ModelJudgement | null } {
  if (!check(raw)) return { errors: (check.errors ?? []).map(e => `${e.instancePath || 'root'} ${e.message}`), value: null };
  const j = raw as unknown as ModelJudgement;
  const errors: string[] = [];
  if (j.needsReview) return { errors, value: j };
  const content = j.ratings.filter(r => r.id !== 'delivery');
  const ids = content.map(r => r.id);
  if (content.length !== 3 || new Set(ids).size !== 3 || !CONTENT.every(id => ids.includes(id))) errors.push('ratings must contain exactly position, reasoning and structure once each (delivery is supplied by the trusted audio assessor)');
  const transcript = norm(ctx.transcript);
  for (const r of content) {
    if (!r.justification.trim()) errors.push(`${r.id}: empty justification`);
    for (const e of r.evidence) {
      if (e.source !== 'transcript') errors.push(`${r.id}: content evidence must come from the transcript`);
      if (!(e.end > e.start) || e.start < 0 || e.end > ctx.duration + 0.25) errors.push(`${r.id}: evidence ${e.start}-${e.end}s is outside this ${ctx.duration.toFixed(1)}s recording`);
      if (e.quote && !transcript.includes(norm(e.quote))) errors.push(`${r.id}: quote "${e.quote.slice(0, 60)}" is not in the transcript`);
      if (!e.observation.trim()) errors.push(`${r.id}: empty observation`);
    }
  }
  const turnIds = j.turns.map(t => t.judgeId);
  if (j.turns.length !== 3 || turnIds.join() !== ORDER.join()) errors.push('turns must be exactly ada, tunde, zainab in that order');
  if (j.turns.some(t => !t.text.trim())) errors.push('turn text must not be empty');
  if (j.turns.some(t => /\b\d{1,3}\s*(\/|out of)\s*100\b|\blevel\s*[0-4]\b/i.test(t.text))) errors.push('turns must not mention numerical scores or levels');
  if (!j.strength.trim() || !j.improvement.trim()) errors.push('strength and improvement are required');
  return { errors, value: errors.length ? null : j };
}

/** Delivery evidence must be audio-sourced and inside the recording. */
export function validateDelivery(r: Rating, duration: number): string[] {
  const errors: string[] = [];
  if (r.id !== 'delivery') errors.push('delivery rating id mismatch');
  if (!Number.isInteger(r.level) || r.level < 0 || r.level > 4) errors.push('delivery level out of range');
  if (!r.evidence.length || !r.evidence.every(e => e.source === 'audio')) errors.push('delivery requires audio evidence');
  for (const e of r.evidence) if (!(e.end > e.start) || e.start < 0 || e.end > duration + 0.25) errors.push('delivery evidence outside recording');
  return errors;
}
