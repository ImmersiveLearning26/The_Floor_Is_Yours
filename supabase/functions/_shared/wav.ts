// WAV (PCM 16-bit) handling in plain TypeScript, so the server can verify, trim and measure the recording
// without ffmpeg — Lovable Cloud edge functions cannot run native binaries. The browser converts its
// MediaRecorder capture to 16 kHz mono WAV before upload (src/lib/wav.ts); the server trusts only the bytes.
export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataBytes: number; duration: number };

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12, fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= bytes.length) {
    const id = ascii(bytes, o, 4), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ' && size >= 16) fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 8000 || fmt.rate > 48000) return null;
      const dataBytes = Math.min(size, bytes.length - body) - (Math.min(size, bytes.length - body) % (2 * fmt.channels));
      return { sampleRate: fmt.rate, channels: fmt.channels, bitsPerSample: 16, dataOffset: body, dataBytes, duration: dataBytes / (fmt.rate * fmt.channels * 2) };
    }
    o = body + size + (size % 2);
  }
  return null;
}

export function encodeWav(pcm: Int16Array, sampleRate: number, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}

/** Re-encode keeping only the first `seconds` of audio (server-side enforcement of the 60.0 s limit). */
export function trimWav(bytes: Uint8Array, info: WavInfo, seconds: number): Uint8Array {
  const frame = info.channels * 2;
  const keep = Math.min(info.dataBytes, Math.floor(seconds * info.sampleRate) * frame);
  const pcm = new Int16Array(bytes.slice(info.dataOffset, info.dataOffset + keep).buffer);
  return encodeWav(pcm, info.sampleRate, info.channels);
}

/** Peak level in dBFS (-120 for digital silence). */
export function peakDb(bytes: Uint8Array, info: WavInfo): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataBytes);
  let peak = 0;
  for (let i = 0; i + 1 < info.dataBytes; i += 2) { const s = Math.abs(v.getInt16(i, true)); if (s > peak) peak = s; }
  return peak === 0 ? -120 : Number((20 * Math.log10(peak / 32768)).toFixed(1));
}

/** Mono float samples (for speech-to-text engines that want raw PCM). */
export function monoFloat(bytes: Uint8Array, info: WavInfo): Float32Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataBytes);
  const frames = info.dataBytes / (2 * info.channels), out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < info.channels; c++) sum += v.getInt16((f * info.channels + c) * 2, true);
    out[f] = sum / info.channels / 32768;
  }
  return out;
}
