// Converts the browser's MediaRecorder capture (WebM/Opus, MP4/AAC…) into a 16 kHz mono 16-bit WAV
// before upload. The server can then verify, trim and measure the recording in plain TypeScript (no
// ffmpeg on Lovable Cloud), and every speech-to-text and audio model accepts the format. ≈1.9 MB per minute.
import { encodeWav } from '../../supabase/functions/_shared/wav.ts';

const RATE = 16000;

export async function toWav16k(blob: Blob): Promise<Blob> {
  if (blob.type === 'audio/wav') return blob;
  const bytes = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  let decoded: AudioBuffer;
  try { decoded = await ac.decodeAudioData(bytes.slice(0)); }
  finally { void ac.close().catch(() => {}); }
  const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
  const off = new OfflineAudioContext(1, frames, RATE);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) { const s = Math.max(-1, Math.min(1, mono[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return new Blob([encodeWav(pcm, RATE) as unknown as BlobPart], { type: 'audio/wav' });
}
