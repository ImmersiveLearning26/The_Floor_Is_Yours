// One-shot capture service. Owns the MediaRecorder and the 60 s deadline using a monotonic
// clock (performance.now) anchored at the recorder's own 'start' event. Survives React re-renders
// because it lives outside components. The server re-verifies and trims to 60.0 s regardless.
export const MAX_MS = 60_000;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
export const pickMime = () => MIME_CANDIDATES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? '';

export type CaptureResult = { blob: Blob; duration: number };
export type CaptureFailure = { reason: string };

export class CaptureService {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private deadline = 0;
  private tick = 0;
  private settled = false;
  onTick: (remainingMs: number) => void = () => {};
  onComplete: (r: CaptureResult) => void = () => {};
  onFailure: (f: CaptureFailure) => void = () => {};

  get active() { return !!this.recorder && this.recorder.state !== 'inactive'; }
  get elapsedMs() { return this.startedAt ? performance.now() - this.startedAt : 0; }

  /** Resolves only once the recorder has actually started. Double calls are ignored. */
  start(stream: MediaStream): Promise<void> {
    if (this.recorder) return Promise.reject(new Error('A capture is already running.'));
    const mimeType = pickMime();
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined); }
    catch { return Promise.reject(new Error('Recording is not supported in this browser.')); }
    this.recorder = rec; this.chunks = []; this.settled = false;
    return new Promise((resolve, reject) => {
      const startTimeout = window.setTimeout(() => { if (!this.startedAt) { this.fail('recorder-start-timeout'); reject(new Error('The recorder did not start.')); } }, 4000);
      rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      rec.onerror = () => this.fail('recorder-error');
      rec.onstart = () => {
        window.clearTimeout(startTimeout);
        this.startedAt = performance.now();
        this.deadline = window.setTimeout(() => this.stop(), MAX_MS);
        const loop = () => {
          const remaining = MAX_MS - (performance.now() - this.startedAt);
          this.onTick(Math.max(0, remaining));
          if (remaining <= 0) this.stop(); // backup for throttled timers
          else this.tick = window.setTimeout(loop, 200);
        };
        loop();
        resolve();
      };
      rec.onstop = () => this.finalize();
      stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (this.active) this.fail('track-ended'); }, { once: true }));
      try { rec.start(1000); } catch { window.clearTimeout(startTimeout); this.fail('recorder-start-failed'); reject(new Error('The recorder could not start.')); }
    });
  }

  stop() {
    window.clearTimeout(this.deadline); window.clearTimeout(this.tick);
    if (this.recorder && this.recorder.state !== 'inactive') { try { this.recorder.requestData(); } catch { /* ignore */ } this.recorder.stop(); }
  }

  private finalize() {
    if (this.settled) return;
    const duration = Math.min(MAX_MS, performance.now() - this.startedAt) / 1000;
    const type = this.recorder?.mimeType || pickMime() || 'audio/webm';
    const blob = new Blob(this.chunks, { type });
    this.reset();
    if (!blob.size || duration < 0.5) { this.settled = true; this.onFailure({ reason: 'empty-recording' }); return; }
    this.settled = true;
    this.onComplete({ blob, duration });
  }

  private fail(reason: string) {
    if (this.settled) return;
    this.settled = true;
    window.clearTimeout(this.deadline); window.clearTimeout(this.tick);
    try { if (this.recorder && this.recorder.state !== 'inactive') { this.recorder.onstop = null; this.recorder.stop(); } } catch { /* ignore */ }
    this.reset();
    this.onFailure({ reason });
  }

  private reset() { this.recorder = null; this.chunks = []; this.startedAt = 0; }
}
