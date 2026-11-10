import { useState } from 'react';
import { motion } from 'motion/react';
import { Rise, Scene, useBeats, EASE } from '../ui/UI';
import { RecordingPlayer } from '../ui/RecordingPlayer';
import { criterionLabels, pointsFor, weights } from '../../shared/scoring';
import type { Assessment, CriterionId } from '../../shared/types';

const order: CriterionId[] = ['position', 'reasoning', 'structure', 'delivery'];

/** The result, revealed in layers: score → criteria → what to keep and change → finish. No counting animation. */
export function P08Results({ result, finishing, error, canReplay, replayOpen, recordingUrl, downloadUrl, canDownload, onReplay, onFinish }: {
  result: Assessment; topicLabel: string; finishing: boolean; error: string; canReplay: boolean; replayOpen: boolean;
  recordingUrl: string; downloadUrl: string; canDownload: boolean; onReplay: () => void; onFinish: () => void;
}) {
  const [beat] = useBeats(2, [900, 900]);
  const [evidence, setEvidence] = useState(false);
  const ratings = order.map(id => result.ratings.find(r => r.id === id)!).filter(Boolean);
  return (
    <Scene label="Your result">
      <Rise key="score">
        <motion.p className="score" tabIndex={-1} aria-label={`${result.scoreRounded} out of 100, ${result.band}`}
          initial={{ opacity: 0, scale: 0.92, filter: 'blur(16px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: 0.9, ease: EASE }}>
          {result.scoreRounded}<span>/ 100</span>
        </motion.p>
      </Rise>
      <Rise key="band" delay={0.35}><span className="band">{result.band}</span></Rise>
      {result.scoreExact !== result.scoreRounded && <Rise key="round" delay={0.45}><p className="rounded">Rounded from {result.scoreExact.toFixed(2)}</p></Rise>}
      {beat >= 1 && (
        <Rise key="criteria">
          <div className="criteria">
            {ratings.map((r, i) => (
              <motion.div className="crit" key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: i * 0.07 }}>
                <span>{criterionLabels[r.id]}</span>
                <span className="bar" aria-hidden="true"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: r.level / 4 }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 + i * 0.07 }} /></span>
                <span className="pts">{pointsFor(r.id, r.level).toFixed(2)} / {weights[r.id]}</span>
              </motion.div>
            ))}
          </div>
        </Rise>
      )}
      {beat >= 2 && (
        <Rise key="take">
          <div className="takeaways">
            <div className="takeaway"><b>Keep</b><span>{result.strength}</span></div>
            <div className="takeaway"><b>Next time</b><span>{result.improvement}</span></div>
          </div>
        </Rise>
      )}
      {beat >= 2 && (
        <Rise key="actions" className="center" delay={0.15}>
          <div className="row">
            <button className="primary" onClick={onFinish} disabled={finishing} data-working={finishing}>{finishing ? 'Finishing…' : 'Finish simulation'}</button>
            {canReplay && <button className="link-button" onClick={onReplay} aria-expanded={replayOpen}>{replayOpen ? 'Hide recording' : 'Replay recording'}</button>}
            <button className="link-button" onClick={() => setEvidence(e => !e)} aria-expanded={evidence}>{evidence ? 'Hide evidence' : 'Why this score'}</button>
          </div>
        </Rise>
      )}
      {replayOpen && canReplay && <Rise key="player"><div className="pill-wrap"><div className="pill"><RecordingPlayer src={recordingUrl} canDownload={canDownload} downloadUrl={downloadUrl} /></div></div></Rise>}
      {evidence && (
        <Rise key="evidence">
          <div className="evidence">
            {ratings.map(r => (
              <div key={r.id}>
                <h3>{criterionLabels[r.id]} · level {r.level} of 4</h3>
                <p>{r.justification}</p>
                {r.evidence.map((e, i) => <p key={i}><span className="muted">{e.start.toFixed(1)}–{e.end.toFixed(1)}s · {e.source === 'audio' ? 'heard' : 'said'}</span> — {e.quote && <q>{e.quote}</q>} {e.observation}</p>)}
              </div>
            ))}
            <p className="muted" style={{ marginTop: 10 }}>AI estimate (rubric v{result.rubricVersion}). Your facilitator can review and override it.</p>
          </div>
        </Rise>
      )}
      {error && <Rise key="err"><p className="error-line" role="alert">{error} Your result is still saved — try Finish again.</p></Rise>}
    </Scene>
  );
}
