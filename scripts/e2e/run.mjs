// End-to-end walkthrough in headless Chrome with a fake microphone, driven over the
// DevTools protocol (no extra dependencies; Node 22+ global WebSocket).
// Usage: node scripts/e2e/run.mjs <baseUrl> <speech.wav> <outDir> [width height] [--mobile]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const [base = 'http://localhost:8788', wav, out = 'e2e-shots', w = '1366', h = '768'] = args.filter(a => !a.startsWith('--'));
const quick = args.includes('--quick');
const failMode = args.includes('--expect-failure'); // providers not configured: verify honest recovery // stop after the mic check (layout screenshots only)
fs.mkdirSync(out, { recursive: true });
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fiy-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []),
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess', `--window-size=${w},${h}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 200 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* starting */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 600 });
const shot = async name => { await sleep(800); console.log('knot', name, await evaluate(`(() => { const c = document.querySelector('.photon-knot'); return c ? getComputedStyle(c).opacity : 'none'; })()`).catch(() => '?')); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); console.log('shot', name); };
const waitFor = async (expr, timeout = 90000, label = expr) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return; await sleep(250); }
  throw new Error(`timeout waiting for: ${label}`);
};
const waitText = (t, timeout) => waitFor(`document.body.innerText.includes(${JSON.stringify(t)})`, timeout, t);
const click = async (text, sel = 'button') => {
  await waitFor(`[...document.querySelectorAll(${JSON.stringify(sel)})].some(b => b.textContent.trim().startsWith(${JSON.stringify(text)}) && !b.disabled)`, 90000, `button ${text}`);
  await evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}) && !b.disabled).click()`);
};
const typeInto = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

let ok = false;
try {
  await send('Page.navigate', { url: base });
  await waitText('What should I call you?');
  await shot('01-welcome');
  await evaluate(`document.querySelector('.orb-face').click()`); await sleep(500); await shot('01b-controls');
  await evaluate(`[...document.querySelectorAll('.orb-tool')].find(b => b.getAttribute('aria-label') === 'Help').click()`); await sleep(600); await shot('01c-help');
  await evaluate(`document.querySelector('.orb-face').click()`); await sleep(400);
  await evaluate(`document.querySelector('form.composer button[type=submit]').click()`);
  await waitText('Enter your name to continue.', 5000);
  await typeInto('#learner-name', 'Adaeze');
  await evaluate(`document.querySelector('form.composer').requestSubmit()`);
  await waitText('Which issue will you argue?');
  await waitFor(`!!document.querySelector('.issue')`, 10000, 'issue cards'); await sleep(1100); await shot('02a-carousel'); console.log('front before:', await evaluate(`document.querySelector('.prism-card[data-front=true]')?.innerText`)); await evaluate(`[...document.querySelectorAll('.issue')].find(b => b.textContent.includes('AI in assignments')).click()`);
  await sleep(900);
  console.log('front after:', await evaluate(`document.querySelector('.prism-card[data-front=true]')?.innerText`), '| question:', await evaluate(`document.querySelector('.issue-question')?.innerText`));
  await shot('02-topics');
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open the briefing'); b.click(); b.click(); })()`); // double click → one run
  await waitText('Here’s your issue.');
  await shot('03-briefing');
  await click('I’m ready');
  await waitText('Your panel is ready.');
  await click('Check my microphone');
  await waitText('We can hear you', 15000);
  await evaluate(`document.querySelector('.consent input').click()`);
  await shot('04-mic');
  console.log('idle motion:', await evaluate(`(async () => { const img = document.querySelector('.portrait img.idle'); if (!img) return 'no img'; const a = getComputedStyle(img).scale; await new Promise(r => setTimeout(r, 1500)); const b = getComputedStyle(img).scale; return a + ' -> ' + b + ' | anim: ' + getComputedStyle(img).animationName; })()`));
  if (quick) { ok = true; throw new Error('quick mode: stopping after mic check'); }
  await click('Begin');
  await waitText('It stops on its own');
  await sleep(6000);
  await shot('05-recording');
  await waitFor(`!!document.querySelector('.think')`, 75000, 'processing orb');
  await shot('06-processing');
  if (failMode) {
    await waitText('I can’t assess this right now.', 60000);
    await shot('06b-failed');
    const body = await evaluate('document.body.innerText');
    if (/\d+\s*\/\s*100/.test(body)) throw new Error('a numeric score was shown on failure');
    for (const t of ['Try again with the same recording', 'Save recording', 'Close this run without a score']) if (!body.includes(t)) throw new Error(`missing recovery action: ${t}`);
    await click('Try again');
    await waitText('I can’t assess this right now.', 30000);
    await evaluate('window.confirm = () => true');
    await click('Close this run without a score');
    await waitText('closed without a score', 20000);
    await shot('06c-closed-unscored');
    ok = true; console.log('E2E FAILURE-PATH PASS');
    throw new Error('done');
  }
  await waitText('The panel has feedback for you.', 120000);
  await sleep(1800);
  await shot('07-feedback');
  const fb = await evaluate(`document.querySelector('.subtitle')?.innerText`);
  console.log('feedback card:', fb?.replace(/\n/g, ' | '));
  await click('See your result');
  await waitFor(`!!document.querySelector('.score')`, 20000, 'score');
  await sleep(2400);
  await shot('08-results');
  console.log('result card:', (await evaluate(`[...document.querySelectorAll('.score,.band,.crit')].map(e => e.innerText).join(' | ')`))?.replace(/\n/g, ' | '));
  await click('Replay recording');
  await shot('08b-results-replay');
  await click('Finish simulation');
  await waitText('Simulation finished', 20000);
  await shot('09-after-finish');
  ok = true;
  console.log('E2E PASS');
} catch (e) {
  if (!ok) {
    console.log('E2E FAIL:', e.message);
    await shot('failure').catch(() => {});
    console.log((await evaluate('document.body.innerText').catch(() => '')).slice(0, 600));
    console.log('rms probe:', await evaluate(`(async () => { const s = await navigator.mediaDevices.getUserMedia({audio:true}); const c = new AudioContext(); await c.resume(); const a = c.createAnalyser(); a.fftSize = 1024; c.createMediaStreamSource(s).connect(a); const d = new Float32Array(1024); const out = []; for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 100)); a.getFloatTimeDomainData(d); out.push(Math.sqrt(d.reduce((x, v) => x + v * v, 0) / d.length).toFixed(4)); } return c.state + ' ' + out.join(','); })()`).catch(e => e.message));
  } else console.log('E2E QUICK PASS');
} finally {
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  ws.close(); chrome.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome still exiting */ } }, 1500);
}
