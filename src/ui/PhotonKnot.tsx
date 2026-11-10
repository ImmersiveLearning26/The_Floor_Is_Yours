import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Photon Knot — an original ambient background: streams of light ("photons") flowing along a slowly turning
 * (2,3) torus knot, drawn on a 2D canvas in the agent's blue/violet palette over the greige canvas.
 * `intensity` 0–1 controls visibility; at 0 the canvas fades out and the animation loop stops entirely
 * (no CPU/GPU work while the learner is speaking or being assessed). Reduced motion renders one still frame.
 */
const P = 2, Q = 3, COUNT = 300, TRAIL = 5;
type Photon = { t: number; speed: number; size: number; hue: number; lane: number };

function knot(t: number, lane: number): [number, number, number] {
  const r = Math.cos(Q * t) + 2.25 + lane * 0.09;
  return [r * Math.cos(P * t), r * Math.sin(P * t), -Math.sin(Q * t) * 1.15 + lane * 0.05];
}

export function PhotonKnot({ intensity }: { intensity: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const level = useRef(intensity);
  level.current = intensity;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now(), angle = 0, running = false;
    const photons: Photon[] = Array.from({ length: COUNT }, (_, i) => ({
      t: (i / COUNT) * Math.PI * 2 + Math.random() * 0.02,
      speed: 0.045 + Math.random() * 0.06,
      size: 0.6 + Math.random() * 1.6,
      hue: Math.random(),
      lane: (Math.random() - 0.5) * 2,
    }));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth; h = window.innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    };

    const project = (x: number, y: number, z: number) => {
      // slow rotation about two axes
      const ca = Math.cos(angle), sa = Math.sin(angle), cb = Math.cos(angle * 0.37 + 0.6), sb = Math.sin(angle * 0.37 + 0.6);
      const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
      const y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
      const scale = Math.min(w, h) * 0.13;
      const f = 7 / (7 + z2);
      return { x: w * 0.5 + x1 * scale * f, y: h * 0.47 + y1 * scale * f, z: z2, f };
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // faint guide of the knot itself
      ctx.beginPath();
      for (let i = 0; i <= 420; i++) {
        const [x, y, z] = knot((i / 420) * Math.PI * 2, 0);
        const p = project(x, y, z);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = 'rgba(51, 135, 250, 0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // photons with short trails; nearer photons are brighter and wider
      ctx.lineCap = 'round';
      for (const ph of photons) {
        const pts = [];
        for (let k = 0; k < TRAIL; k++) {
          const [x, y, z] = knot(ph.t - k * 0.018, ph.lane);
          pts.push(project(x, y, z));
        }
        const head = pts[0];
        const depth = Math.max(0, Math.min(1, (head.z + 3.5) / 7)); // 0 near → 1 far
        const alpha = 0.46 - depth * 0.34;
        const rgb = ph.hue < 0.62 ? '51, 135, 250' : ph.hue < 0.88 ? '139, 123, 255' : '114, 182, 250';
        ctx.beginPath();
        ctx.moveTo(head.x, head.y);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.28})`;
        ctx.lineWidth = ph.size * head.f * 3.2;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
        ctx.lineWidth = ph.size * head.f;
        ctx.stroke();
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      angle += dt * 0.06;
      for (const ph of photons) ph.t += ph.speed * dt;
      draw();
      // stop the loop once fully faded out
      if (level.current <= 0 && parseFloat(getComputedStyle(cv).opacity) < 0.01) { running = false; return; }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (running || reduce || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); };

    resize();
    draw();
    start();
    const onResize = () => { resize(); draw(); };
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); running = false; } else if (level.current > 0) start(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    const poll = window.setInterval(() => { if (level.current > 0) start(); }, 400);
    return () => { cancelAnimationFrame(raf); window.clearInterval(poll); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis); };
  }, [reduce]);

  return <canvas ref={canvas} className="photon-knot" aria-hidden="true" style={{ opacity: intensity }} />;
}
