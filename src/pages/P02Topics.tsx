import { motion } from 'motion/react';
import { Check, DeviceMobile, Laptop, Users } from '@phosphor-icons/react';
import { AgentLine, Reveal, Rise, Scene, useBeats, EASE } from '../ui/UI';
import { topics, topicById } from '../../shared/content';
import type { TopicId } from '../../shared/types';

const icons = [DeviceMobile, Laptop, Users];

/** Choose an issue: one line, three quiet image cards; choosing one reveals its question and the single action. */
export function P02Topics({ name, selected, busy, error, notice, onSelect, onEnter }: {
  name: string; selected: TopicId | null; busy: boolean; error: string; notice: string; onSelect: (id: TopicId) => void; onEnter: () => void;
}) {
  const [beat] = useBeats(1, [450]);
  const t = topicById(selected);
  return (
    <Scene label="Choose your issue">
      {notice && <Rise key="notice"><p className="quiet-line" role="status">{notice}</p></Rise>}
      <Rise key="line"><AgentLine text={`Hi ${name}. Pick your issue.`} focus /></Rise>
      {beat >= 1 && (
        <Rise key="cards">
          <div className="issues" role="radiogroup" aria-label="Choose one issue" data-has={!!selected}>
            {topics.map((tp, i) => {
              const Icon = icons[i];
              const on = selected === tp.id;
              return (
                <motion.button key={tp.id} type="button" role="radio" aria-checked={on} aria-describedby={on ? 'issue-question' : undefined}
                  className="issue" data-selected={on} disabled={busy} onClick={() => onSelect(tp.id)}
                  initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.5, ease: EASE, delay: i * 0.08 }}>
                  <span className="thumb"><img src={tp.image} alt="" draggable={false} /></span>
                  <span className="label"><Icon weight="light" aria-hidden="true" /><span>{tp.label}</span></span>
                  {on && <span className="tick" aria-hidden="true"><Check weight="bold" /></span>}
                </motion.button>
              );
            })}
          </div>
        </Rise>
      )}
      {t && <Rise key={`q-${t.id}`}><p className="issue-question" id="issue-question"><Reveal text={t.question} /></p></Rise>}
      {t && (
        <Rise key="go" className="center" delay={0.08}>
          <button className="primary" onClick={onEnter} disabled={busy} data-working={busy}>{busy ? 'Opening…' : 'Open the briefing'}</button>
          <p className="quiet-line" style={{ marginTop: 10 }}>This locks your choice.</p>
        </Rise>
      )}
      {error && <Rise key="err"><p className="error-line" role="alert">{error}</p></Rise>}
    </Scene>
  );
}
