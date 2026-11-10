import type { CriterionId, Rating } from './types';

// Server-side arithmetic after schema/evidence validation (kit integration/scoring.ts).
export const weights: Record<CriterionId, number> = { position: 30, reasoning: 30, structure: 25, delivery: 15 };
export const criterionIds = Object.keys(weights) as CriterionId[];
export const criterionLabels: Record<CriterionId, string> = { position: 'Position', reasoning: 'Reasoning', structure: 'Structure', delivery: 'Delivery' };

export function bandFor(rounded: number) {
  return rounded >= 85 ? 'Strong' : rounded >= 70 ? 'Effective' : rounded >= 50 ? 'Developing' : 'Needs improvement';
}

export function calculateScore(ratings: Pick<Rating, 'id' | 'level'>[]) {
  if (ratings.length !== 4 || new Set(ratings.map(r => r.id)).size !== 4) throw new Error('Four distinct criteria required.');
  for (const r of ratings) {
    if (!criterionIds.includes(r.id) || !Number.isInteger(r.level) || r.level < 0 || r.level > 4) throw new Error('Invalid criterion or level.');
  }
  // Quarter-point arithmetic is exact in binary floating point (multiples of 0.25 up to 100).
  const exact = ratings.reduce((sum, r) => sum + (weights[r.id] * r.level) / 4, 0);
  const rounded = Math.floor(exact + 0.5); // half up, final total only
  const band = bandFor(rounded); // band from the rounded displayed score
  const points = Object.fromEntries(ratings.map(r => [r.id, (weights[r.id] * r.level) / 4])) as Record<CriterionId, number>;
  return { exact, rounded, band, points };
}

export const pointsFor = (id: CriterionId, level: number) => (weights[id] * level) / 4;
