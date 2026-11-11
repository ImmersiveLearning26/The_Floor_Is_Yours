// Facilitator review page (/facilitator.html): queue, playback, transcript, human delivery rating,
// reasoned override and review resolution. Talks to the same API as the learner app, authenticated by the
// FACILITATOR_TOKEN (kept only in this tab's sessionStorage). Never linked from the learner UI.
import { apiBase, facilitatorHeaders } from '../lib/backend';

type Item = {
  runId: string; displayName: string; topic: string; status: string; updatedAt: string; jobId: string | null; jobStage: string | null;
  jobMessage: string | null; reviewRequested: boolean; duration: number | null; audioDeleted: boolean; transcript: string | null;
  evaluation: null | { id: string; scoreRounded: number; scoreExact: number; band: string; deliveryAssessor: string; revisions: unknown[]; ratings: { id: string; level: number; justification: string }[] };
};

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const KEY = 'fiy.facilitator.token';
const token = () => sessionStorage.getItem(KEY) ?? '';

async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(`${apiBase}/facilitator${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...facilitatorHeaders(token()), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, data: { error: 'The server could not be reached.' } as T & { error: string } };
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  sessionStorage.setItem(KEY, $<HTMLInputElement>('#token').value.trim());
  const r = await api('/login', {});
  $('#loginMsg').textContent = r.ok ? 'Signed in.' : r.data.error ?? 'Sign-in failed.';
  if (r.ok) void load(); else sessionStorage.removeItem(KEY);
});

const levels = (sel?: number) => [0, 1, 2, 3, 4].map(l => `<option ${l === sel ? 'selected' : ''}>${l}</option>`).join('');

async function load() {
  if (!token()) return;
  const r = await api<{ items: Item[] }>('/queue');
  if (!r.ok) { $('#list').innerHTML = `<p class="meta">${esc(r.data.error)}</p>`; return; }
  $<HTMLFormElement>('#login').hidden = true;
  const list = $('#list');
  list.innerHTML = r.data.items.length ? '' : '<p class="meta">No submitted recordings yet.</p>';
  for (const it of r.data.items) {
    const el = document.createElement('section'); el.className = 'card';
    const ev = it.evaluation;
    el.innerHTML = `<h2>${esc(it.displayName)} · ${esc(it.topic)}</h2>
      <div class="row"><span class="pill">${esc(it.status)}</span>${it.jobStage ? `<span class="pill">job: ${esc(it.jobStage)}</span>` : ''}${it.reviewRequested ? '<span class="pill">review requested</span>' : ''}<span class="meta">${it.duration?.toFixed(1) ?? '?'}s · ${esc(it.updatedAt)}</span></div>
      ${it.jobMessage ? `<p class="meta">${esc(it.jobMessage)}</p>` : ''}
      ${it.audioDeleted ? '<p class="meta">Audio deleted under the retention policy.</p>' : '<div class="row"><button class="q" data-a="listen">Load recording</button><audio controls preload="none" hidden></audio></div>'}
      <details><summary>Transcript</summary><pre>${esc(it.transcript || '(no transcript)')}</pre></details>
      ${ev ? `<table><tr><th>Criterion</th><th>Level</th><th>Justification</th></tr>${ev.ratings.map(x => `<tr><td>${esc(x.id)}</td><td><select data-c="${esc(x.id)}">${levels(x.level)}</select></td><td>${esc(x.justification)}</td></tr>`).join('')}</table>
        <p><strong>${ev.scoreRounded}/100</strong> (${ev.scoreExact}) ${esc(ev.band)} · delivery: ${esc(ev.deliveryAssessor)} · revisions: ${ev.revisions.length}</p>
        <div class="row"><input placeholder="Reviewer" data-f="rev"><input placeholder="Reason for override" data-f="reason" size="40"><button data-a="override">Save override</button></div>` : ''}
      ${it.jobStage === 'needs-review' ? `<div class="card"><h2>Rate delivery from the audio</h2><div class="row"><input placeholder="Reviewer" data-d="rev"><select data-d="level">${levels()}</select></div>
        <textarea data-d="just" placeholder="Justification"></textarea><div class="row"><input data-d="s" placeholder="start s" size="6"><input data-d="e" placeholder="end s" size="6"><input data-d="obs" placeholder="What you heard" size="50"></div><button data-a="delivery">Submit delivery rating</button></div>` : ''}
      ${it.jobStage === 'failed' ? '<button class="q" data-a="retry">Retry assessment (same file)</button>' : ''}
      ${it.reviewRequested ? '<button class="q" data-a="resolve">Mark review resolved</button>' : ''}
      <p class="meta" data-msg></p>`;
    const msg = (t: string) => { $('[data-msg]', el).textContent = t; };
    const val = (s: string) => $<HTMLInputElement>(s, el).value;
    el.querySelector('[data-a="listen"]')?.addEventListener('click', async () => {
      const u = await api<{ url: string }>(`/runs/${encodeURIComponent(it.runId)}/audio-url`);
      if (!u.ok) return msg(u.data.error ?? 'Recording not available.');
      const audio = $<HTMLAudioElement>('audio', el); audio.src = u.data.url; audio.hidden = false; void audio.play().catch(() => {});
    });
    el.querySelector('[data-a="override"]')?.addEventListener('click', async () => {
      const changes = [...el.querySelectorAll<HTMLSelectElement>('select[data-c]')].map(s => ({ id: s.dataset.c, level: Number(s.value) }));
      const res = await api<{ scoreRounded: number }>(`/evaluations/${encodeURIComponent(ev!.id)}/override`, { reviewer: val('[data-f=rev]'), reason: val('[data-f=reason]'), changes });
      msg(res.ok ? `Saved. New score ${res.data.scoreRounded}.` : res.data.error ?? 'Failed.');
    });
    el.querySelector('[data-a="delivery"]')?.addEventListener('click', async () => {
      const res = await api(`/jobs/${encodeURIComponent(it.jobId!)}/delivery`, { reviewer: val('[data-d=rev]'), level: Number(val('[data-d=level]')), justification: val('[data-d=just]'), evidence: [{ start: Number(val('[data-d=s]')), end: Number(val('[data-d=e]')), observation: val('[data-d=obs]') }] });
      msg(res.ok ? 'Delivery saved; assessment resumed.' : res.data.error ?? 'Failed.');
    });
    el.querySelector('[data-a="retry"]')?.addEventListener('click', async () => { const res = await api(`/runs/${encodeURIComponent(it.runId)}/retry`, {}); msg(res.ok ? 'Retry started.' : res.data.error ?? 'Failed.'); });
    el.querySelector('[data-a="resolve"]')?.addEventListener('click', async () => { const res = await api(`/reviews/${encodeURIComponent(it.runId)}/resolve`, { reviewer: 'facilitator' }); msg(res.ok ? 'Resolved.' : res.data.error ?? 'Failed.'); });
    list.append(el);
  }
}
void load();
