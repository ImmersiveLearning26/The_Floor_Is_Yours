import { JudgeRow, Pill, Rise, Scene, Wave } from '../ui/UI';
import type { Topic } from '../../shared/types';

/** Speaking: the panel listening, the question as a whisper, one recording pill. Nothing to press. */
export function P05Recording({ topic, remainingMs, level }: { topic: Topic; remainingMs: number; level: number }) {
  const secs = Math.max(0, Math.min(60, Math.ceil(remainingMs / 1000)));
  const clock = `0:${String(secs).padStart(2, '0')}`;
  return (
    <Scene label="Your speech">
      <Rise key="q"><p className="topic-whisper">{topic.question}</p></Rise>
      <Rise key="judges" className="center"><JudgeRow mode="listening" level={level} stagger={0} /></Rise>
      <Rise key="pill" delay={0.15}>
        <Pill label="Recording">
          <span className="readout"><span className="rec-dot" aria-hidden="true" />Recording<Wave level={level} bars={36} long /><time aria-hidden="true">{clock}</time></span>
        </Pill>
      </Rise>
      <Rise key="note" delay={0.3}><p className="quiet-line">It stops on its own at one minute.</p></Rise>
      {/* Announced once at start and once at ten seconds remaining — never every second. */}
      <p key="sr" className="sr-only" role="status">{secs <= 10 ? 'Ten seconds or less remaining.' : 'Recording started. You have 60 seconds.'}</p>
    </Scene>
  );
}
