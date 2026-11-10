// Written task guide used when no AI reasoning service is configured (or it fails).
// Deterministic clarification of the task rules only; it never supplies an argument or stance.
const entries: { match: RegExp; answer: string }[] = [
  { match: /\b(write|draft|outline|give me|suggest|what should i (say|argue)|which side|best (side|answer|argument)|example (speech|argument))\b/i,
    answer: 'I can’t suggest what to argue or which side to take — the panel assesses how clearly you make your own case. State your position, give your reasons, and close clearly.' },
  { match: /\b(score|mark|grade|rubric|assess|weight|points?)\b/i,
    answer: 'You are assessed on Position (30), Reasoning (30), Structure (25) and Delivery (15). Either side can earn full marks, accent is not penalised, and statistics or named citations are not required.' },
  { match: /\b(time|long|seconds?|minute|60|stop|early)\b/i,
    answer: 'You have one speech of up to 60 seconds. Recording stops automatically at 60 seconds, and finishing early is not penalised.' },
  { match: /\b(again|retake|redo|retry|practice|another|second)\b/i,
    answer: 'Each run has exactly one assessed speech. Only a technical recording failure allows a replacement capture.' },
  { match: /\b(mic|microphone|hear|sound|audio|headphone|record)\b/i,
    answer: 'Use the microphone check before you begin. Say a few words so the meter moves; headphones help avoid echo. If your microphone is blocked, allow it in your browser’s site settings and test again.' },
  { match: /\b(judge|panel|ada|tunde|zainab|who)\b/i,
    answer: 'The panel is three AI judges: Ada considers your position and reasoning, Tunde your structure, and Zainab your delivery and one next step. They are AI, not people watching live.' },
  { match: /\b(topic|issue|change|switch|choose)\b/i,
    answer: 'Your issue is locked once the briefing opens, so the run stays fair. You can choose another issue after this run is finished.' },
  { match: /\b(privacy|data|kept|store|delete|retention)\b/i,
    answer: 'Your one speech is recorded only after you agree, then transcribed and assessed. The recording policy panel in the menu shows how long it is kept and who receives it.' },
];

export function answerFromGuide(question: string, topicQuestion: string | null) {
  const hit = entries.find(e => e.match.test(question));
  if (hit) return hit.answer;
  return `This task asks you to answer ${topicQuestion ? `“${topicQuestion}”` : 'one issue'} in a single speech of up to 60 seconds: state your position, support it with reasons, and close clearly. Ask about timing, the panel, assessment or your microphone if you need more detail.`;
}
