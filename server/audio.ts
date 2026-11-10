import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import crypto from 'node:crypto';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export type Sniffed = { mimeType: string; ext: string } | null;

// MIME sniffing from magic bytes; the client-declared type is never trusted.
export function sniff(buf: Buffer): Sniffed {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return { mimeType: 'audio/webm', ext: 'webm' };
  if (buf.toString('ascii', 0, 4) === 'OggS') return { mimeType: 'audio/ogg', ext: 'ogg' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { mimeType: 'audio/mp4', ext: 'm4a' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return { mimeType: 'audio/wav', ext: 'wav' };
  return null;
}

export const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

/** Decodes the whole file (not just the header) and returns the decoded duration in seconds. */
export async function decodedDuration(file: string): Promise<number> {
  // ffmpeg reports progress time while decoding to null; the last time= value is the decoded length.
  const { stderr } = await run(FFMPEG, ['-hide_banner', '-nostats', '-v', 'info', '-i', file, '-vn', '-f', 'null', '-'], { maxBuffer: 8e6, timeout: 60000 })
    .catch(e => { throw new Error(`Audio could not be decoded (${String(e.stderr || e.message).split('\n').filter(Boolean).pop()})`); });
  const probe = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file], { timeout: 20000 }).catch(() => ({ stdout: '' }));
  const fromProbe = Number(String(probe.stdout).trim());
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times.pop();
  const fromDecode = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
  if (!stderr.includes('Audio:')) throw new Error('No audio stream found.');
  // MediaRecorder WebM often lacks a container duration; prefer the decoded length.
  const d = Number.isFinite(fromDecode) && fromDecode > 0 ? fromDecode : fromProbe;
  if (!Number.isFinite(d) || d <= 0) throw new Error('Audio duration could not be verified.');
  return d;
}

/** Enforce the 60.0 s limit server-side by re-encoding the first 60 seconds. */
export async function trimTo(file: string, out: string, seconds: number, ext: string) {
  const codec = ext === 'webm' || ext === 'ogg' ? ['-c:a', 'libopus', '-b:a', '64k'] : ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '96k'];
  await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', file, '-t', String(seconds), '-vn', ...codec, out], { timeout: 60000 });
}

export async function maxVolumeDb(file: string): Promise<number | null> {
  try {
    const { stderr } = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { maxBuffer: 8e6, timeout: 60000 });
    const m = stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
    if (!m) return null;
    return m[1] === '-inf' ? -120 : Number(m[1]);
  } catch { return null; }
}

/** Provider-friendly copy (mp3) for evaluators that do not accept WebM/Opus. */
export async function toMp3(file: string): Promise<Buffer> {
  const out = `${file}.eval.mp3`;
  await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '64k', out], { timeout: 60000 });
  const buf = await fs.promises.readFile(out);
  await fs.promises.unlink(out).catch(() => {});
  return buf;
}
