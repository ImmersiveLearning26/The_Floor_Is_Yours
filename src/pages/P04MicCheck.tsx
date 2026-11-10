import { ArrowCounterClockwise, Microphone, MicrophoneSlash, Warning } from '@phosphor-icons/react';
import { AgentLine, JudgeRow, Pill, Reveal, Rise, Scene, Tool, Wave, useBeats } from '../ui/UI';
import type { MicStatus } from '../../shared/types';
import type { SpeechSnapshot } from '../lib/audio';

const text: Record<MicStatus, string> = {
  idle: '', requesting: 'Allow the microphone in your browser…', listening: 'Say a few words…', ready: 'We can hear you',
  quiet: 'We can’t hear you clearly — move closer and try again',
  denied: 'Microphone blocked — allow it in your browser’s site settings',
  missing: 'No microphone found — connect one and try again',
  busy: 'Microphone in use by another app — close it and try again',
  unsupported: 'Recording isn’t supported in this browser',
  insecure: 'Recording needs a secure (https) connection',
  lost: 'Microphone disconnected — reconnect it and try again',
};
const tone = (s: MicStatus) => ['denied', 'missing', 'busy', 'unsupported', 'insecure', 'lost'].includes(s) ? 'error' : s === 'quiet' ? 'warn' : s === 'ready' ? 'ok' : undefined;

/** The panel arrives, then one thing at a time: microphone → consent → begin. */
export function P04MicCheck({ status, level, consent, onConsent, onCheck, onBegin, onHelp, onPrivacy, chair, onSkipChair, onReplayChair, beginning, error, recovery }: {
  status: MicStatus; level: number; consent: boolean; onConsent: (v: boolean) => void; onCheck: () => void; onBegin: () => void;
  onHelp: () => void; onPrivacy: () => void; chair: SpeechSnapshot; onSkipChair: () => void; onReplayChair: () => void; beginning: boolean; error: string; recovery: string;
}) {
  // beat 0: "Your panel is ready." · 1: judges arrive (with roles) · 2: roles fade, the microphone step rises
  const [beat, skip] = useBeats(2, [1300, 2600], !!recovery);
  const chairActive = chair.id === 'chair' && (chair.status === 'playing' || chair.status === 'loading');
  const t = tone(status);
  const live = status === 'listening' || status === 'ready';
  return (
    <Scene label="Meet your panel">
      {beat < 1 && <Rise key="ready"><AgentLine text="Your panel is ready." focus /></Rise>}
      {beat >= 1 && (
        <Rise key="judges" className="center">
          <div onClick={beat < 2 ? skip : undefined}>
            <JudgeRow mode={chairActive ? 'speaking' : live ? 'listening' : 'ready'} level={chairActive ? 0 : level} active={chairActive ? 'ada' : null} roles={beat < 2} stagger={0.18} />
          </div>
        </Rise>
      )}
      {beat >= 2 && chairActive && (
        <Rise key="chair">
          <p className="subtitle"><small>Ada · chair</small><Reveal key={chair.cue?.text ?? 'w'} text={chair.cue?.text ?? 'Welcome.'} /></p>
          <div className="row"><button className="link-button" onClick={onSkipChair}>Skip introduction</button></div>
        </Rise>
      )}
      {beat >= 2 && !chairActive && chair.id === 'chair' && chair.status === 'ended' && status !== 'ready' && (
        <Rise key="again" className="center"><button className="link-button" onClick={onReplayChair}>Hear the introduction again</button></Rise>
      )}
      {beat >= 2 && recovery && <Rise key="recovery"><p className="hint-line" role="alert">{recovery}</p></Rise>}
      {beat >= 2 && status === 'idle' && (
        <Rise key="check" className="center" delay={0.1}>
          <button className="primary" onClick={onCheck}><Microphone weight="regular" /> Check my microphone</button>
        </Rise>
      )}
      {beat >= 2 && status !== 'idle' && (
        <Rise key="meter">
          <Pill tone={t} label="Microphone">
            <span className="readout" role="status" aria-live="polite">
              {t === 'error' ? <MicrophoneSlash size={19} /> : t === 'warn' ? <Warning size={19} /> : <Microphone size={19} />}
              {live && <Wave level={level} bars={14} />}
              {text[status]}
            </span>
            {status !== 'requesting' && status !== 'listening' && <Tool label="Test again" onClick={onCheck}><ArrowCounterClockwise /></Tool>}
          </Pill>
        </Rise>
      )}
      {beat >= 2 && t === 'error' && <Rise key="help" className="center"><button className="link-button" onClick={onHelp}>Get help with the microphone</button></Rise>}
      {beat >= 2 && status === 'ready' && (
        <Rise key="consent" className="center" delay={0.25}>
          <label className="consent" data-on={consent}>
            <input type="checkbox" checked={consent} onChange={e => onConsent(e.target.checked)} />
            Record and assess my 60-second speech
          </label>
        </Rise>
      )}
      {beat >= 2 && status === 'ready' && consent && (
        <Rise key="begin" className="center">
          <button className="primary" onClick={onBegin} disabled={beginning} data-working={beginning}>{beginning ? 'Starting…' : 'Begin — the floor is yours'}</button>
        </Rise>
      )}
      {beat >= 2 && status === 'ready' && (
        <Rise key="fine" delay={0.4}><p className="quiet-line">{consent ? 'All sound stops when you begin. One speech, up to 60 seconds.' : <>Nothing is recorded until you agree. <button className="link-button" style={{ minHeight: 0, padding: '0 4px', fontSize: 13.5 }} onClick={onPrivacy}>How it’s stored</button></>}</p></Rise>
      )}
      {error && <Rise key="err"><p className="error-line" role="alert">{error}</p></Rise>}
    </Scene>
  );
}
