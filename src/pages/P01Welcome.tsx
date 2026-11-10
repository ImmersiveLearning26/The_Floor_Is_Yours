import { useState } from 'react';
import { ArrowUp } from '@phosphor-icons/react';
import { AgentLine, OrbitMark, Rise, Scene, useFocusOnMount } from '../ui/UI';
import type { Topic } from '../../shared/types';

/** Name entry: the mark, one question, one field. Nothing else. */
export function P01Welcome({ initialName, busy, error, onContinue }: { initialName: string; busy: boolean; error: string; onContinue: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  const [local, setLocal] = useState('');
  const input = useFocusOnMount<HTMLInputElement>();
  const submit = () => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) { setLocal('Enter your name to continue.'); input.current?.focus(); return; }
    if ([...clean].length > 60) { setLocal('Use 60 characters or fewer.'); return; }
    setLocal(''); onContinue(clean);
  };
  const msg = local || error;
  return (
    <Scene label="Welcome">
      <Rise key="mark"><OrbitMark /></Rise>
      <Rise key="line" delay={0.15}><AgentLine text="What should I call you?" sr={false} mark={false} /></Rise>
      <Rise key="composer" delay={0.35} className="center">
        <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }}>
          <label className="sr-only" htmlFor="learner-name">What should I call you?</label>
          <input ref={input} id="learner-name" value={name} maxLength={80} autoComplete="given-name" placeholder="Your name" enterKeyHint="go"
            aria-invalid={!!msg} aria-describedby={msg ? 'name-error' : undefined} onChange={e => { setName(e.target.value); if (local) setLocal(''); }} />
          <button className="send" type="submit" aria-label="Continue" disabled={busy} data-working={busy}><ArrowUp weight="bold" /></button>
        </form>
      </Rise>
      {msg && <Rise key="err"><p className="error-line" id="name-error" role="alert">{msg}</p></Rise>}
    </Scene>
  );
}

/** Unfinished run: a single resume prompt — never a silent reset. */
export function P01Resume({ name, topic, busy, error, onResume }: { name: string; topic: Topic; busy: boolean; error: string; onResume: () => void }) {
  return (
    <Scene label="Resume">
      <Rise key="mark"><OrbitMark /></Rise>
      <Rise key="line" delay={0.1}><AgentLine text={name ? `Welcome back, ${name}.` : 'Welcome back.'} focus mark={false} /></Rise>
      <Rise key="sub" delay={0.3}><p className="quiet-line">You were in the middle of <strong style={{ color: 'var(--ink)' }}>{topic.label}</strong>.</p></Rise>
      <Rise key="go" delay={0.45} className="center"><button className="primary" onClick={onResume} disabled={busy} data-working={busy}>{busy ? 'Resuming…' : 'Pick up where you left off'}</button></Rise>
      {error && <Rise key="err"><p className="error-line" role="alert">{error}</p></Rise>}
    </Scene>
  );
}
