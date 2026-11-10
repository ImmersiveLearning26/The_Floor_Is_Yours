import type { MicStatus } from '../../shared/types';

// Microphone acquisition + visual-only level analysis. The analyser is never connected
// to the speakers and nothing here records, transmits or scores audio.
export class MicService {
  stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private smooth = 0;
  private samples: Float32Array<ArrayBuffer> | null = null;
  onLevel: (v: number) => void = () => {};
  onLost: () => void = () => {};

  static support(): MicStatus | null {
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'unsupported';
    return null;
  }

  async acquire(): Promise<MicStatus> {
    const unsupported = MicService.support();
    if (unsupported) return unsupported;
    if (this.stream?.getAudioTracks().some(t => t.readyState === 'live')) return 'listening';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      const name = (e as DOMException)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing'
        : name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'unsupported';
    }
    const track = this.stream.getAudioTracks()[0];
    if (!track) return 'missing';
    track.addEventListener('ended', () => this.onLost());
    await this.startAnalysis();
    return 'listening';
  }

  private async startAnalysis() {
    this.stopAnalysis();
    if (!this.stream) return;
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser); // deliberately NOT connected to destination
    this.samples = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    await this.ctx.resume().catch(() => {});
    let last = 0;
    const frame = (t: number) => {
      if (!this.analyser || !this.samples) return;
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
      const rms = Math.sqrt(sum / this.samples.length);
      const target = Math.min(1, Math.max(0, (rms - 0.006) * 9));
      // ~60–100 ms attack, ~160 ms release
      this.smooth += (target - this.smooth) * (target > this.smooth ? 0.4 : 0.12);
      if (t - last > 40) { this.onLevel(this.smooth); last = t; }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  get contextState() { return this.ctx?.state ?? 'closed'; }
  async resume() { await this.ctx?.resume().catch(() => {}); }

  stopAnalysis() {
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.analyser = null; this.source = null; this.smooth = 0;
    this.onLevel(0);
  }

  release() {
    this.stopAnalysis();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  get live() { return !!this.stream?.getAudioTracks().some(t => t.readyState === 'live' && t.enabled); }
}
