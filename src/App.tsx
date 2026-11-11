import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import { Workspace, type DrawerSection, type SoundPrefs } from './shell/Workspace';
import { P00Splash, useSplashLogo } from './pages/P00Splash';
import { P01Resume, P01Welcome } from './pages/P01Welcome';
import { P02Topics } from './pages/P02Topics';
import { P03Briefing } from './pages/P03Briefing';
import { P04MicCheck } from './pages/P04MicCheck';
import { P05Recording } from './pages/P05Recording';
import { P06Processing, type Steps } from './pages/P06Processing';
import { P07Feedback, turnSpeechId } from './pages/P07Feedback';
import { P08Results } from './pages/P08Results';
import { AgentLine, AgentMark, Rise, Scene } from './ui/UI';
import { api, ApiError } from './lib/api';
import { AudioDirector, type SpeechSnapshot } from './lib/audio';
import { MicService } from './lib/mic';
import { CaptureService, MAX_MS } from './lib/capture';
import { localRecordings } from './lib/idb';
import { toWav16k } from './lib/wav';
import { ambienceAudio, chairAudio, topicById } from '../shared/content';
import type { Capabilities, JobStage, MicStatus, ProcessingStatus, RunView, Stage, TopicId } from '../shared/types';

const PREFS_KEY = 'fiy.sound.v1';
const loadPrefs = (): SoundPrefs => {
  try { return { ambience: true, volume: 0.15, voices: true, captions: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return { ambience: true, volume: 0.15, voices: true, captions: true }; }
};
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const msgOf = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : fallback;
const jobToStatus = (stage: JobStage, run: RunView): ProcessingStatus =>
  stage === 'failed' ? (run.status === 'review-requested' ? 'review-requested' : 'failed')
    : stage === 'needs-review' ? (run.status === 'review-requested' ? 'review-requested' : 'needs-review')
      : stage === 'assessing' ? 'assessing' : stage === 'voicing' || stage === 'complete' ? 'voicing' : 'transcribing';
const captureReasonText: Record<string, string> = {
  'track-ended': 'your microphone disconnected', 'recorder-error': 'the recorder reported an error', 'empty-recording': 'no audio was captured',
  'recorder-start-timeout': 'the recorder did not start', 'recorder-start-failed': 'the recorder could not start', 'interrupted-reload': 'the page was closed or reloaded',
  'decode-failed': 'the saved file could not be read',
};

export default function App() {
  const director = useMemo(() => new AudioDirector(ambienceAudio), []);
  const mic = useMemo(() => new MicService(), []);
  const capture = useMemo(() => new CaptureService(), []);

  const [boot, setBoot] = useState<'loading' | 'ready' | 'offline'>('loading');
  const splashLogo = useSplashLogo();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [policyVersion, setPolicyVersion] = useState('');
  const [name, setName] = useState('');
  const [stage, setStage] = useState<Stage>('welcome');
  const [run, setRunState] = useState<RunView | null>(null);
  const runRef = useRef<RunView | null>(null);
  const setRun = useCallback((r: RunView | null) => { runRef.current = r; setRunState(r); }, []);
  const [resumeOffer, setResumeOffer] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<TopicId | null>(null);
  const idemKey = useRef(newKey());
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [level, setLevel] = useState(0);
  const [consent, setConsent] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [remainingMs, setRemainingMs] = useState(MAX_MS);
  const [proc, setProc] = useState<{ status: ProcessingStatus; saved: 'device' | 'server' | 'none'; message: string | null; slow: boolean }>({ status: 'uploading', saved: 'none', message: null, slow: false });
  const localBlob = useRef<{ runId: string; blob: Blob; duration: number } | null>(null);
  const [feedbackIndex, setFeedbackIndex] = useState(0);
  const autoAdvance = useRef(true);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayUrls, setReplayUrls] = useState<{ play: string; download: string } | null>(null);
  const [drawer, setDrawer] = useState<DrawerSection | null>(null);
  const [prefs, setPrefsState] = useState<SoundPrefs>(loadPrefs);
  const [speech, setSpeech] = useState<SpeechSnapshot>(director.snapshot);
  const chairPlayedFor = useRef<string | null>(null);

  const topic = topicById(run?.topicId ?? null);
  const setPrefs = (p: SoundPrefs) => { setPrefsState(p); try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
  useEffect(() => director.setPrefs(prefs), [director, prefs]);
  useEffect(() => director.subscribe(setSpeech), [director]);
  useEffect(() => { mic.onLevel = setLevel; mic.onLost = () => setMicStatus(s => (s === 'ready' || s === 'listening' ? 'lost' : s)); }, [mic]);
  useEffect(() => { director.setPhase(['welcome', 'topics', 'briefing', 'mic'].includes(stage) ? 'setup' : stage === 'recording' ? 'capture' : 'post'); }, [director, stage]);

  // ── Boot & resume ─────────────────────────────────────────
  const loadSession = useCallback(async () => {
    setBoot('loading');
    try {
      const s = await api.session();
      setCaps(s.capabilities); setPolicyVersion(s.consentVersion); setName(s.displayName);
      if (s.activeRun) { setRun(s.activeRun); setResumeOffer(true); setStage('welcome'); }
      else setStage(s.displayName ? 'topics' : 'welcome');
      setBoot('ready');
    } catch { setBoot('offline'); }
  }, [setRun]);
  useEffect(() => { void loadSession(); }, [loadSession]);
  const [splashDone, setSplashDone] = useState(false);

  // Warn before leaving while capture/upload is in progress.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (stage === 'recording' || (stage === 'processing' && proc.saved !== 'server')) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [stage, proc.saved]);

  const goto = (s: Stage) => { setError(''); setStage(s); };

  // ── P01 / P02 ─────────────────────────────────────────────
  const submitName = async (n: string) => {
    void director.unlock();
    setBusy('name'); setError('');
    try { const r = await api.setName(n); setName(r.displayName); setNotice(''); goto('topics'); }
    catch (e) { setError(msgOf(e, 'Could not save your name. Try again.')); }
    finally { setBusy(null); }
  };

  const playBriefing = useCallback((t = topic) => { if (t) void director.play(`brief-${t.id}`, t.audio, t.captions); }, [director, topic]);

  const enterBriefing = async () => {
    if (!selected || busy) return;
    void director.unlock();
    setBusy('create'); setError('');
    try {
      const r = await api.createRun(selected, idemKey.current);
      setRun(r.run); setNotice('');
      goto('briefing');
      playBriefing(topicById(r.run.topicId));
    } catch (e) {
      const existing = e instanceof ApiError ? (e.body.run as RunView | undefined) : undefined;
      if (existing) { setRun(existing); setResumeOffer(true); goto('welcome'); }
      else setError(`${msgOf(e, 'Could not open the briefing.')} Your topic has not been locked. Try again.`);
    } finally { setBusy(null); }
  };

  // ── P03 → P04 ─────────────────────────────────────────────
  const playChair = useCallback(() => { void director.play('chair', chairAudio.audio, chairAudio.captions); }, [director]);
  const continueToPanel = async () => {
    const r = runRef.current; if (!r || busy) return;
    const completed = speech.id === `brief-${r.topicId}` && speech.status === 'ended';
    director.stopSpeech();
    setBusy('brief');
    try {
      const res = await api.briefing(r.id, completed ? 'completed' : 'skipped');
      setRun(res.run); goto('mic');
      if (chairPlayedFor.current !== r.id) { chairPlayedFor.current = r.id; playChair(); }
    } catch (e) { setError(msgOf(e, 'Could not continue. Try again.')); }
    finally { setBusy(null); }
  };

  // ── P04 microphone check ──────────────────────────────────
  const checkMic = async () => {
    setError(''); setMicStatus('requesting');
    const status = await mic.acquire();
    setMicStatus(status);
  };
  // Live-input detection: permission alone is not a signal check. ~400 ms of voice within 10 s → ready.
  const heard = useRef(0);
  useEffect(() => {
    if (micStatus !== 'listening') return;
    heard.current = 0;
    let last = performance.now();
    const started = last;
    const id = window.setInterval(() => {
      const now = performance.now();
      if (levelRef.current > 0.1) heard.current += now - last;
      last = now;
      if (heard.current > 400) setMicStatus('ready');
      else if (now - started > 10_000) setMicStatus('quiet');
    }, 60);
    return () => window.clearInterval(id);
  }, [micStatus]);
  const levelRef = useRef(0);
  useEffect(() => { levelRef.current = level; }, [level]);

  // ── Capture ───────────────────────────────────────────────
  const technicalRecovery = useCallback(async (runId: string, reason: string) => {
    mic.release(); setMicStatus('idle'); setLevel(0);
    try { const r = await api.captureFailed(runId, reason); setRun(r.run); } catch { /* server keeps state; resume will retry */ }
    setRecovery(`Your recording was interrupted (${captureReasonText[reason] ?? 'a technical problem'}) and wasn’t saved. This doesn’t count as your speech — check your microphone and begin again.`);
    goto('mic');
  }, [mic, setRun]);

  const uploadAndEvaluate = useCallback(async (runId: string, blob: Blob) => {
    setProc(p => ({ ...p, status: 'uploading', message: null, slow: false }));
    let wav: Blob;
    try { wav = await toWav16k(blob); }
    catch { void localRecordings.remove(runId); localBlob.current = null; await technicalRecovery(runId, 'decode-failed'); return; }
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await api.upload(runId, wav);
        setRun(r.run);
        setProc(p => ({ ...p, saved: 'server' }));
        void localRecordings.remove(runId); localBlob.current = null;
        const ev = await api.evaluate(runId);
        setRun(ev.run);
        if (ev.run.job) setProc(p => ({ ...p, status: jobToStatus(ev.run.job!.stage, ev.run), message: ev.run.job!.message }));
        return;
      } catch (e) {
        lastErr = e;
        if (e instanceof ApiError && e.status === 422 && e.body.technical) {
          void localRecordings.remove(runId); localBlob.current = null;
          await technicalRecovery(runId, 'decode-failed');
          return;
        }
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) break;
        await new Promise(res => setTimeout(res, 1200 * 2 ** i));
      }
    }
    setProc(p => ({ ...p, status: 'failed', message: `${msgOf(lastErr, 'Upload failed.')} ${p.saved === 'device' ? 'Your recording is saved on this device; Retry sends the same file.' : ''}`.trim() }));
  }, [setRun, technicalRecovery]);

  useEffect(() => {
    capture.onTick = ms => setRemainingMs(ms);
    capture.onComplete = async ({ blob, duration }) => {
      const r = runRef.current; if (!r) return;
      mic.release(); setLevel(0);
      localBlob.current = { runId: r.id, blob, duration };
      setProc({ status: 'uploading', saved: 'none', message: null, slow: false });
      goto('processing');
      const ok = await localRecordings.save({ runId: r.id, blob, duration, savedAt: new Date().toISOString() }).catch(() => false);
      if (ok) setProc(p => (p.saved === 'server' ? p : { ...p, saved: 'device' }));
      void uploadAndEvaluate(r.id, blob);
    };
    capture.onFailure = ({ reason }) => { const r = runRef.current; if (r) void technicalRecovery(r.id, reason); };
  }, [capture, mic, uploadAndEvaluate, technicalRecovery]);

  const begin = async () => {
    const r = runRef.current;
    if (!r || busy || micStatus !== 'ready' || !consent || capture.active) return;
    setBusy('begin'); setError('');
    director.silenceForCapture(); // all output stops before capture starts
    try {
      if (r.consentVersion !== policyVersion) setRun((await api.consent(r.id, policyVersion)).run);
      try { setRun((await api.captureStart(r.id)).run); }
      catch (e) {
        if (e instanceof ApiError && e.status === 409 && !runRef.current?.recording && runRef.current?.captureStartedAt) {
          await api.captureFailed(r.id, 'stale-open-capture');
          setRun((await api.captureStart(r.id)).run);
        } else throw e;
      }
      if (!mic.live) { setMicStatus('lost'); throw new ApiError('Your microphone stopped. Test it again.', 0); }
      await mic.resume();
      setRemainingMs(MAX_MS);
      await capture.start(mic.stream!);
      setRecovery('');
      goto('recording');
    } catch (e) {
      director.setPhase('setup');
      setError(msgOf(e, 'Recording could not start. This doesn’t count as your speech.'));
      if (runRef.current?.captureStartedAt && !runRef.current.recording) { try { setRun((await api.captureFailed(r.id, 'recorder-start-failed')).run); } catch { /* ignore */ } }
    } finally { setBusy(null); }
  };

  // ── P06 polling ───────────────────────────────────────────
  const lastStage = useRef<{ stage: string; at: number }>({ stage: '', at: Date.now() });
  useEffect(() => {
    if (stage !== 'processing') return;
    const r = run;
    const job = r?.job;
    if (!r || !job) return;
    const terminal = job.stage === 'failed' || job.stage === 'needs-review';
    if (job.stage === 'complete' && r.assessment) { setFeedbackIndex(0); autoAdvance.current = true; goto('feedback'); return; }
    if (terminal && r.status !== 'review-requested') return;
    const id = window.setTimeout(async () => {
      try {
        const res = await api.job(job.id);
        if (lastStage.current.stage !== res.job.stage) lastStage.current = { stage: res.job.stage, at: Date.now() };
        setRun(res.run);
        setProc(p => ({ ...p, saved: 'server', status: jobToStatus(res.job.stage, res.run), message: res.job.message, slow: Date.now() - lastStage.current.at > 120_000 }));
      } catch (e) { setProc(p => ({ ...p, message: `${msgOf(e, 'Connection lost.')} Reconnecting…` })); setRun({ ...r }); }
    }, terminal ? 10_000 : 1500);
    return () => window.clearTimeout(id);
  }, [stage, run, setRun]);

  const retryAssessment = async () => {
    const r = runRef.current; if (!r || busy) return;
    setBusy('retry'); setError('');
    try {
      if (!r.recording) {
        const local = localBlob.current?.runId === r.id ? localBlob.current : await localRecordings.get(r.id);
        if (!local) throw new ApiError('The saved recording could not be found on this device.', 0);
        localBlob.current = { runId: r.id, blob: local.blob, duration: local.duration };
        await uploadAndEvaluate(r.id, local.blob);
      } else {
        lastStage.current = { stage: '', at: Date.now() };
        const res = await api.evaluate(r.id);
        setRun(res.run);
        setProc(p => ({ ...p, status: res.run.job ? jobToStatus(res.run.job.stage, res.run) : 'transcribing', message: null, slow: false }));
      }
    } catch (e) { setProc(p => ({ ...p, status: 'failed', message: msgOf(e, 'Retry failed.') })); }
    finally { setBusy(null); }
  };
  const downloadRecording = async () => {
    const r = runRef.current; if (!r) return;
    if (r.recording) {
      try { window.location.href = await api.recordingUrl(r.id, true); } catch (e) { setProc(p => ({ ...p, message: msgOf(e, 'The recording link could not be created.') })); }
      return;
    }
    const local = localBlob.current?.runId === r.id ? localBlob.current : await localRecordings.get(r.id);
    if (!local) return;
    const url = URL.createObjectURL(local.blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `the-floor-is-yours-${r.id}.${local.blob.type.includes('ogg') ? 'ogg' : local.blob.type.includes('mp4') ? 'm4a' : 'webm'}` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const requestReview = async () => {
    const r = runRef.current; if (!r || busy) return;
    setBusy('review');
    try { const res = await api.review(r.id); setRun(res.run); setProc(p => ({ ...p, status: 'review-requested', message: null })); }
    catch (e) { setProc(p => ({ ...p, message: msgOf(e, 'The review request was not sent.') })); }
    finally { setBusy(null); }
  };
  const closeUnscored = async () => {
    const r = runRef.current; if (!r || busy) return;
    if (!window.confirm('Close this run without a score? Your issue will be unlocked. This is recorded as an unscored closure, not a completed assessment.')) return;
    setBusy('close');
    try {
      await api.closeUnscored(r.id, stage === 'mic' ? `mic:${micStatus}` : `processing:${proc.status}`);
      director.stopSpeech(); mic.release(); void localRecordings.remove(r.id);
      setRun(null); setSelected(null); idemKey.current = newKey(); setDrawer(null); setConsent(false); setMicStatus('idle'); setRecovery('');
      setNotice('That run was closed without a score.'); goto('topics');
    } catch (e) { setError(msgOf(e, 'Could not close the run. Try again.')); setProc(p => ({ ...p, message: msgOf(e, 'Could not close the run.') })); }
    finally { setBusy(null); }
  };

  // ── P07 feedback playback ─────────────────────────────────
  const assessment = run?.assessment ?? null;
  const playTurn = useCallback((i: number) => {
    if (!assessment) return;
    const t = assessment.turns[i];
    setFeedbackIndex(i);
    if (t?.audioUrl) void director.play(turnSpeechId(assessment.evaluationId, t.judgeId), t.audioUrl, t.captions ?? []);
    else director.stopSpeech();
  }, [assessment, director]);
  useEffect(() => { if (stage === 'feedback' && assessment) playTurn(feedbackIndex); }, [stage, assessment?.evaluationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage !== 'feedback' || !assessment || !autoAdvance.current) return;
    const t = assessment.turns[feedbackIndex];
    if (t && speech.id === turnSpeechId(assessment.evaluationId, t.judgeId) && speech.status === 'ended' && feedbackIndex < assessment.turns.length - 1) {
      const id = window.setTimeout(() => playTurn(feedbackIndex + 1), 450);
      return () => window.clearTimeout(id);
    }
  }, [speech.status, speech.id, stage, assessment, feedbackIndex, playTurn]);

  const viewResults = () => {
    const r = runRef.current; if (!r) return;
    director.stopSpeech(); setReplayOpen(false);
    goto('results');
    void api.toResults(r.id).then(res => setRun(res.run)).catch(() => {});
  };

  // ── P08 replay (signed, short-lived links fetched when opened) ──
  const toggleReplay = async () => {
    const r = runRef.current; if (!r) return;
    if (replayOpen) { setReplayOpen(false); return; }
    try {
      const [play, download] = await Promise.all([api.recordingUrl(r.id), caps?.recordingDownload ? api.recordingUrl(r.id, true) : Promise.resolve('')]);
      setReplayUrls({ play, download }); setReplayOpen(true);
    } catch (e) { setError(msgOf(e, 'Your recording could not be loaded.')); }
  };

  // ── P08 finish ────────────────────────────────────────────
  const finish = async () => {
    const r = runRef.current; if (!r || busy) return;
    setBusy('finish'); setError('');
    try {
      await api.finish(r.id); // closed on the server before topics unlock
      setRun(null); setSelected(null); idemKey.current = newKey(); setConsent(false); setMicStatus('idle'); setReplayOpen(false); setResumeOffer(false);
      setNotice('Simulation finished. You can choose an issue for a new run.');
      goto('topics');
    } catch (e) { setError(msgOf(e, 'Could not finish.')); }
    finally { setBusy(null); }
  };

  // ── Resume ────────────────────────────────────────────────
  const resume = async () => {
    void director.unlock();
    setBusy('resume'); setError('');
    try {
      const { run: r } = await api.active();
      setResumeOffer(false);
      if (!r) { setRun(null); goto('topics'); return; }
      setRun(r);
      if (r.status === 'active') {
        if (r.stage === 'briefing') { goto('briefing'); playBriefing(topicById(r.topicId)); return; }
        if (r.captureInProgress && !capture.active) {
          const local = await localRecordings.get(r.id);
          if (!local) { setResumeOffer(true); setError('A recording may still be running in another tab or window. Let it finish there. If the recording was closed or reloaded, wait one minute and press Resume to record again — it won’t count as your speech.'); return; }
        }
        if (r.captureInterrupted || r.captureInProgress) {
          const local = await localRecordings.get(r.id);
          if (local) {
            localBlob.current = { runId: r.id, blob: local.blob, duration: local.duration };
            setProc({ status: 'uploading', saved: 'device', message: null, slow: false }); goto('processing');
            void uploadAndEvaluate(r.id, local.blob); return;
          }
          await technicalRecovery(r.id, 'interrupted-reload'); return;
        }
        goto('mic'); return;
      }
      if (r.status === 'complete' && r.assessment) { setFeedbackIndex(0); goto(r.stage === 'results' ? 'results' : 'feedback'); return; }
      // submitted / review-requested / complete-but-still-voicing
      setProc({ status: r.job ? jobToStatus(r.job.stage, r) : 'transcribing', saved: 'server', message: r.job?.message ?? null, slow: false });
      goto('processing');
      if (!r.job) { const ev = await api.evaluate(r.id); setRun(ev.run); }
    } catch (e) { setError(msgOf(e, 'Could not resume. Try again.')); }
    finally { setBusy(null); }
  };

  // ── Rendering ─────────────────────────────────────────────
  // Optional institutional opener: only when the approved logo asset exists; skippable; never blocks.
  if (typeof splashLogo === 'string' && !splashDone) return <P00Splash logo={splashLogo} onDone={() => setSplashDone(true)} />;

  const steps: Steps = run?.job?.steps ?? { received: proc.saved === 'server', transcribed: false, assessed: false, voiced: false };

  let page: React.ReactNode = null;
  let scene = 'welcome';
  if (boot === 'offline') {
    page = <Scene label="Offline"><Rise key="l"><AgentLine text="I can’t reach the server." focus /></Rise><Rise key="s"><p className="quiet-line">Check your connection. Nothing has been lost.</p></Rise><Rise key="b" className="center"><button className="primary" onClick={() => void loadSession()}>Try again</button></Rise></Scene>;
  } else if (boot === 'loading') {
    page = <Scene label="Loading"><Rise key="o" className="center"><div className="think"><AgentMark working /></div></Rise></Scene>;
  } else if (stage === 'welcome') {
    page = resumeOffer && run && topic
      ? <P01Resume name={name} topic={topic} busy={busy === 'resume'} error={error} onResume={() => void resume()} />
      : <P01Welcome initialName={name} busy={busy === 'name'} error={error} onContinue={n => void submitName(n)} />;
  } else if (stage === 'topics') {
    scene = 'topics';
    page = <P02Topics name={name} selected={selected} busy={busy === 'create'} error={error} notice={notice}
      onSelect={id => { setSelected(id); setError(''); }} onEnter={() => void enterBriefing()} />;
  } else if (stage === 'briefing' && topic) {
    scene = 'briefing';
    page = <P03Briefing topic={topic} speech={speech} captions={prefs.captions} onCaptions={c => setPrefs({ ...prefs, captions: c })}
      onPlay={() => (speech.id === `brief-${topic.id}` && speech.status === 'paused' ? void director.resume() : playBriefing())}
      onPause={() => director.pause()} onReplay={() => playBriefing()} onSkip={() => director.stopSpeech()} onContinue={() => void continueToPanel()} busy={busy === 'brief'} error={error} />;
  } else if (stage === 'mic') {
    scene = 'panel';
    page = <P04MicCheck status={micStatus} level={level} consent={consent} onConsent={setConsent} onCheck={() => void checkMic()} onBegin={() => void begin()}
      onHelp={() => setDrawer('help')} onPrivacy={() => setDrawer('privacy')} chair={speech} onSkipChair={() => director.stopSpeech()} onReplayChair={playChair}
      beginning={busy === 'begin'} error={error} recovery={recovery} />;
  } else if (stage === 'recording' && topic) {
    scene = 'recording';
    page = <P05Recording topic={topic} remainingMs={remainingMs} level={level} />;
  } else if (stage === 'processing') {
    scene = 'processing';
    page = <P06Processing status={proc.status} duration={run?.recording?.duration ?? localBlob.current?.duration ?? null} saved={run?.recording ? 'server' : proc.saved} steps={steps}
      message={proc.message} slow={proc.slow} canDownload={!!caps?.recordingDownload} reviewEnabled={!!caps?.reviewQueue} receipt={run?.review?.receiptId ?? null}
      busy={!!busy} onRetry={() => void retryAssessment()} onDownload={() => void downloadRecording()} onReview={() => void requestReview()}
      onClose={() => void closeUnscored()} onHelp={() => setDrawer('help')} />;
  } else if (stage === 'feedback' && assessment) {
    scene = 'feedback';
    page = <P07Feedback assessment={assessment} duration={run?.recording?.duration ?? null} index={feedbackIndex} speech={speech} captions={prefs.captions}
      onCaptions={c => setPrefs({ ...prefs, captions: c })}
      onPlay={i => { autoAdvance.current = false; playTurn(i); }} onPause={() => director.pause()} onResume={() => void director.resume()}
      onSkip={() => { autoAdvance.current = false; director.stopSpeech(); }} onSelect={i => { autoAdvance.current = false; playTurn(i); }} onResults={viewResults} />;
  } else if (stage === 'results' && assessment && topic) {
    scene = 'results';
    page = <P08Results result={assessment} topicLabel={topic.label} finishing={busy === 'finish'} error={error} canReplay={!!run?.recording} replayOpen={replayOpen}
      recordingUrl={replayUrls?.play ?? ''} downloadUrl={replayUrls?.download ?? ''} canDownload={!!caps?.recordingDownload && !!replayUrls?.download}
      onReplay={() => void toggleReplay()} onFinish={() => void finish()} />;
  } else {
    page = <Scene label="Loading"><Rise key="b" className="center"><button className="primary" onClick={() => void loadSession()}>Reload</button></Rise></Scene>;
  }

  const closeFromMic = stage === 'mic' && ['denied', 'missing', 'busy', 'unsupported', 'insecure', 'quiet', 'lost'].includes(micStatus) ? () => void closeUnscored() : undefined;
  const helpStage = ['welcome', 'topics', 'briefing', 'mic'].includes(stage) ? stage : null; // task help is setup-only

  return (
    <MotionConfig reducedMotion="user">
      <Workspace scene={scene} name={name} outputSilenced={stage === 'recording'} prefs={prefs} onPrefs={setPrefs} caps={caps} drawer={drawer} setDrawer={setDrawer}
        recording={stage === 'recording'} helpStage={helpStage} canChangeName={!run && boot === 'ready' && stage !== 'recording'} onChangeName={() => goto('welcome')}
        onCloseRun={closeFromMic} closeRunLabel="I can’t record here — close this run without a score">
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={`${stage}-${boot}-${resumeOffer}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.3 }}>
              {page}
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      </Workspace>
    </MotionConfig>
  );
}
