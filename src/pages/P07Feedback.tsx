import { useState } from 'react';
import { ArrowCounterClockwise, ClosedCaptioning, ListBullets, Pause, Play, SkipForward } from '@phosphor-icons/react';
import { AgentLine, JudgeRow, Pill, Reveal, Rise, Scene, Sep, Tool, useBeats } from '../ui/UI';
import { judgeById, judges } from '../../shared/content';
import type { Assessment, JudgeId } from '../../shared/types';
import type { SpeechSnapshot } from '../lib/audio';

export const turnSpeechId = (evaluationId: string, judgeId: string) => `turn-${evaluationId}-${judgeId}`;

/** Feedback: the speaking judge in the spotlight, their words as a subtitle, one control pill. */
export function P07Feedback({ assessment, index, speech, captions, onCaptions, onPlay, onPause, onResume, onSkip, onSelect, onResults }: {
  assessment: Assessment; duration: number | null; index: number; speech: SpeechSnapshot; captions: boolean; onCaptions: (v: boolean) => void;
  onPlay: (i: number) => void; onPause: () => void; onResume: () => void; onSkip: () => void; onSelect: (i: number) => void; onResults: () => void;
}) {
  const [beat] = useBeats(1, [1400]);
  const [full, setFull] = useState(false);
  const turn = assessment.turns[index];
  const judge = judgeById(turn?.judgeId);
  const mine = !!turn && speech.id === turnSpeechId(assessment.evaluationId, turn.judgeId);
  const playing = mine && (speech.status === 'playing' || speech.status === 'loading');
  const paused = mine && speech.status === 'paused';
  const hasAudio = !!turn?.audioUrl;
  const caption = mine && playing && captions && speech.cue ? speech.cue.text : turn?.text ?? '';
  const next = index < assessment.turns.length - 1 ? judgeById(assessment.turns[index + 1].judgeId) : null;
  if (!turn || !judge) return <Scene label="Feedback"><Rise key="go" className="center"><button className="primary" onClick={onResults}>See your result</button></Rise></Scene>;
  const note = !hasAudio ? 'Spoken feedback isn’t available, so you’re reading the panel’s words.'
    : mine && speech.status === 'blocked' ? `Press play to hear ${judge.name}.` : mine && speech.status === 'disabled' ? 'Voices are off.' : '';
  return (
    <Scene label="Panel feedback">
      {beat < 1 && <Rise key="line"><AgentLine text="The panel has feedback for you." focus /></Rise>}
      <Rise key="judges" className="center">
        <JudgeRow mode={playing ? 'speaking' : 'ready'} active={turn.judgeId} spotlight={beat >= 1} stagger={0.1}
          onSelect={(id: JudgeId) => onSelect(assessment.turns.findIndex(t => t.judgeId === id))} />
      </Rise>
      {beat >= 1 && (
        <Rise key="sub">
          <p className="subtitle" aria-live="off"><small>{judge.name} · {judge.role}</small><Reveal key={`${index}-${caption}`} text={caption} /></p>
          <p className="sr-only" aria-live="polite">{`${judge.name}: ${turn.text}`}</p>
        </Rise>
      )}
      {beat >= 1 && (
        <Rise key="pill" delay={0.1}>
          <Pill working={playing} label="Feedback controls">
            {hasAudio && <Tool label={playing ? 'Pause' : paused ? 'Resume' : 'Play'} agent onClick={() => (playing ? onPause() : paused ? onResume() : onPlay(index))}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</Tool>}
            {hasAudio && <Tool label="Replay" onClick={() => onPlay(index)}><ArrowCounterClockwise /></Tool>}
            {hasAudio && (playing || paused) && <Tool label="Skip audio" onClick={onSkip}><SkipForward /></Tool>}
            {hasAudio && <Sep />}
            {assessment.turns.map((t, i) => { const j = judgeById(t.judgeId)!; return <Tool key={t.judgeId} className="face" label={`${j.name} · ${j.role}`} pressed={i === index} onClick={() => onSelect(i)}><img src={j.image} alt="" /></Tool>; })}
            <Sep />
            <Tool label="Captions" pressed={captions} onClick={() => onCaptions(!captions)}><ClosedCaptioning /></Tool>
            <Tool label={full ? 'Hide all feedback' : 'Read all feedback'} pressed={full} onClick={() => setFull(f => !f)}><ListBullets /></Tool>
          </Pill>
        </Rise>
      )}
      {full && (
        <Rise key="full">
          <div className="read-card">{assessment.turns.map(t => { const j = judges.find(x => x.id === t.judgeId)!; return <p key={t.judgeId} style={{ marginBottom: 10 }}><strong>{j.name}</strong> · {t.text}</p>; })}</div>
        </Rise>
      )}
      {beat >= 1 && note && <Rise key="note"><p className="quiet-line" role="status">{note}</p></Rise>}
      {beat >= 1 && (
        <Rise key="go" className="center" delay={0.2}>
          <div className="row">
            {next && <button className="ghost" onClick={() => onSelect(index + 1)}>Next: {next.name}</button>}
            <button className={next ? 'link-button' : 'primary'} onClick={onResults}>See your result</button>
          </div>
        </Rise>
      )}
    </Scene>
  );
}
