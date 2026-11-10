import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Question, ShieldCheck, SpeakerHigh, SpeakerSlash, User, UsersThree, Waveform, X } from '@phosphor-icons/react';
import type { Capabilities } from '../../shared/types';
import { judges } from '../../shared/content';
import { api, ApiError } from '../lib/api';
import { AgentMark, EASE, Reveal } from '../ui/UI';
import { PhotonKnot } from '../ui/PhotonKnot';

// Photon Knot visibility per scene: present in the calm setup moments, gone for the serious ones
// (speaking, assessment, the panel's verdict, the result).
const KNOT: Record<string, number> = { welcome: 1, topics: 0.85, briefing: 0.35, panel: 0.3, recording: 0, processing: 0, feedback: 0, results: 0 };

export type SoundPrefs = { ambience: boolean; volume: number; voices: boolean; captions: boolean };
export type DrawerSection = 'help' | 'privacy' | 'panel';

/** Shell: drifting ambient backdrop, a quiet wordmark, and ONE folding control orb (name, sound, volume, help). */
export function Workspace({ children, scene, name, outputSilenced, prefs, onPrefs, caps, drawer, setDrawer, recording, helpStage, canChangeName, onChangeName, onCloseRun, closeRunLabel }: {
  children: ReactNode; scene: string; name: string; outputSilenced: boolean;
  prefs: SoundPrefs; onPrefs: (p: SoundPrefs) => void; caps: Capabilities | null;
  drawer: DrawerSection | null; setDrawer: (d: DrawerSection | null) => void; recording: boolean; helpStage: string | null;
  canChangeName: boolean; onChangeName: () => void; onCloseRun?: () => void; closeRunLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const face = useRef<HTMLButtonElement>(null);
  const expanded = open || !!drawer;
  const close = () => { setOpen(false); setDrawer(null); face.current?.focus(); };
  // Escape folds the controls only; it never affects a recording.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && expanded) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const muted = outputSilenced || (!prefs.voices && !prefs.ambience);
  const sections: { id: DrawerSection; label: string; icon: ReactNode }[] = [
    ...(helpStage ? [{ id: 'help' as const, label: 'Help', icon: <Question /> }] : []),
    { id: 'privacy', label: 'Privacy', icon: <ShieldCheck /> },
    { id: 'panel', label: 'The panel', icon: <UsersThree /> },
  ];

  return (
    <>
      <div className="backdrop" data-scene={scene} aria-hidden="true"><i /><i /><i /></div>
      <PhotonKnot intensity={KNOT[scene] ?? 0} />
      <header className="topbar">
        <span className="sr-only">The Floor Is Yours</span>
        <div className="cluster">
          {expanded && <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={close} aria-hidden="true" />}
          <motion.div layout className="orb" transition={{ layout: { type: 'spring', stiffness: 380, damping: 32 } }} style={{ borderRadius: 999 }}>
            <motion.button layout ref={face} className="orb-face" aria-label={expanded ? 'Close controls' : `Open controls${name ? ` for ${name}` : ''}`} aria-expanded={expanded} onClick={() => (expanded ? close() : setOpen(true))}>
              {expanded ? <X /> : name ? [...name][0]?.toUpperCase() : <User />}
              {!expanded && <span className="dot" data-muted={muted} />}
            </motion.button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div key="tools" style={{ display: 'flex', alignItems: 'center', gap: 4 }} initial={{ opacity: 0, x: 12, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: 8, filter: 'blur(4px)', transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: EASE, delay: 0.05 }}>
                  {name && (canChangeName
                    ? <button className="orb-name" title="Change name" onClick={() => { close(); onChangeName(); }}>{name}</button>
                    : <span className="orb-name">{name}</span>)}
                  <span className="sep" />
                  <button className="orb-tool" aria-label="Narration and judge voices" aria-pressed={prefs.voices} onClick={() => onPrefs({ ...prefs, voices: !prefs.voices })}>{prefs.voices ? <SpeakerHigh /> : <SpeakerSlash />}</button>
                  <button className="orb-tool" aria-label="Calm ambient sound" aria-pressed={prefs.ambience} onClick={() => onPrefs({ ...prefs, ambience: !prefs.ambience })}><Waveform /></button>
                  <input type="range" min={0} max={0.3} step={0.01} value={prefs.volume} disabled={!prefs.ambience} aria-label="Ambience volume" onChange={e => onPrefs({ ...prefs, volume: Number(e.target.value) })} />
                  <span className="sep" />
                  {sections.map(s => <button key={s.id} className="orb-tool" aria-label={s.label} aria-pressed={drawer === s.id} onClick={() => setDrawer(drawer === s.id ? null : s.id)}>{s.icon}</button>)}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          <AnimatePresence>
            {drawer && (
              <motion.div key={drawer} className="sheet" role="dialog" aria-label={sections.find(s => s.id === drawer)?.label}
                initial={{ opacity: 0, y: -8, scale: 0.97, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.14 } }}
                transition={{ type: 'spring', stiffness: 360, damping: 30 }} style={{ transformOrigin: 'top right' }}>
                {drawer === 'help' && helpStage && <HelpSheet stage={helpStage} caps={caps} onCloseRun={onCloseRun} closeRunLabel={closeRunLabel} />}
                {drawer === 'privacy' && (
                  <>
                    <h3>Your recording</h3>
                    <ul>
                      <li>Nothing is recorded until you agree and press Begin. The microphone check is not recorded.</li>
                      <li>Your one speech is saved to this server, transcribed{caps?.transcription ? ' by ElevenLabs' : ''} and assessed by AI{caps?.delivery === 'human' ? ', with a person rating delivery' : ''}.</li>
                      <li>Until the server confirms it has your recording, a copy stays in this browser.</li>
                      <li>Kept for: {caps?.retentionDays ? `${caps.retentionDays} days` : 'not yet set by the institution'}.</li>
                    </ul>
                    <label><input type="checkbox" checked={prefs.captions} onChange={e => onPrefs({ ...prefs, captions: e.target.checked })} /> Captions on</label>
                  </>
                )}
                {drawer === 'panel' && (
                  <>
                    <h3>Three AI judges</h3>
                    <p>AI personas, not people watching live. Their listening halos follow your microphone volume only.</p>
                    <ul style={{ marginTop: 8 }}>{judges.map(j => <li key={j.id}><strong>{j.name}</strong> — {j.focus}</li>)}</ul>
                    <p className="note">Position 30 · Reasoning 30 · Structure 25 · Delivery 15. Accent is never penalised.</p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
      <main id="main-content">{children}</main>
    </>
  );
}

/** Task help lives inside the folded controls: ask a question, read the rules. Never writes the argument. */
function HelpSheet({ stage, caps, onCloseRun, closeRunLabel }: { stage: string; caps: Capabilities | null; onCloseRun?: () => void; closeRunLabel?: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [error, setError] = useState('');
  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setError('');
    try { const r = await api.taskHelp(question, stage); setAnswer({ q: question, a: r.answer }); setQ(''); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Help is unavailable right now.'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <form className="help-ask" onSubmit={e => { e.preventDefault(); void ask(); }}>
        <label className="sr-only" htmlFor="task-help">Ask about the task</label>
        <input id="task-help" value={q} maxLength={500} placeholder="Ask about the task…" onChange={e => setQ(e.target.value)} autoComplete="off" autoFocus />
        <button className="send sm" type="submit" aria-label="Ask" disabled={!q.trim() && !busy} data-working={busy}><ArrowUp weight="bold" /></button>
      </form>
      {(answer || error) && (
        <div className="help-answer" role="status" aria-live="polite">
          <AgentMark />
          <div>{answer && <><p className="q">{answer.q}</p><p><Reveal text={answer.a} /></p></>}{error && <p style={{ color: 'var(--error)' }}>{error}</p>}</div>
        </div>
      )}
      <h3 style={{ marginTop: 14 }}>The task</h3>
      <ul>
        <li>One issue, locked once its briefing opens.</li>
        <li>One speech, up to 60 seconds. It stops on its own; finishing early is fine.</li>
        <li>State your position, give reasons, close clearly. Either side can earn full marks.</li>
      </ul>
      <h3>Microphone trouble</h3>
      <ul>
        <li>Blocked: allow the microphone in your browser’s site settings, then test again.</li>
        <li>Not found or busy: connect one, close other apps using it, test again.</li>
        <li>Too quiet: move closer and say a few words.</li>
      </ul>
      {caps?.supportUrl && <p><a href={caps.supportUrl} target="_blank" rel="noreferrer">Contact support or request an alternative assessment</a></p>}
      {onCloseRun && <button className="ghost" style={{ marginTop: 6 }} onClick={onCloseRun}>{closeRunLabel ?? 'Close this run without a score'}</button>}
    </>
  );
}
