import { DownloadSimple } from '@phosphor-icons/react';
import { AgentMark, Reveal, Rise, Scene } from '../ui/UI';
import type { ProcessingStatus } from '../../shared/types';

export type Steps = { received: boolean; transcribed: boolean; assessed: boolean; voiced: boolean };

const line: Record<ProcessingStatus, string> = {
  uploading: 'Saving your speech…', transcribing: 'Listening back to your speech…', assessing: 'Weighing your argument…', voicing: 'The panel is preparing feedback…',
  failed: 'I can’t assess this right now.', 'needs-review': 'This needs a person to review it.', 'review-requested': 'A reviewer has your recording.',
};

/** The agent at work: one glowing orb and one line that changes with each real stage. Recovery only when needed. */
export function P06Processing({ status, saved, message, slow, canDownload, reviewEnabled, receipt, busy, onRetry, onDownload, onReview, onClose }: {
  status: ProcessingStatus; duration: number | null; saved: 'device' | 'server' | 'none'; steps: Steps; message: string | null; slow: boolean;
  canDownload: boolean; reviewEnabled: boolean; receipt: string | null; busy: boolean;
  onRetry: () => void; onDownload: () => void; onReview: () => void; onClose: () => void; onHelp: () => void;
}) {
  const active = ['uploading', 'transcribing', 'assessing', 'voicing'].includes(status);
  const stalled = status === 'failed' || status === 'needs-review';
  const sub = saved === 'server' ? 'Your recording is saved securely.' : saved === 'device' ? 'Your recording is saved on this device.' : 'Keep this tab open for a moment.';
  return (
    <Scene label="Assessment">
      <Rise key="orb" className="center"><div className="think" data-idle={!active}><AgentMark working={active} /></div></Rise>
      <Rise key="line">
        <p className="status-line" data-working={active} role="status" aria-live="polite"><Reveal key={status} text={line[status]} /></p>
      </Rise>
      <Rise key="sub" delay={0.1}><p className="quiet-line">{status === 'review-requested' ? `Receipt ${receipt}. You can leave and come back.` : sub}</p></Rise>
      {(stalled || slow) && message && <Rise key="why"><p className="hint-line" role="alert">{message}</p></Rise>}
      {slow && !stalled && <Rise key="slow"><p className="quiet-line">This is taking longer than usual.</p></Rise>}
      {(stalled || slow) && (
        <Rise key="actions" className="center">
          <div className="row">
            <button className="primary" onClick={onRetry} disabled={busy}>Try again with the same recording</button>
            {canDownload && stalled && <button className="ghost" onClick={onDownload}><DownloadSimple /> Save recording</button>}
            {stalled && reviewEnabled && <button className="ghost" onClick={onReview} disabled={busy}>Ask for a review</button>}
          </div>
        </Rise>
      )}
      {(stalled || status === 'review-requested') && (
        <Rise key="close" className="center" delay={0.1}>
          <p className="quiet-line">No score is shown until a reliable assessment exists.</p>
          <button className="link-button" onClick={onClose} disabled={busy}>Close this run without a score</button>
          {canDownload && status === 'review-requested' && <button className="link-button" onClick={onDownload}>Save recording</button>}
        </Rise>
      )}
    </Scene>
  );
}
