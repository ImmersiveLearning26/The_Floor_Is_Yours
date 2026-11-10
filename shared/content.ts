import type { Judge, Topic } from './types';

// Exact strings from the handoff kit (replication/shared/content.ts, production/ELEVENLABS_AUDIO.md).
export const judges: Judge[] = [
  { id: 'ada', name: 'Ada', role: 'Argument', focus: 'Position & reasoning', image: '/media/judges/ada.webp' },
  { id: 'tunde', name: 'Tunde', role: 'Structure', focus: 'Organisation', image: '/media/judges/tunde.webp' },
  { id: 'zainab', name: 'Zainab', role: 'Delivery', focus: 'Delivery & next step', image: '/media/judges/zainab.webp' },
];

export const topics: Topic[] = [
  {
    id: 'T01', label: 'Social media during live lectures',
    question: 'Should social media be restricted during live online university lectures?',
    boundary: 'Consider scheduled online lectures and personal devices, not a ban on private social media use.',
    narration: 'Our university teaches online. During a live lecture, the same device that connects a student to learning can also open a stream of notifications. The academic board is considering whether social media use should be restricted during scheduled live sessions. Some argue this protects concentration; others say open-university learners need flexibility and digital autonomy. You have sixty seconds to recommend a position. Make your case.',
    image: '/media/briefing/t01.webp', audio: '/media/audio/briefing-t01.mp3', captions: '/media/audio/briefing-t01.json',
  },
  {
    id: 'T02', label: 'AI in assignments',
    question: 'Should university students be allowed to use AI for assignments?',
    boundary: 'Consider permission and safeguards for academic work, including conditional use with disclosure.',
    narration: 'Generative AI is becoming part of how students study and write. Our academic committee must decide what role it should have in assignments. Some see an opportunity for learning support; others see risks to independent thinking and academic integrity. You have sixty seconds to recommend a policy that is educationally defensible. Make your case.',
    image: '/media/briefing/t02.webp', audio: '/media/audio/briefing-t02.mp3', captions: '/media/audio/briefing-t02.json',
  },
  {
    id: 'T03', label: 'Compulsory live attendance',
    question: 'Should attendance at live online lectures be compulsory?',
    boundary: 'Compare live virtual attendance with recordings and accessible asynchronous alternatives.',
    narration: 'This university was designed for flexible online learning. Students can attend live sessions, but many also depend on recordings because of work, family or connectivity. Management is considering compulsory attendance at live online lectures. Supporters expect more participation; critics question whether attendance measures learning. You have sixty seconds to advise the academic panel. Make your case.',
    image: '/media/briefing/t03.webp', audio: '/media/audio/briefing-t03.mp3', captions: '/media/audio/briefing-t03.json',
  },
];

export const chairScript = 'Welcome. We have invited you to present your position on the issue you selected. We will assess how clearly you make your case, not which side you take. State your position, support it with reasons, and bring your argument to a clear close. You have sixty seconds. Begin when you are ready.';
export const chairAudio = { audio: '/media/audio/chair-introduction.mp3', captions: '/media/audio/chair-introduction.json' };
export const ambienceAudio = '/media/audio/setup-ambience.mp3';

export const topicById = (id: string | null | undefined) => topics.find(t => t.id === id) ?? null;
export const judgeById = (id: string | null | undefined) => judges.find(j => j.id === id) ?? null;

export const MAX_SECONDS = 60;
export const RUBRIC_VERSION = '1.0';
