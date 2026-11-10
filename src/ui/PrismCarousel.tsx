import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

/**
 * Prism Carousel — an original 3D ring carousel (inspired by "prism ring" carousels). Items sit on the front arc
 * of a ring; the centre item is active, its neighbours tilt away on either side, and an iridescent prism edge +
 * light sweep shift as the ring turns. Infinite: an item travelling round the back fades out on one side and in
 * on the other. Turn with drag/swipe, arrow keys, the side arrows, or by clicking a side item.
 * Accessible as a radiogroup: the centre item is the checked radio.
 */
export type PrismItem = { id: string; label: string; image: string; icon?: ReactNode };

const SPACING = 44; // degrees between neighbours on the arc

export function PrismCarousel({ items, activeId, onChange, disabled = false, label }: {
  items: PrismItem[]; activeId: string | null; onChange: (id: string) => void; disabled?: boolean; label: string;
}) {
  const reduce = useReducedMotion();
  const n = items.length;
  const startIndex = Math.max(0, items.findIndex(i => i.id === activeId));
  const [pos, setPos] = useState(startIndex); // continuous position: which item is at the centre
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  const drag = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);
  const anim = useRef<ReturnType<typeof animate> | null>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => { const r = () => setWidth(window.innerWidth); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  useEffect(() => () => anim.current?.stop(), []);

  const card = width < 560 ? Math.min(240, width * 0.6) : width < 900 ? 270 : 300;
  const radius = card * 1.32;
  const front = ((Math.round(pos) % n) + n) % n;

  // the parent's selection follows the centre item
  useEffect(() => { if (items[front] && items[front].id !== activeId) onChange(items[front].id); }, [front]); // eslint-disable-line react-hooks/exhaustive-deps

  const glideTo = useCallback((target: number) => {
    anim.current?.stop();
    if (reduce) { setPos(target); return; }
    anim.current = animate(pos, target, { type: 'spring', stiffness: 120, damping: 20, mass: 0.9, onUpdate: setPos });
  }, [pos, reduce]);
  const turnBy = (d: number) => { if (!disabled) glideTo(Math.round(pos) + d); };
  const turnTo = (i: number) => { // shortest way round to item i
    if (disabled) return;
    let d = i - (((Math.round(pos) % n) + n) % n);
    if (d > n / 2) d -= n; if (d < -n / 2) d += n;
    glideTo(Math.round(pos) + d);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); turnBy(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); turnBy(-1); }
  };
  const onDown = (e: PointerEvent) => { if (disabled) return; anim.current?.stop(); moved.current = false; drag.current = { x: e.clientX, base: pos }; };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 5) { moved.current = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }
    if (moved.current) setPos(drag.current.base - dx / (card * 0.85));
  };
  const onUp = () => { if (!drag.current) return; const was = moved.current; drag.current = null; if (was) glideTo(Math.round(pos)); };

  // keep keyboard focus on the centre radio as it changes
  useEffect(() => { if (ring.current?.contains(document.activeElement)) (ring.current.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus({ preventScroll: true }); }, [front]);

  return (
    <div className="prism" style={{ '--card': `${card}px`, '--prism-turn': `${pos * SPACING}deg` } as CSSProperties}>
      <button type="button" className="prism-arrow left" aria-label="Previous issue" onClick={() => turnBy(-1)} disabled={disabled}><CaretLeft weight="bold" /></button>
      <div className="prism-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={ring} className="prism-ring" role="radiogroup" aria-label={label} onKeyDown={onKey} style={{ transform: `translateZ(${-radius}px)` }}>
          {items.map((it, i) => {
            let rel = i - pos; // signed distance from the centre, wrapped to (−n/2, n/2]
            rel = ((rel % n) + n) % n; if (rel > n / 2) rel -= n;
            const dist = Math.abs(rel);
            const opacity = dist <= 1 ? 1 - dist * 0.42 : Math.max(0, 0.58 - (dist - 1) * 1.16); // fades out round the back
            const isFront = i === front;
            return (
              <button key={it.id} type="button" role="radio" aria-checked={isFront} aria-label={it.label} tabIndex={isFront ? 0 : -1} disabled={disabled}
                className="issue prism-card" data-front={isFront}
                style={{ opacity, transform: `rotateY(${rel * SPACING}deg) translateZ(${radius}px) scale(${1 - Math.min(1, dist) * 0.08})`,
                  filter: `blur(${(Math.min(1.2, dist) * 1.6).toFixed(2)}px) saturate(${1 - Math.min(1, dist) * 0.35})`,
                  zIndex: Math.round(100 - dist * 40), visibility: opacity < 0.02 ? 'hidden' : 'visible' } as CSSProperties}
                onClick={() => { if (!moved.current && !isFront) turnTo(i); }}>
                <span className="prism-edge" aria-hidden="true" />
                <span className="thumb"><img src={it.image} alt="" draggable={false} /><span className="prism-sheen" aria-hidden="true" /></span>
                <span className="label">{it.icon}{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" className="prism-arrow right" aria-label="Next issue" onClick={() => turnBy(1)} disabled={disabled}><CaretRight weight="bold" /></button>
      <div className="prism-dots" aria-hidden="true">{items.map((it, i) => <i key={it.id} data-on={i === front} />)}</div>
    </div>
  );
}
