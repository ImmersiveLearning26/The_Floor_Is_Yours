import { useEffect, useRef, useState } from 'react';
import { DownloadSimple, Pause, Play } from '@phosphor-icons/react';
import { fmtTime } from './UI';

/** Passive replay of the learner's own saved recording (owner-only URL). */
export function RecordingPlayer({ src, canDownload, downloadUrl }: { src: string; canDownload: boolean; downloadUrl: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <div className="player" role="group" aria-label="Your recording">
      <audio ref={audio} src={src} preload="metadata" onTimeUpdate={e => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setD(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} onDurationChange={e => Number.isFinite(e.currentTarget.duration) && setD(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setFailed(true)} />
      {failed ? <span>Recording playback isn’t available.</span> : <>
        <button aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play().catch(() => setFailed(true)))}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
        <time>{fmtTime(t)} / {d ? fmtTime(d) : '–:––'}</time>
        <input type="range" min={0} max={d || 60} step={0.1} value={t} aria-label="Seek recording" onChange={e => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} />
        {canDownload && <a className="icon-button" href={downloadUrl} aria-label="Download recording"><DownloadSimple weight="light" /></a>}
      </>}
    </div>
  );
}
