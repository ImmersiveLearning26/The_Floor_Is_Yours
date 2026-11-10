import { useEffect, useState } from 'react';

const LOGO = '/media/brand/miva.svg';

/** Resolves to the logo URL only if the institution's approved artwork is installed; otherwise false. Never waits > 800 ms. */
export function useSplashLogo() {
  const [logo, setLogo] = useState<string | false | undefined>(undefined);
  useEffect(() => {
    let done = false;
    const timer = window.setTimeout(() => { if (!done) { done = true; setLogo(false); } }, 800);
    fetch(LOGO, { method: 'HEAD' }).then(r => {
      if (done) return;
      done = true; window.clearTimeout(timer);
      setLogo(r.ok && (r.headers.get('content-type') ?? '').includes('svg') ? LOGO : false);
    }).catch(() => { if (!done) { done = true; setLogo(false); } });
    return () => window.clearTimeout(timer);
  }, []);
  return logo;
}

export function P00Splash({ logo, onDone }: { logo: string; onDone: () => void }) {
  useEffect(() => { const id = window.setTimeout(onDone, 1600); return () => window.clearTimeout(id); }, [onDone]);
  return (
    <section className="splash" aria-label="Opening">
      <img src={logo} alt="MIVA Open University" onError={onDone} />
      <span>presents</span>
      <button className="quiet" onClick={onDone}>Skip</button>
    </section>
  );
}
