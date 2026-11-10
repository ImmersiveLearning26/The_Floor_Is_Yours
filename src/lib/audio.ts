import type { Cue } from '../../shared/types';

// Browser audio direction (kit integration/AudioDirector.ts, extended):
// - calm ambience only in setup states, gain-ramped, independent mute/volume (0–30%)
// - one speech channel (narration, chair, judges) with captions driven by audio.currentTime
// - everything silent before microphone capture; ambience never resumes after capture
export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'blocked' | 'error' | 'disabled';
export type SpeechSnapshot = { id: string | null; status: SpeechStatus; time: number; duration: number; cue: Cue | null; cues: Cue[] };
type Phase = 'setup' | 'capture' | 'post';

const cueCache = new Map<string, Promise<Cue[]>>();
export function loadCues(url: string): Promise<Cue[]> {
  if (!cueCache.has(url)) {
    cueCache.set(url, fetch(url).then(r => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return [];
      return r.json();
    }).then(d => Array.isArray(d) ? d : Array.isArray(d?.cues) ? d.cues : []).catch(() => []));
  }
  return cueCache.get(url)!;
}

export class AudioDirector {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private ambient: HTMLAudioElement | null = null;
  private speech = new Audio();
  private listeners = new Set<(s: SpeechSnapshot) => void>();
  private snap: SpeechSnapshot = { id: null, status: 'idle', time: 0, duration: 0, cue: null, cues: [] };
  private raf = 0;
  private ambienceOn = true;
  private volume = 0.15;
  private voicesOn = true;
  private phase: Phase = 'setup';
  private paused = false;
  ambienceAvailable = false;

  constructor(private ambienceUrl: string) {
    this.speech.preload = 'auto';
    this.speech.addEventListener('ended', () => { this.emit({ status: 'ended', time: this.speech.duration || this.snap.time, cue: null }); this.updateAmbience(); });
    this.speech.addEventListener('error', () => { if (this.snap.id) { this.emit({ status: 'error' }); this.updateAmbience(); } });
    this.speech.addEventListener('loadedmetadata', () => this.emit({ duration: this.speech.duration || 0 }));
    this.speech.addEventListener('pause', () => { if (this.snap.status === 'playing') this.emit({ status: 'paused' }); });
    this.speech.addEventListener('play', () => this.emit({ status: 'playing' }));
  }

  /** Must be called from a user gesture. Starts the ambience graph if the asset exists. */
  async unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(this.ctx.destination);
        const head = await fetch(this.ambienceUrl, { method: 'HEAD' }).catch(() => null);
        if (head?.ok && (head.headers.get('content-type') ?? '').startsWith('audio')) {
          this.ambient = new Audio(this.ambienceUrl);
          this.ambient.loop = true; this.ambient.preload = 'auto';
          this.ctx.createMediaElementSource(this.ambient).connect(this.gain);
          this.ambienceAvailable = true;
        }
      } catch { this.ambient = null; }
    }
    await this.ctx?.resume().catch(() => {});
    this.updateAmbience();
  }

  setPrefs(p: { ambience: boolean; volume: number; voices: boolean }) {
    this.ambienceOn = p.ambience; this.volume = Math.max(0, Math.min(0.3, p.volume)); this.voicesOn = p.voices;
    if (!this.voicesOn && this.snap.status === 'playing') this.stopSpeech();
    this.updateAmbience();
  }

  setPhase(phase: Phase) {
    this.phase = phase;
    this.updateAmbience(phase !== 'setup');
  }

  /** Silence everything immediately — called before microphone capture begins. */
  silenceForCapture() {
    this.stopSpeech();
    this.phase = 'capture';
    this.updateAmbience(true);
  }

  private updateAmbience(immediate = false) {
    if (!this.ctx || !this.gain) return;
    const speaking = this.snap.status === 'playing' || this.snap.status === 'loading';
    const target = this.ambienceOn && this.phase === 'setup' && !speaking && !this.paused && this.ambient ? this.volume : 0;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    if (immediate || target === 0 && speaking) this.gain.gain.linearRampToValueAtTime(target, t + (immediate ? 0.02 : 0.4));
    else this.gain.gain.linearRampToValueAtTime(target, t + 0.6);
    if (this.ambient) {
      if (target > 0 && this.ambient.paused) void this.ambient.play().catch(() => {});
      if (target === 0 && immediate) this.ambient.pause();
    }
  }

  subscribe(fn: (s: SpeechSnapshot) => void) { this.listeners.add(fn); fn(this.snap); return () => { this.listeners.delete(fn); }; }
  get snapshot() { return this.snap; }
  private emit(p: Partial<SpeechSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach(l => l(this.snap)); }

  private trackTime() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      const t = this.speech.currentTime;
      const cue = this.snap.cues.find(c => t >= c.start && t < c.end + 0.25) ?? (this.snap.cues.length && t >= this.snap.cues[this.snap.cues.length - 1].end ? this.snap.cues[this.snap.cues.length - 1] : null);
      if (Math.abs(t - this.snap.time) > 0.05 || cue !== this.snap.cue) this.emit({ time: t, cue });
      if (!this.speech.paused) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Play a speech item. Never throws; returns the resulting status. */
  async play(id: string, src: string, cues: Cue[] | string | null = null): Promise<SpeechStatus> {
    if (this.phase === 'capture') return 'error';
    if (!this.voicesOn) { this.emit({ id, status: 'disabled', time: 0, cue: null, cues: [] }); return 'disabled'; }
    this.speech.pause();
    this.emit({ id, status: 'loading', time: 0, duration: 0, cue: null, cues: [] });
    this.updateAmbience();
    const list = typeof cues === 'string' ? await loadCues(cues) : cues ?? [];
    if (this.snap.id !== id) return 'idle'; // superseded
    this.emit({ cues: list });
    if (this.speech.src !== new URL(src, location.href).href) this.speech.src = src;
    this.speech.currentTime = 0;
    try {
      await this.speech.play();
      this.trackTime();
      return 'playing';
    } catch (e) {
      const blocked = (e as DOMException)?.name === 'NotAllowedError';
      this.emit({ status: blocked ? 'blocked' : 'error' });
      this.updateAmbience();
      return blocked ? 'blocked' : 'error';
    }
  }

  pause() { this.speech.pause(); this.emit({ status: 'paused' }); }
  async resume() {
    if (this.phase === 'capture' || !this.snap.id) return;
    try { await this.speech.play(); this.trackTime(); } catch { this.emit({ status: 'blocked' }); }
  }
  async replay() {
    if (!this.snap.id) return;
    this.speech.currentTime = 0;
    this.emit({ time: 0, cue: null });
    await this.resume();
  }
  seek(t: number) { if (Number.isFinite(t)) { this.speech.currentTime = t; this.emit({ time: t }); } }
  stopSpeech() {
    cancelAnimationFrame(this.raf);
    this.speech.pause();
    if (this.snap.id) this.emit({ id: null, status: 'idle', time: 0, duration: 0, cue: null, cues: [] });
    this.updateAmbience();
  }
}
