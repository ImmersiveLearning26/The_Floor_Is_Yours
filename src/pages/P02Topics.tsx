import { DeviceMobile, Laptop, Users } from '@phosphor-icons/react';
import { AgentLine, Reveal, Rise, Scene, useBeats } from '../ui/UI';
import { PrismCarousel } from '../ui/PrismCarousel';
import { topics, topicById } from '../../shared/content';
import type { TopicId } from '../../shared/types';

const icons = [DeviceMobile, Laptop, Users];

/** Choose an issue: greeting, three cards; choosing reveals its question and the one action. */
export function P02Topics({ name, selected, busy, error, notice, onSelect, onEnter }: {
  name: string; selected: TopicId | null; busy: boolean; error: string; notice: string; onSelect: (id: TopicId) => void; onEnter: () => void;
}) {
  const [beat] = useBeats(1, [550]);
  const t = topicById(selected);
  return (
    <Scene label="Choose your issue">
      {notice && <Rise key="notice"><p className="quiet-line" role="status">{notice}</p></Rise>}
      <Rise key="line"><AgentLine text={`Hi ${name}. Which issue will you argue?`} focus /></Rise>
      {beat >= 1 && (
        <Rise key="cards">
          <PrismCarousel label="Choose one issue" disabled={busy} activeId={selected} onChange={id => onSelect(id as TopicId)}
            items={topics.map((tp, i) => { const Icon = icons[i]; return { id: tp.id, label: tp.label, image: tp.image, icon: <Icon weight="light" aria-hidden="true" /> }; })} />
        </Rise>
      )}
      {t && (
        <Rise key={`q-${t.id}`}>
          <p className="issue-question"><Reveal text={t.question} /></p>
        </Rise>
      )}
      {t && (
        <Rise key="go" className="center" delay={0.1}>
          <button className="primary" onClick={onEnter} disabled={busy} data-working={busy}>{busy ? 'Opening briefing…' : 'Open the briefing'}</button>
        </Rise>
      )}
      {t && !error && <Rise key="lock" delay={0.2}><p className="quiet-line">Your issue is locked once the briefing opens.</p></Rise>}
      {error && <Rise key="err"><p className="error-line" role="alert">{error}</p></Rise>}
    </Scene>
  );
}
