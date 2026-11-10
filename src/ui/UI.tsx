import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { judges } from '../../shared/content';
import type { JudgeId } from '../../shared/types';

export const EASE = [0.22, 1, 0.36, 1] as const;
const ORBIT = 'M4.21 16.5A9 5 -30 1 1 19.79 7.5A9 5 -30 1 1 4.21 16.5';

/** Splits text into short phrase groups (never characters). */
export function phrases(text: string) {
  const parts = text.match(/[^.,;:!?—]+[.,;:!?—]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && (p.trim().split(/\s+/).length <= 2 || out[out.length - 1].trim().split(/\s+/).length <= 2)) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

/** Phrase-level reveal with a soft blur: opacity 0→1, y 6→0, blur 6→0, 45 ms stagger. Screen readers get the full text once. */
export function Reveal({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {phrases(text).map((p, i) => (
          <motion.span key={`${i}-${p}`} className="phrase" initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.32, ease: EASE, delay: delay + i * 0.05 }} style={{ display: 'inline-block', whiteSpace: 'pre-wrap' }}>{p}</motion.span>
        ))}
      </span>
    </span>
  );
}

export function AgentMark({ working = false }: { working?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="agent-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d={ORBIT} fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle r="2" fill="currentColor" cx={reduce ? 19.79 : undefined} cy={reduce ? 7.5 : undefined}>
          {!reduce && <animateMotion dur={working ? '1.1s' : '2.6s'} repeatCount="indefinite" path={ORBIT} />}
        </circle>
      </svg>
    </span>
  );
}

export function OrbitMark() { return <div className="orbit-mark" aria-hidden="true"><i /></div>; }

export function useFocusOnMount<T extends HTMLElement>(enabled = true, dep?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => { if (enabled) ref.current?.focus({ preventScroll: true }); }, [enabled, dep]);
  return ref;
}

/** Everything enters from below with a soft blur and leaves upward — the upward flow.
 *  forwardRef so AnimatePresence (popLayout) can measure exiting elements. */
export const Rise = forwardRef<HTMLDivElement, { children: ReactNode; delay?: number; className?: string; style?: CSSProperties; id?: string }>(
  function Rise({ children, delay = 0, className, style, id }, ref) {
    const reduce = useReducedMotion();
    return (
      <motion.div ref={ref} id={id} layout="position" className={className} style={style}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, filter: 'blur(10px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -18, filter: 'blur(8px)', transition: { duration: 0.28, ease: EASE } }}
        transition={{ duration: 0.55, ease: EASE, delay, layout: { duration: 0.45, ease: EASE } }}>
        {children}
      </motion.div>
    );
  });

/** A centered scene whose children (keyed Rise elements) animate in and out. */
export function Scene({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="scene" aria-label={label}>
      <AnimatePresence mode="popLayout" initial>{children}</AnimatePresence>
    </section>
  );
}

/** The agent's voice. `transient` lines appear, hold, and leave on their own. */
export function AgentLine({ text, working = false, focus = false, sr = true, mark = true }: { text: string; working?: boolean; focus?: boolean; sr?: boolean; mark?: boolean }) {
  const ref = useFocusOnMount<HTMLParagraphElement>(focus, text);
  return (
    <p className="agent-line" ref={ref} tabIndex={focus ? -1 : undefined} role={sr ? 'status' : undefined} aria-live={sr ? 'polite' : undefined}>
      {mark && <AgentMark working={working} />}<Reveal key={text} text={text} />
    </p>
  );
}

/** Timeline helper: returns how many beats have elapsed (each `ms` apart), or all of them when skipped / reduced motion. */
export function useBeats(count: number, ms: number[], skip = false) {
  const reduce = useReducedMotion();
  const [beat, setBeat] = useState(skip || reduce ? count : 0);
  const schedule = useRef(ms);
  schedule.current = ms;
  useEffect(() => {
    if (skip || reduce) { setBeat(count); return; }
    if (beat >= count) return;
    const id = window.setTimeout(() => setBeat(b => b + 1), schedule.current[Math.min(beat, schedule.current.length - 1)]);
    return () => window.clearTimeout(id);
  }, [beat, count, skip, reduce]);
  return [beat, () => setBeat(count)] as const;
}

export function Pill({ working = false, tone, children, label = 'Controls' }: { working?: boolean; tone?: 'warn' | 'error' | 'ok'; children: ReactNode; label?: string }) {
  return (
    <div className="pill-wrap">
      <div className={`pill${working ? ' working' : ''}`} data-tone={tone} role="toolbar" aria-label={label}>
        <span className="bloom" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
export function Tool({ label, onClick, pressed, agent = false, disabled, children, className }: {
  label: string; onClick?: () => void; pressed?: boolean; agent?: boolean; disabled?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <button type="button" className={`tool${agent ? ' agent' : ''}${className ? ` ${className}` : ''}`} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      {children}<span className="tip" aria-hidden="true">{label}</span>
    </button>
  );
}
export const Sep = () => <span className="sep" aria-hidden="true" />;

// Idle loop files are optional: /media/judges/<id>-idle.mp4 (silent, seamless, no mouth movement).
const idleCache = new Map<string, Promise<boolean>>();
function hasIdleLoop(url: string) {
  if (!idleCache.has(url)) idleCache.set(url, fetch(url, { method: 'HEAD' }).then(r => r.ok && (r.headers.get('content-type') ?? '').startsWith('video')).catch(() => false));
  return idleCache.get(url)!;
}

/** A judge's portrait that feels present: a real idle video loop when installed, otherwise the still with a
 *  slow breathing drift. Idle motion is constant and never reacts to what the learner says. */
export function Portrait({ src, name, idle, index = 0 }: { src: string; name: string; idle?: string; index?: number }) {
  const reduce = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [video, setVideo] = useState(false);
  useEffect(() => { let live = true; if (idle && !reduce) void hasIdleLoop(idle).then(ok => { if (live) setVideo(ok); }); return () => { live = false; }; }, [idle, reduce]);
  if (failed) return <div className="portrait"><span role="img" aria-label={`${name}, AI judge`}>{name[0]}</span></div>;
  return (
    <div className="portrait" style={{ ['--idle-delay' as string]: `${index * -2.3}s` } as CSSProperties}>
      {video
        ? <video className="idle" src={idle} poster={src} autoPlay muted loop playsInline aria-label={`${name}, AI judge`} onError={() => setVideo(false)} />
        : <img className="idle" src={src} alt={`${name}, AI judge`} onError={() => setFailed(true)} draggable={false} />}
    </div>
  );
}

/** The three AI judges, centre stage. Listening halos follow real, smoothed mic amplitude — never an evaluative reaction. */
export function JudgeRow({ mode = 'ready', level = 0, active = null, spotlight = false, dim = false, roles = false, onSelect, stagger = 0.12 }: {
  mode?: 'ready' | 'listening' | 'speaking'; level?: number; active?: JudgeId | null; spotlight?: boolean; dim?: boolean; roles?: boolean;
  onSelect?: (id: JudgeId) => void; stagger?: number;
}) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(1, level));
  return (
    <div className="judges" data-mode={mode} data-spotlight={spotlight} data-dim={dim}>
      {judges.map((j, i) => {
        const isActive = active === j.id;
        const inner = (
          <>
            <motion.div className="halo" data-speaking={mode === 'speaking' && isActive} style={{ '--level': v, '--arc-from': `${i * 120}deg` } as CSSProperties}
              initial={reduce ? false : { opacity: 0, scale: 0.82, filter: 'blur(12px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.7, ease: EASE, delay: i * stagger }}>
              <span className="arc" aria-hidden="true" />
              <Portrait src={j.image} name={j.name} idle={j.image.replace('.webp', '-idle.mp4')} index={i} />
            </motion.div>
            <motion.span className="jname" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: i * stagger + 0.25 }}>{j.name}</motion.span>
            <AnimatePresence>{roles && <motion.span key="role" className="jrole" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, delay: i * stagger + 0.35 }}>{j.focus}</motion.span>}</AnimatePresence>
          </>
        );
        return onSelect
          ? <button key={j.id} type="button" className="judge" data-active={isActive} onClick={() => onSelect(j.id)} aria-label={`Listen to ${j.name}, ${j.focus}`} aria-pressed={isActive}>{inner}</button>
          : <div key={j.id} className="judge" data-active={isActive}>{inner}</div>;
      })}
    </div>
  );
}

export function Wave({ level, bars = 14, long = false }: { level: number; bars?: number; long?: boolean }) {
  const hist = useRef<number[]>(Array(bars).fill(0));
  const [, force] = useState(0);
  useEffect(() => { hist.current = [...hist.current.slice(-(bars - 1)), level]; while (hist.current.length < bars) hist.current.unshift(0); force(n => (n + 1) % 1000); }, [level, bars]);
  return (
    <span className={`wave${long ? ' long' : ''}`} aria-hidden="true">
      {hist.current.map((l, i) => <i key={i} style={{ height: `${Math.max(4, Math.min(24, 4 + l * 24 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7)))))}px` }} />)}
    </span>
  );
}

export function SpeakingWave({ active }: { active: boolean }) {
  return (
    <span className={`wave${active ? ' speaking-wave' : ''}`} aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ '--i': i, height: active ? undefined : `${5 + (i % 3) * 3}px` } as CSSProperties} />)}
    </span>
  );
}

export const fmtTime = (s: number) => { const v = Math.max(0, Math.floor(s || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
