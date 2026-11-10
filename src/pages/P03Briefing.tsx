import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowCounterClockwise, ClosedCaptioning, Pause, Play, SkipForward, TextAlignLeft } from '@phosphor-icons/react';
import { AgentLine, Pill, Rise, Scene, Sep, Tool, useBeats, fmtTime, EASE } from '../ui/UI';
import type { Topic } from '../../shared/types';
import type { SpeechSnapshot } from '../lib/audio';

/** Briefing: a line that appears and leaves, then the media centre stage with one control pill and Continue. */
export function P03Briefing({ topic, speech, captions, onCaptions, onPlay, onPause, onReplay, onSkip, onContinue, busy, error }: {
  topic: Topic; speech: SpeechSnapshot; captions: boolean; onCaptions: (v: boolean) => void;
  onPlay: () => void; onPause: () => void; onReplay: () => void; onSkip: () => void; onContinue: () => void; busy: boolean; error: string;
}) {
  const [beat] = useBeats(1, [1500]);
  const [imageFailed, setImageFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = speech.id === `brief-${topic.id}`;
  const playing = mine && (speech.status === 'playing' || speech.status === 'loading');
  const progress = mine && speech.duration ? Math.min(1, speech.time / speech.duration) : 0;
  const caption = mine && speech.cue ? speech.cue.text : topic.question;
  const audioNote = mine && speech.status === 'error' ? 'Narration isn’t available — the text is on screen.'
    : mine && speech.status === 'blocked' ? 'Press play to hear the briefing.' : mine && speech.status === 'disabled' ? 'Voices are off.' : '';
  return (
    <Scene label="Briefing">
      {beat < 1 && <Rise key="line"><AgentLine text="Here’s your issue." focus /></Rise>}
      <Rise key="media" className="center">
        <motion.div className="media" layoutId={`media-${topic.id}`} transition={{ layout: { duration: 0.6, ease: EASE } }} style={{ borderRadius: 28 }}>
          {!imageFailed && <img src={topic.image} alt="A Nigerian university learner studying remotely at home" onError={() => setImageFailed(true)} />}
          {!imageFailed && <div className="shade" />}
          {imageFailed ? <div className="fallback"><strong>{topic.question}</strong><span>{topic.boundary}</span></div>
            : captions && <div className="caption" aria-hidden="true"><motion.span key={caption} initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.35 }}>{caption}</motion.span></div>}
        </motion.div>
      </Rise>
      <p key="sr" className="sr-only">{topic.question} {topic.boundary}</p>
      {beat >= 1 && (
        <Rise key="pill">
          <Pill working={playing} label="Briefing controls">
            <Tool label={playing ? 'Pause' : 'Play the briefing'} agent onClick={playing ? onPause : onPlay}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</Tool>
            <span className="readout"><span className="track" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span><time>{fmtTime(mine ? speech.time : 0)}</time></span>
            <Sep />
            <Tool label="Replay" onClick={onReplay}><ArrowCounterClockwise /></Tool>
            {playing && <Tool label="Skip narration" onClick={onSkip}><SkipForward /></Tool>}
            <Tool label="Captions" pressed={captions} onClick={() => onCaptions(!captions)}><ClosedCaptioning /></Tool>
            <Tool label={open ? 'Hide the text' : 'Read the briefing'} pressed={open} onClick={() => setOpen(o => !o)}><TextAlignLeft /></Tool>
          </Pill>
        </Rise>
      )}
      {open && <Rise key="read"><div className="read-card">{topic.narration}<small>{topic.boundary}</small></div></Rise>}
      {beat >= 1 && audioNote && <Rise key="note"><p className="quiet-line" role="status">{audioNote}</p></Rise>}
      {beat >= 1 && (
        <Rise key="go" className="center" delay={0.12}>
          <button className="primary" onClick={onContinue} disabled={busy} data-working={busy}>I’m ready — meet the panel</button>
        </Rise>
      )}
      {error && <Rise key="err"><p className="error-line" role="alert">{error}</p></Rise>}
    </Scene>
  );
}
