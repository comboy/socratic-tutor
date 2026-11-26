// Minimal headless Chrome driver over the DevTools protocol. No dependencies (Node 22+ WebSocket).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
export const chromePath = () => CANDIDATES.find(p => fs.existsSync(p)) || null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chromes left behind by a test run that was killed outright (an agent's command timeout sends
// SIGKILL, which no handler sees): orphans (parent gone) with one of our throwaway profiles.
// Left alone, a headless page keeps rendering and burns CPU for days.
export function reapOrphans() {
  if (process.platform === 'win32') return 0;
  let n = 0;
  try {
    const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout || '';
    const mark = `--user-data-dir=${path.join(os.tmpdir(), 'learn-chrome-')}`;
    for (const line of ps.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!m || m[2] !== '1' || !m[3].includes(mark)) continue;
      try { process.kill(Number(m[1]), 'SIGTERM'); n++; } catch {}
      const dir = m[3].split(mark)[1]?.split(' ')[0];
      if (dir && /^[\w]+$/.test(dir)) fs.rmSync(path.join(os.tmpdir(), 'learn-chrome-' + dir), { recursive: true, force: true });
    }
  } catch {}
  return n;
}

export async function launch({ headed = false, width = 1400, height = 900, outDir } = {}) {
  const bin = chromePath();
  if (!bin) throw new Error('Chrome not found (set CHROME=/path/to/chrome)');
  if (typeof WebSocket === 'undefined') throw new Error('needs Node 22+ (global WebSocket)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(bin, [...(headed ? [] : ['--headless=new']), '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 100 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
  if (!targets) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');

  const page = {
    errors,
    async size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async dark(on) { await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }); },
    async nav(url, settle = 1200) {
      const cur = await page.eval('location.href').catch(() => '');
      if (cur === url) await send('Page.reload', { ignoreCache: true });   // same URL + hash would not reload
      else await send('Page.navigate', { url });
      await sleep(settle);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, { timeout = 10000, every = 150 } = {}) {
      const t0 = Date.now();
      for (;;) {
        const v = await page.eval(expr).catch(() => null);
        if (v) return v;
        if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for: ${expr}`);
        await sleep(every);
      }
    },
    async center(sel) {
      return page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
        e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    },
    async mouse(type, x, y, extra = {}) { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra }); },
    async hover(sel, wait = 500) {
      const p = await page.center(sel);
      if (!p) throw new Error('not found: ' + sel);
      await page.mouse('mouseMoved', p[0], p[1]); await sleep(wait);
    },
    async click(sel, wait = 300) {
      const p = await page.center(sel);
      if (!p) throw new Error('not found: ' + sel);
      await page.mouse('mouseMoved', p[0], p[1]);
      await page.mouse('mousePressed', p[0], p[1], { clickCount: 1 });
      await page.mouse('mouseReleased', p[0], p[1], { clickCount: 1 });
      await sleep(wait);
    },
    async drag(x0, y0, x1, y1) {
      await page.mouse('mouseMoved', x0, y0); await page.mouse('mousePressed', x0, y0, { clickCount: 1 });
      for (let i = 1; i <= 8; i++) { await page.mouse('mouseMoved', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, { buttons: 1 }); await sleep(25); }
      await page.mouse('mouseReleased', x1, y1, { clickCount: 1 }); await sleep(200);
    },
    async type(text) { await send('Input.insertText', { text }); },
    async key(key, { meta = false } = {}) {
      const code = key === 'Enter' ? 'Enter' : key;
      const base = { key, code, modifiers: meta ? 4 : 0, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async shot(name) {
      if (!outDir) return;
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
    },
    // more tabs of the same browser (not driven; closed with closeTabs)
    async openTabs(url, n) {
      const ids = [];
      for (let i = 0; i < n; i++) ids.push((await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()).id);
      return ids;
    },
    async closeTabs(ids) { for (const t of ids) await fetch(`http://127.0.0.1:${port}/json/close/${t}`).catch(() => {}); },
    async close() { try { ws.close(); } catch {} proc.kill(); await sleep(200); fs.rmSync(profile, { recursive: true, force: true }); },
  };
  await page.size(width, height);
  return page;
}
