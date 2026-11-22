#!/usr/bin/env node
// Acceptance tests: the whole system on a throwaway copy of test/fixture/topics.
//
//   bin/learn test [--headed] [--keep] [--real] [--only <substring>]
//
// Starts the real launcher (bin/learn start) with the fake tutor in place of claude, on its own
// port and data directory, then drives the UI in headless Chrome. Never touches topics/ or a
// running tutor. Screenshots land in test/out/ (gitignored) for a quick look.
//   --real   also smoke-test rendering of every message in your real topics (read-only copy)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, chromePath } from './lib/chrome.mjs';

const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BIN = path.join(CODE, 'bin', 'learn');
const OUT = path.join(CODE, 'test', 'out');
const args = process.argv.slice(2);
const opt = { headed: args.includes('--headed'), keep: args.includes('--keep'), real: args.includes('--real'), only: args.includes('--only') ? args[args.indexOf('--only') + 1] : null };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- environment
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-test-'));
fs.cpSync(path.join(CODE, 'test', 'fixture', 'topics'), path.join(HOME, 'topics'), { recursive: true });
fs.cpSync(path.join(CODE, 'test', 'fixture', 'learner'), path.join(HOME, 'learner'), { recursive: true });
const REAL_FEEDBACK = path.join(CODE, 'data', 'feedback.md');
const realFeedback = () => { try { return fs.readFileSync(REAL_FEEDBACK, 'utf8'); } catch { return null; } };
const PORT = String(4800 + Math.floor(Math.random() * 150));
const BASE = `http://localhost:${PORT}`;
const ENV = { ...process.env, LEARN_HOME: HOME, LEARN_NO_GIT: '1', LEARN_PORT: PORT, LEARN_CLAUDE: path.join(CODE, 'test', 'fake-tutor.mjs'),
  CLAUDE_CONFIG_DIR: path.join(HOME, 'claude'), LEARN_HANDOFF_TOKENS: '150000', FAKE_TOKENS_PER_TURN: '30000' };
const learn = (...a) => execFileSync(process.execPath, [BIN, ...a], { env: ENV, encoding: 'utf8' });
const api = async (p, body) => {
  const r = await fetch(BASE + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
};
const journal = () => fs.readdirSync(path.join(HOME, 'topics/demo/journal')).sort()
  .flatMap(f => fs.readFileSync(path.join(HOME, 'topics/demo/journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
const fakeLog = () => { try { return fs.readFileSync(path.join(HOME, 'state/fake-claude.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const sessions = () => fakeLog().filter(l => l.args);
async function until(fn, what, timeout = 15000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error('timed out: ' + what); await sleep(150); }
}

// ---------------------------------------------------------------- tiny runner
const results = [];
let page;
async function test(name, fn) {
  if (opt.only && !name.includes(opt.only)) return;
  const t0 = Date.now();
  if (page) page.errors.length = 0;
  try {
    await fn();
    if (page?.errors.length) throw new Error('browser errors:\n    ' + page.errors.join('\n    '));
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[2m${Date.now() - t0}ms\x1b[0m`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`  \x1b[31m✗ ${name}\x1b[0m\n    ${e.message.split('\n').join('\n    ')}`);
    await page?.shot('FAIL-' + name.replace(/\W+/g, '-')).catch(() => {});
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

// ---------------------------------------------------------------- run
let launcher;
async function main() {
  console.log(`learn acceptance · data ${HOME} · ${BASE}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  const log = fs.openSync(path.join(HOME, 'launcher.log'), 'a');
  launcher = spawn(process.execPath, [BIN, 'start', 'demo', '--no-open'], { env: ENV, stdio: ['ignore', log, log] });

  console.log('\nLauncher & protocol');
  await test('launcher starts the server and an idle (fake) tutor: no topic, posts nothing, listens', async () => {
    await until(() => api('/api/ping').catch(() => null), 'server');
    const st = await until(async () => { const s = await api('/api/status'); return s.phase === 'listening' && s; }, 'listening');
    assert(st.launcher, 'launcher not detected');
    const s = sessions();
    assert(s.length === 1 && s[0].args.includes('--session-id'), 'claude started with --session-id: ' + JSON.stringify(s[0]?.args?.slice(0, 2)));
    const pm = s[0].args.indexOf('--permission-mode');
    assert(pm >= 0 && s[0].args[pm + 1] === 'auto', 'tutor runs in auto mode (no permission prompts)');
    assert(s[0].args.at(-2) === '--', 'prompt comes after "--" so no variadic option can swallow it');
    assert(/post nothing until the learner writes/.test(s[0].args.at(-1)), 'idle prompt');
    await sleep(800);
    assert(!journal().some(e => e.role === 'tutor' && e.ts > new Date(Date.now() - 60e3).toISOString()), 'the idle tutor posted something');
    assert(JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8')).topic === null, 'session has no topic yet');
  });
  await test('running bin/learn again is harmless: it reports the running instance', async () => {
    const out = learn('start', '--no-open');
    assert(/already running/.test(out), out);
    assert(sessions().length === 1, 'a second tutor was started');
  });
  await test('topics API lists fixture topics', async () => {
    const t = await api('/api/topics');
    assert(t.map(x => x.slug).join() === 'cells,demo', JSON.stringify(t));
  });
  await test('bin/learn recent / show / grep work against LEARN_HOME', async () => {
    const r = learn('recent', '5', '--topic', 'demo');
    assert(/\[tutor/.test(r), r);
    assert(/2026-01-05\.1 /.test(learn('show', '2026-01-05.1')), 'show');
    assert(learn('grep', 'softmax', '--topic', 'demo').split('\n').length > 2, 'grep');
  });
  await test('bin/learn check passes on the fixture topics', async () => {
    const out = learn('check');
    assert(/demo: ok/.test(out) && /cells: ok/.test(out), out);
  });
  await test('bin/learn hook reminds only the tutor session', async () => {
    const id = JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8')).id;
    const yes = execFileSync(process.execPath, [BIN, 'hook'], { env: ENV, input: JSON.stringify({ session_id: id, source: 'compact' }), encoding: 'utf8' });
    const no = execFileSync(process.execPath, [BIN, 'hook'], { env: ENV, input: JSON.stringify({ session_id: 'other', source: 'compact' }), encoding: 'utf8' });
    assert(/compacted/.test(yes) && no === '', 'hook output wrong');
  });

  await test('feedback endpoint appends to feedback.md (data home) and never reaches the tutor', async () => {
    const real = realFeedback();
    const jl = journal().length;
    const r = await api('/api/feedback', { text: 'API feedback line\nsecond line', topic: 'demo', view: 'learn' });
    assert(r.ok && r.file === 'feedback.md', JSON.stringify(r));
    const f = fs.readFileSync(path.join(HOME, 'feedback.md'), 'utf8');
    assert(/^- \[ \] \d{4}-\d{2}-\d{2} \(learner, demo · learn\): API feedback line\n {6}second line$/m.test(f), f);
    assert(journal().length === jl, 'feedback was journaled');
    assert(!fs.readdirSync(path.join(HOME, 'state/inbox')).filter(x => x.endsWith('.json')).length, 'feedback was queued');
    await api('/api/feedback', { text: '   ' }).then(() => assert(false, 'empty accepted'), e => assert(/empty/.test(e.message), e.message));
    await sleep(600);
    assert(!JSON.stringify(fakeLog()).includes('API feedback'), 'the tutor saw it');
    assert(realFeedback() === real, 'wrote to the real data/feedback.md');
  });

  console.log('\nTutor commands');
  await test('resume prints the whole startup bundle in one go', async () => {
    const r = learn('resume', 'demo');
    for (const s of ['# Resume: ', 'Learner profile', 'Knowledge across topics', 'Resume here', 'Skill tree', '◀ FOCUS', 'Pending question', 'spaced review', 'suspected holes', 'parked', 'Glossary terms', 'Last ']) assert(r.includes(s), 'missing: ' + s + '\n' + r.slice(0, 600));
    assert(/n1 \[4\.3\] Why the mask/.test(r) && !/Mixed up loss/.test(r), 'open notes only');
    assert(/@linalg/.test(r) && /needs 4\.1,3\.2/.test(r), 'needs and foundations shown');
    assert(/Short gap|day or more|week or more/.test(r), 'gap advice');
  });
  await test('note / focus / summary / term / tree / log commands', async () => {
    assert(/added n5 \(hole, 4\.1\)/.test(learn('note', 'hole', '--topic', 'demo', '--skill', '4.1', 'test hole')), 'note add');
    assert(/closed n5/.test(learn('note', 'done', 'n5', 'fixed', '--topic', 'demo')), 'note done');
    assert(/demo focus: 4\.2/.test(learn('focus', 'demo', '4.2')), 'focus');
    learn('summary', 'demo', '4.2', `- tested ([x](msg:${journal().find(e => e.role === 'tutor' && e.kind === 'message').id}))`);
    const meta = JSON.parse(fs.readFileSync(path.join(HOME, 'topics/demo/topic.json'), 'utf8'));
    assert(meta.focus === '4.2' && /tested/.test(meta.skills.find(s => s.id === '4').children.find(c => c.id === '4.2').summary), 'focus/summary saved');
    learn('term', 'add', 'demo', 'test term', '--short', 'A term added by the test.', '--skill', '4.2', '--full', '**T**est **T**erm', '--aliases', 'tt');
    assert(/full: \*\*T\*\*est/.test(learn('term', 'show', 'demo', 'tt')), 'term show by alias');
    assert(/already in the glossary/.test((() => { try { learn('term', 'add', 'demo', 'TT', '--short', 'x'); return ''; } catch (e) { return String(e.stderr); } })()), 'duplicate term refused');
    const outline = learn('tree', 'demo');
    assert(/^@linalg /m.test(outline) && /^ {2}4\.3 Causal mask <- 4\.1, 3\.2$/m.test(outline), outline);
    const drop = (() => { try { execFileSync(process.execPath, [BIN, 'tree', 'demo', '--set'], { env: ENV, input: '1 Tokenization\n  1.1 Tokens\n', encoding: 'utf8' }); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/drops skills/.test(drop), 'tree --set refuses to drop skills: ' + drop);
    learn('log', 'demo', 'a test log line');
    assert(/a test log line/.test(fs.readFileSync(path.join(HOME, 'topics/demo/log.md'), 'utf8')), 'log');
    assert(/^demo: ok/m.test(learn('check', 'demo')), 'still valid');
  });
  await test('glossary metadata: full and parts parse; entries without them are unchanged', async () => {
    const t = await api('/api/topic/demo');
    const bpe = t.glossary.find(g => g.term === 'BPE'), kv = t.glossary.find(g => g.term === 'KV cache'), tok = t.glossary.find(g => g.term === 'token');
    assert(bpe.full === '**B**yte-**P**air **E**ncoding' && bpe.parts.join() === 'token,vocabulary,tokenizer' && bpe.skill === '1.3' && /^A way to build/.test(bpe.short), JSON.stringify(bpe));
    assert(kv.full && kv.refs.length === 1 && /^Memory holding/.test(kv.short), JSON.stringify(kv));
    assert(tok.full === null && !tok.parts.length && /^A chunk of text/.test(tok.short), JSON.stringify(tok));
    assert(/^demo: ok$/m.test(learn('check', 'demo')), 'check warnings on the fixture');
  });

  await test('wiki pages: served with the topic, links to them checked', async () => {
    const t = await api('/api/topic/demo');
    assert(t.pages.map(p => p.name + ':' + p.title).join() === 'notes-on-softmax:Softmax notes,residual-stream:How x is built, layer by layer', JSON.stringify(t.pages.map(p => p.name)));
    const bad = path.join(HOME, 'topics/demo/pages/zz-bad.md');
    fs.writeFileSync(bad, '# Bad\n\n[gone](wiki:page/nope) [ok](wiki:page/residual-stream) [list](wiki:pages)\n');
    const out = learn('check', 'demo');
    fs.rmSync(bad);
    assert(/pages\/zz-bad\.md: broken link wiki:page\/nope/.test(out) && !/residual-stream/.test(out) && !/wiki:pages/.test(out), out);
  });

  await test('term pages: served with the topic, shown by term show / term pages, checked', async () => {
    const t = await api('/api/topic/demo');
    const tp = t.termPages.find(p => p.name === 'temperature');
    assert(tp && !/^# /.test(tp.text) && /^Temperature \$T\$ is/.test(tp.text) && /:::fog/.test(tp.text), JSON.stringify(t.termPages).slice(0, 300));
    const show = learn('term', 'show', 'demo', 'temperature');
    assert(/^page: \S*topics\/demo\/terms\/temperature\.md \(updated \d{4}-\d{2}-\d{2}, \d+ chars\)$/m.test(show) && /Top-k and top-p/.test(show), show);
    assert(/page: none yet \(write it as \S*topics\/demo\/terms\/kv-cache\.md/.test(learn('term', 'show', 'demo', 'KV cache')), 'no page yet');
    const pages = learn('term', 'pages', 'demo');
    assert(/^  temperature +temperature\.md +updated/m.test(pages) && /without a page \(messages\): token \(\d+\)/.test(pages), pages);
    const dir = path.join(HOME, 'topics/demo/terms'), tmp = ['zz-nothing.md', 'softmax.md', 'soft-max.md', 'Bad Name.md'];
    fs.writeFileSync(path.join(dir, tmp[0]), 'x'); fs.writeFileSync(path.join(dir, tmp[1]), '[ok](term:temperature), as code: `![x](media:none.png)` `[y](msg:2099-01-01.1)`\n\n```\n[z](skill:99)\n```\n'); fs.writeFileSync(path.join(dir, tmp[2]), '[gone](term:nope)'); fs.writeFileSync(path.join(dir, tmp[3]), 'x');
    const out = learn('check', 'demo');
    for (const f of tmp) fs.rmSync(path.join(dir, f));
    assert(/terms\/zz-nothing\.md: no glossary term or alias is called that/.test(out) && /terms\/soft-max\.md: "softmax" already has terms\/softmax\.md/.test(out)
      && /terms\/soft-max\.md: broken link term:nope/.test(out) && /terms\/: Bad Name\.md: not shown/.test(out) && !/temperature|none\.png|2099|skill:99/.test(out), out);
  });

  if (!chromePath()) { console.log('\n(Chrome not found: skipping UI tests. Set CHROME=…)'); return; }
  page = await launch({ headed: opt.headed, outDir: OUT });
  await page.dark(true);

  console.log('\nRendering');
  await test('learn view renders every fixture message without leftovers', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1500);
    await page.waitFor(`document.querySelectorAll('.thread .msg').length > 20`);
    const r = await page.eval(`(() => {
      const t = document.querySelector('.thread').innerText;
      return { leftovers: (t.match(/\\]\\((msg|term|skill|map|wiki|tip|media):|^:::|\\{\\{|\\$\\$|\\\\k\\{/gm) || []),
        vizEmpty: [...document.querySelectorAll('.thread .viz')].filter(v => !v.children.length || v.querySelector('.viz-error')).map(v => v.className),
        katex: document.querySelectorAll('.thread .katex').length, katexErr: document.querySelectorAll('.thread .katex-error, .thread .math-error').length,
        spaced: [...document.querySelectorAll('.thread .ref-term')].map(b => b.dataset.id).filter(x => x.includes(' ')) };
    })()`);
    assert(!r.leftovers.length, 'unrendered markdown: ' + r.leftovers.join(' '));
    assert(!r.vizEmpty.length, 'viz failed: ' + r.vizEmpty.join(', '));
    assert(r.katex > 5 && !r.katexErr, `katex ${r.katex}, errors ${r.katexErr}`);
    assert(r.spaced.includes('learning rate') && r.spaced.includes('KV cache'), 'term links with spaces: ' + r.spaced);
    await page.shot('learn-dark');
  });
  await test('every viz type in the fixture mounts', async () => {
    const types = await page.eval(`[...new Set([...document.querySelectorAll('.thread .viz')].map(v => [...v.classList].find(c => c.startsWith('viz-') && c !== 'viz-error')))].sort().join()`);
    for (const t of ['bars', 'flow', 'matrix', 'plot', 'softmax', 'steps', 'tokens', 'vector']) assert(types.includes('viz-' + t), `viz ${t} missing (have ${types})`);
  });
  await test('linked highlighting: hovering a key lights up its partners', async () => {
    const sel = await page.eval(`(() => { const el = [...document.querySelectorAll('.thread .lk[data-k]')].find(e => { const s = e.closest('.hl-scope'); return s && s.querySelectorAll('[data-k~="' + e.dataset.k.split(' ')[0] + '"]').length > 1; }); if (!el) return null; el.id = 'zz-lk'; return '#zz-lk'; })()`);
    assert(sel, 'no keyed span with partners');
    await page.hover(sel, 200);
    const n = await page.eval(`document.querySelector('#zz-lk').closest('.hl-scope').querySelectorAll('.hl').length`);
    assert(n > 1, 'highlighted ' + n);
  });
  await test('hover cards: term, skill ref, and a nested card from a link inside a card', async () => {
    await page.mouse('mouseMoved', 5, 5); await sleep(400);
    await page.eval(`document.querySelectorAll('.thread .ref-skill')[0].id = 'zz-sk'`);
    await page.hover('#zz-sk', 700);
    await page.waitFor(`document.querySelector('.hovercard.on')`, { timeout: 2000 });
    const inner = await page.eval(`(() => { const l = document.querySelector('.hovercard [data-ref], .hovercard .term'); if (!l) return null; l.id = 'zz-in'; return true; })()`);
    if (inner) {
      await page.hover('#zz-in', 800);
      const cards = await page.eval(`[...document.querySelectorAll('.hovercard')].map(c => c.getBoundingClientRect().top > 0 && c.textContent.length > 10)`);
      assert(cards.length === 2 && cards.every(Boolean), 'nested card: ' + JSON.stringify(cards));
    }
    await page.mouse('mouseMoved', 5, 5); await sleep(600);
    assert(await page.eval(`document.querySelectorAll('.hovercard').length === 0`), 'cards close when leaving');
  });
  await test('welcome back bar after a long gap: offers a recap, "Just continue" dismisses it', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    const t = await page.eval(`document.querySelector('.welcome-back')?.innerText || ''`);
    assert(/Welcome back/.test(t) && /days ago/.test(t) && /Recap \+ check the basics/.test(t), t);
    await page.shot('welcome-back');
    await page.eval(`[...document.querySelectorAll('.welcome-back button')].find(b => /Just continue/.test(b.textContent)).click()`);
    await page.waitFor(`!document.querySelector('.welcome-back')`, { timeout: 2000 });
    await page.nav(`${BASE}/#/demo/learn`, 900);
    assert(await page.eval(`!document.querySelector('.welcome-back')`), 'dismissal not remembered');
  });
  await test('composer shows the whole pending question', async () => {
    // the fixture's pending question must show in full
    const q = await page.eval(`document.querySelector('.box-q')?.innerText || ''`);
    assert(q.length > 20, 'box-q: ' + q.slice(0, 80));
    // a long question may be capped in height, but then it must scroll (nothing hidden for good)
    const r = await page.eval(`(() => { const b = document.querySelector('.box-q'); return { clipped: b.scrollHeight > b.clientHeight + 2, scrolls: getComputedStyle(b).overflowY === 'auto' }; })()`);
    assert(!r.clipped || r.scrolls, 'question preview is clipped and not scrollable');
  });

  console.log('\nTalking to the tutor');
  await test('answer with ⌘↵: box clears, tutor replies and grades it', async () => {
    await page.click('#answerBox');
    await page.type('my test answer');
    await page.key('Enter', { meta: true });
    await sleep(200);
    assert(await page.eval(`document.querySelector('#answerBox').value === ''`), 'answer box not cleared');
    await page.waitFor(`[...document.querySelectorAll('.thread .msg')].some(m => m.innerText.includes('Echo (answer): my test answer'))`);
    await page.waitFor(`document.querySelector('.thread .verdict-correct')`);
    assert(await page.eval(`localStorage['learn:draft:answer:demo'] === '""'`), 'draft not cleared');
  });
  await test('the first message adopts its topic: the idle session loads demo, no extra session', async () => {
    const sess = JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8'));
    assert(sess.topic === 'demo' && sessions().length === 1, JSON.stringify(sess));
    const started = journal().filter(e => e.kind === 'session' && e.text === 'Session started' && e.ts > sess.startedAt);
    assert(started.length === 1, 'one "Session started" entry: ' + started.length);
  });
  await test('ask box with ⌘↵ keeps working after a redraw', async () => {
    await page.click('#askBox');
    await page.type('side question');
    await page.key('Enter', { meta: true });
    await sleep(200);
    assert(await page.eval(`document.querySelector('#askBox').value === ''`), 'ask box not cleared');
    await page.waitFor(`[...document.querySelectorAll('.thread .msg')].some(m => m.innerText.includes('Echo (ask): side question'))`);
  });
  await test('composer resize handle drags and remembers', async () => {
    const g = await page.eval(`(() => { const b = document.querySelector('.composer-grip').getBoundingClientRect(); return [b.left + b.width / 2, b.top + 4, document.querySelector('.composer').offsetHeight]; })()`);
    await page.drag(g[0], g[1], g[0], g[1] - 120);
    const h = await page.eval(`document.querySelector('.composer').offsetHeight`);
    assert(Math.abs(h - (g[2] + 120)) < 6 && await page.eval(`+localStorage['learn:composerH'] > 0`), `height ${g[2]} → ${h}`);
    await page.eval(`document.querySelector('.composer-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  });
  await test('status popover shows tutor memory from the transcript', async () => {
    await page.click('#status', 300);
    const t = await page.waitFor(`document.querySelector('.tutor-pop')?.innerText`);
    assert(/Tutor memory/.test(t) && /\d+k \/ 150k/.test(t), t);
    await page.shot('status-popover');
    await page.click('#status', 200);
  });

  console.log('\nHandoff');
  await test('"Fresh tutor": old tutor hands off, a new session takes over, UI shows it', async () => {
    const before = sessions().length;
    await page.nav(`${BASE}/#/demo/learn`, 1200);
    await page.click('#status', 300);
    await page.eval(`[...document.querySelectorAll('.tutor-pop button')].find(b => b.textContent.includes('Fresh tutor')).click()`);
    const seen = new Set();
    await until(async () => { const s = await api('/api/status'); seen.add(s.phase); return sessions().length === before + 1 && s.phase === 'listening'; }, 'new session listening', 20000);
    assert(seen.has('handoff'), 'never showed handoff phase: ' + [...seen]);
    const s = sessions().at(-1);
    assert(s.handoff && s.args.includes('--session-id'), 'second session is a handoff with a new id');
    assert(journal().some(e => e.kind === 'session' && e.handoff), 'handoff marker in journal');
    await page.waitFor(`document.querySelector('.thread .divider.handoff')`);
    await page.click('#status', 200);
  });
  await test('automatic handoff when the context passes the threshold (after replying)', async () => {
    const before = sessions().length;
    // each fake turn adds 30k tokens; the new session starts at 20k, threshold 150k
    for (let i = 0; i < 6 && sessions().length === before; i++) {
      await api('/api/send', { topic: 'demo', kind: 'ask', text: 'filler ' + i });
      await until(() => fakeLog().some(l => l.event === 'replied' && journal().find(e => e.id === l.id)?.text === 'filler ' + i) || sessions().length > before, 'reply ' + i);
    }
    await until(async () => sessions().length === before + 1 && (await api('/api/status')).phase === 'listening', 'auto handoff', 20000);
    const last = journal().filter(e => e.role === 'user').at(-1);
    assert(journal().some(e => e.role === 'tutor' && e.kind === 'message' && e.replyTo === last.id), 'replied before handing off');
  });
  await test('"Restart now" on a stuck tutor requeues the unanswered message', async () => {
    const before = sessions().length;
    const sent = await api('/api/send', { topic: 'demo', kind: 'ask', text: 'STALL-ONCE please' });
    await until(() => fakeLog().some(l => l.event === 'stalling' && l.id === sent.id), 'tutor stalls');
    assert((await api('/api/status')).phase === 'thinking', 'thinking while stuck');
    await api('/api/handoff', { topic: 'demo', force: true });
    await until(() => fakeLog().some(l => l.event === 'replied' && l.id === sent.id), 'new tutor answers the requeued message', 20000);
    assert(sessions().length === before + 1, 'exactly one new session');
    const replies = journal().filter(e => e.role === 'tutor' && e.kind === 'message' && e.replyTo === sent.id);
    assert(replies.length === 1, 'replies: ' + replies.length);
  });
  await test('no stray listeners: exactly one wait process for the current session', async () => {
    const cur = JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8')).id;
    const liveNow = () => fs.readdirSync(path.join(HOME, 'state/listeners')).filter(f => { try { process.kill(Number(f), 0); return true; } catch { return false; } });
    await until(() => liveNow().length > 0, 'listener re-armed');
    await sleep(1500);   // give any stray listener time to show up
    const live = liveNow();
    assert(live.length === 1, 'listeners: ' + live.length);
    assert(fs.readFileSync(path.join(HOME, 'state/listeners', live[0]), 'utf8') === cur, 'listener belongs to current session');
  });

  console.log('\nViews');
  for (const [name, hash, check] of [
    ['map', 'demo/map', `document.querySelectorAll('.map-node, .node').length > 5`],
    ['wiki overview', 'demo/wiki', `document.querySelectorAll('.ov-grid > .group').length >= 5 && document.querySelector('.ov-big')`],
    ['wiki cheat sheet', 'demo/wiki/cheatsheet', `document.querySelector('.sheet .wiki-md')`],
    ['wiki you (learner model)', 'demo/wiki/you', `document.querySelectorAll('.note-row').length >= 3 && /Synthetic fixture profile|fictional learner/.test(document.querySelector('.view-body').innerText)`],
    ['skill tree', 'demo/tree', `document.querySelectorAll('.tree-node').length >= 12 && document.querySelectorAll('svg path').length > 5`],
    ['skill tree, empty topic', 'cells/tree', `document.querySelector('#center')?.innerText.length > 0`],
    ['wiki glossary', 'demo/wiki/glossary', `document.querySelectorAll('.gl-row').length > 10`],
    ['wiki term with spaces', 'demo/wiki/term/learning%20rate', `document.querySelector('.title-block h2')?.textContent === 'learning rate'`],
    ['wiki skills', 'demo/wiki/skills', `document.querySelectorAll('.wsk').length > 8`],
    ['wiki sessions', 'demo/wiki/sessions', `document.querySelectorAll('.sess').length >= 3`],
    ['wiki session reader', 'demo/wiki/session/2026-01-06', `document.querySelectorAll('.reader .msg').length > 5`],
    ['wiki tutor notes', 'demo/wiki/notes', `document.querySelector('.notes-md') && document.querySelector('.log-md')`],
    ['wiki pages', 'demo/wiki/pages', `document.querySelectorAll('.page-list:not(.term-pages) .page-row').length === 2 && document.querySelectorAll('.term-pages .page-row').length === 1`],
    ['wiki page', 'demo/wiki/page/residual-stream', `document.querySelector('.page-md h1')?.textContent.includes('layer by layer') && document.querySelector('.page-md .viz-residual .rs-sgrid')`],
    ['stats', 'demo/stats', `document.querySelectorAll('.tile').length > 2 && document.querySelector('svg')`],
    ['empty topic (learn)', 'cells/learn', `document.querySelector('#center')?.innerText.length > 0`],
    ['empty topic (map)', 'cells/map', `document.querySelector('#center')?.innerText.length > 0`],
    ['empty topic (stats)', 'cells/stats', `document.querySelector('#center')?.innerText.length > 0`],
  ]) {
    await test(`view: ${name}`, async () => {
      await page.nav(`${BASE}/#/${hash}`, 900);
      await page.waitFor(check, { timeout: 4000 });
      await page.shot('view-' + name.replace(/\W+/g, '-'));
    });
  }
  await test('viz residual: steps through, maths from the weights, edits recompute', async () => {
    await page.nav(`${BASE}/#/demo/wiki/page/residual-stream`, 900);
    const V = `document.querySelector('.page-md .viz-residual')`;
    await page.waitFor(`${V}?.querySelector('.rs-sgrid')`, { timeout: 4000 });
    assert(!(await page.eval(`!!${V}.querySelector('.viz-err-msg')`)), await page.eval(`${V}.innerText.slice(0, 300)`));
    // stream cell: token j at stage sg (9 stages per token row) -> its 4 numbers
    const cell = (sg, j) => page.eval(`${V}.querySelectorAll('.rs-vec')[${j * 9 + sg}].innerText.split(/\\s+/).join(' ').replace(/−/g, '-')`);
    assert(await page.eval(`${V}.querySelectorAll('.rs-chip').length`) === 23, 'step count');
    assert(await cell(0, 2) === '0 0.50 1 0', 'x0 bank: ' + await cell(0, 2));
    assert(await cell(8, 2) === '0.53 0.58 1 1.12', 'x2 bank: ' + await cell(8, 2));
    assert(await page.eval(`${V}.querySelectorAll('.rs-stg.future').length`) === 8, 'later stages not marked as future');
    await page.shot('viz-residual-embed');
    // jump to layer 2, weighted sum: reads x(1) of the, river, bank; detail shows A·V
    await page.eval(`[...${V}.querySelectorAll('.rs-chip')].filter(c => c.textContent.includes('Σ'))[1].click()`);
    const r = await page.eval(`({ where: ${V}.querySelector('.rs-where').innerText, reads: [...new Set([...${V}.querySelectorAll('.rs-vec')].map((v, i) => v.classList.contains('read') ? i % 9 : null).filter(x => x != null))],
      mats: [...${V}.querySelectorAll('.rs-detail .mx-name')].map(n => n.textContent), on: ${V}.querySelectorAll('.rs-detail tr.rs-on').length,
      kx: getComputedStyle(${V}.querySelector('.rs-detail .rs-m')).getPropertyValue('--c') })`);
    assert(/Layer 2/.test(r.where) && /Weighted sum/.test(r.where), r.where);
    assert(r.reads.join() === '4', 'layer 2 should read x(1): ' + r.reads);
    assert(r.mats.length === 3 && r.on >= 3, JSON.stringify(r));
    await page.shot('viz-residual-L2-mix');
    // keyboard: ← goes back one step
    await page.eval(`${V}.focus()`); await page.key('ArrowLeft'); await sleep(100);
    assert(/Softmax/.test(await page.eval(`${V}.querySelector('.rs-where').innerText`)), 'ArrowLeft');
    // edit: river's water → 0 changes bank's layer-2 output (it read river's layer-1 x)
    await page.eval(`[...${V}.querySelectorAll('.rs-toks button')].find(b => b.textContent === 'river').click()`);
    await page.eval(`(() => { const i = ${V}.querySelector('.rs-sliders input'); i.value = '0'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(100);
    assert(await cell(0, 1) === '0 0 1 0', 'river x0 after edit: ' + await cell(0, 1));
    assert(await cell(8, 2) !== '0.53 0.58 1 1.12' && await page.eval(`${V}.querySelectorAll('.rs-n.chg').length`) > 10, 'bank did not change: ' + await cell(8, 2));
    await page.shot('viz-residual-edited');
    await page.eval(`${V}.querySelector('.rs-tw-h .btn').click()`);
    assert(await cell(8, 2) === '0.53 0.58 1 1.12' && !(await page.eval(`${V}.querySelectorAll('.rs-n.chg').length`)), 'reset');
    // linked highlight: hovering a token header lights that token's rows in the matrices
    await page.hover(`.page-md .viz-residual .rs-tokl[data-k="river"]`, 200);
    assert(await page.eval(`${V}.querySelectorAll('.rs-detail .hl').length`) > 2, 'no linked highlight');
    await page.mouse('mouseMoved', 5, 5);
    // the skill page links back to the page
    await page.nav(`${BASE}/#/demo/wiki/skill/4.1`, 900);
    await page.waitFor(`[...document.querySelectorAll('.sheet .chip-btn')].some(b => b.textContent.includes('layer by layer'))`, { timeout: 3000 });
  });
  await test('search finds terms and messages', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    await page.eval(`document.querySelector('#searchBtn').click()`);
    await page.type('softmax');
    const n = await page.waitFor(`document.querySelectorAll('.sr').length`);
    assert(n > 3, 'results ' + n);
    await page.key('Escape');
  });

  console.log('\nGlossary & feedback');
  await test('term page: expansion with bold initials, parts listed and linked', async () => {
    await page.nav(`${BASE}/#/demo/wiki/term/BPE`, 900);
    const r = await page.waitFor(`(() => { const f = document.querySelector('.sheet .title-block .term-full'); return f && { text: f.textContent, strong: f.querySelectorAll('strong').length,
      parts: [...document.querySelectorAll('.sheet .parts .part .gl-term')].map(p => p.firstChild.textContent) }; })()`, { timeout: 4000 });
    assert(r.text === '— Byte-Pair Encoding' && r.strong === 3, JSON.stringify(r));
    assert(r.parts.join() === 'token,vocabulary,tokenizer', JSON.stringify(r.parts));
    await page.shot('term-full-parts');
    await page.click('.sheet .parts .part');
    await page.waitFor(`document.querySelector('#dock .title-block h2')?.textContent === 'token'`, { timeout: 3000 });
    assert(!(await page.eval(`!!document.querySelector('#dock .term-full')`)), 'no expansion shown for a term without full:');
  });
  await test('tooltip: expansion in the header, parts open nested cards', async () => {
    await page.mouse('mouseMoved', 5, 5); await sleep(400);
    await page.eval(`document.querySelector('.sheet .title-block').append(Object.assign(document.createElement('span'), { className: 'term', id: 'zz-bpe', textContent: 'BPE' }))`);
    await page.eval(`document.querySelector('#zz-bpe').dataset.term = 'BPE'`);
    await page.hover('#zz-bpe', 700);
    const r = await page.waitFor(`(() => { const c = document.querySelector('.hovercard.on'); return c && { head: c.querySelector('.hc-head').textContent, parts: [...c.querySelectorAll('.hc-parts .ref-term')].map(b => b.dataset.id) }; })()`, { timeout: 2000 });
    assert(/BPE— Byte-Pair Encoding/.test(r.head) && r.parts.join() === 'token,vocabulary,tokenizer', JSON.stringify(r));
    await page.shot('tooltip-full-parts');
    await page.eval(`document.querySelector('.hovercard .hc-parts .ref-term').id = 'zz-part'`);
    await page.hover('#zz-part', 800);
    const heads = await page.eval(`[...document.querySelectorAll('.hovercard .hc-head b')].map(b => b.textContent)`);
    assert(heads.join() === 'BPE,token', 'nested card: ' + heads);
    await page.mouse('mouseMoved', 5, 5); await sleep(600);
  });
  await test('term page: its own page (terms/<name>.md) with fog, terms linking here, page markers; in the wiki and the dock', async () => {
    await page.nav(`${BASE}/#/demo/wiki/term/temperature`, 900);
    const r = await page.waitFor(`(() => { const p = document.querySelector('.sheet .term-page .term-md'); if (!p || !p.querySelector('.viz svg')) return null;
      const fog = p.querySelector('.callout-fog');
      return { h1: p.querySelectorAll('h1').length, h2: p.querySelector('h2')?.textContent, fog: fog?.querySelector('.callout-label').textContent, dashed: fog && getComputedStyle(fog).borderTopStyle,
        katex: p.querySelectorAll('.katex').length, terms: [...new Set([...p.querySelectorAll('.term')].map(t => t.dataset.term))],
        heads: [...document.querySelectorAll('.sheet > .group > .group-h')].map(g => [...g.childNodes].filter(n => !n.classList?.contains('count') && !n.classList?.contains('group-note')).map(n => n.textContent).join('').trim()),
        linked: [...document.querySelectorAll('.sheet .links-from .chip')].map(c => c.textContent) }; })()`, { timeout: 4000 });
    assert(r.h1 === 0 && r.h2 === 'What changes as you turn it' && r.katex >= 2, 'page body: ' + JSON.stringify(r));
    assert(r.fog === 'Not covered yet' && r.dashed === 'dashed', 'fog: ' + JSON.stringify(r));
    assert(r.terms.includes('softmax') && r.terms.includes('sampling'), 'terms linked inside the page: ' + r.terms);
    assert(r.heads.join() === 'Definition,What you know,Related terms,Linked from,Explained in', 'sections: ' + r.heads);
    assert(['softmax', 'sampling'].every(x => r.linked.some(c => c.includes(x))), 'linked from: ' + r.linked);
    assert(await page.eval(`!document.querySelector('.sheet .term-page .term[data-term="temperature"], .sheet .def .term[data-term="temperature"]')`), 'the term links to itself on its own page');
    await page.shot('term-page');
    await page.eval(`document.querySelector('.sheet .callout-fog').scrollIntoView({ block: 'center' })`);
    await page.shot('term-page-fog');
    await page.nav(`${BASE}/#/demo/wiki/pages`, 900);
    assert(/^Temperature T is the number/.test(await page.waitFor(`document.querySelector('.term-pages .page-sum')?.textContent`)), 'page summary is plain text');
    await page.nav(`${BASE}/#/demo/wiki/term/KV%20cache`, 900);
    assert(/No page for this term yet/.test(await page.waitFor(`document.querySelector('.sheet .group .empty-row')?.textContent`)), 'no-page note');
    await page.nav(`${BASE}/#/demo/wiki/glossary`, 900);
    const marked = await page.waitFor(`[...document.querySelectorAll('.gl-row')].filter(r => r.querySelector('.gl-has-page')).map(r => [...r.querySelector('.gl-name').childNodes].find(n => n.nodeType === 3).textContent)`);
    assert(marked.join() === 'temperature', 'page markers: ' + marked);
    await page.nav(`${BASE}/#/demo/learn`, 1200);
    await page.waitFor(`document.querySelector('.thread .term[data-term="temperature"], .thread .ref-term[data-id="temperature"]')`, { timeout: 3000 });
    await page.eval(`document.querySelector('.thread .term[data-term="temperature"], .thread .ref-term[data-id="temperature"]').id = 'zz-temp'`);
    await page.click('#zz-temp', 300);
    const dock = await page.waitFor(`(() => { const d = document.querySelector('#dock'); return d.querySelector('.term-page .callout-fog') && { title: d.querySelector('.title-block h2').textContent,
      marker: !!d.querySelector('.gl-has-page'), btn: [...d.querySelectorAll('.actions .btn')].map(b => b.textContent).join('|') }; })()`, { timeout: 3000 });
    assert(dock.title === 'temperature' && /Open its page/.test(dock.btn), 'dock: ' + JSON.stringify(dock));
    await page.shot('term-page-dock');
  });
  // a message in the (otherwise empty) cells topic exercising the auto-linker, tips and the
  // glossary coverage reminder
  const post = (topic, text) => execFileSync(process.execPath, [BIN, 'post', '--topic', topic], { env: ENV, input: text, encoding: 'utf8' });
  const lastTutor = topic => fs.readdirSync(path.join(HOME, 'topics', topic, 'journal')).sort().flatMap(f => fs.readFileSync(path.join(HOME, 'topics', topic, 'journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))).filter(e => e.role === 'tutor').at(-1);
  let termsMsg = null, postOut = '';
  await test('glossary links: every occurrence (bold, lists, tables, callouts, headings), plurals and case; never in code, links or viz', async () => {
    learn('term', 'add', 'cells', 'DNA polymerase', '--short', 'The enzyme that copies DNA.', '--skill', '1.2', '--aliases', 'polymerase');
    learn('term', 'add', 'cells', 'nucleus', '--short', 'The compartment holding the DNA.', '--skill', '1.2');
    postOut = post('cells', [
      '## How polymerase works', '',
      '**Polymerase** reads the strand. DNA Polymerase is fast; polymerases are many. The polymerase\'s active site.', '',
      'The [template strand](tip:the strand being **read** (3′→5′), not the new one) is read. **Helicase** opens it. **Correct:** yes.', '',
      '- In the nucleus, and in the nuclei of many organelles', '- a **plasma membrane** item', '',
      '| part | job |', '|---|---|', '| polymerase | copies |', '',
      ':::note', 'Polymerase again, inside a callout.', ':::', '',
      '`polymerase` in code, [polymerase](https://example.com/x), {{polymerase|p}} and $x$.', '',
      '```viz bars', '{ items: [{ label: "polymerase", value: 0.6 }, { label: "nucleus", value: 0.4 }] }', '```'].join('\n'));
    termsMsg = lastTutor('cells').id;
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const sel = `[id="m-${termsMsg}"] .msg-body`;
    await page.waitFor(`document.querySelector('${sel} .term')`, { timeout: 4000 });
    const r = await page.eval(`(() => { const b = document.querySelector('${sel}'), q = s => [...b.querySelectorAll(s)];
      const pol = q('.term[data-term="DNA polymerase"]');
      return { pol: pol.map(t => t.textContent), again: pol.map(t => t.classList.contains('term-again')),
        where: pol.map(t => t.parentElement.closest('h2, strong, li, td, .callout, p')?.tagName.toLowerCase() + (t.closest('.callout') ? '+callout' : '')),
        nucleus: q('.term[data-term="nucleus"]').map(t => t.textContent), organelle: q('.term[data-term="organelle"]').map(t => t.textContent),
        membrane: q('strong .term[data-term="cell membrane"]').length,
        bad: q('code .term, a .term, .lk .term, .viz .term, .katex .term').length,
        colors: [getComputedStyle(pol[0]).borderBottomColor, getComputedStyle(pol[1]).borderBottomColor] }; })()`);
    assert(r.pol.join('|') === "polymerase|Polymerase|DNA Polymerase|polymerases|polymerase|polymerase|Polymerase", 'every occurrence: ' + JSON.stringify(r));
    assert(r.again.join() === 'false,true,true,true,true,true,true', 'first clear, repeats faint: ' + r.again);
    assert(r.where.join() === 'h2,strong,p,p,p,td,p+callout', 'places: ' + r.where);
    assert(r.nucleus.join() === 'nucleus,nuclei' && r.organelle.join() === 'organelles' && r.membrane === 1, 'plurals and bold: ' + JSON.stringify(r));
    assert(r.bad === 0, 'linked inside code, links, highlights, viz or maths');
    assert(r.colors[0] !== r.colors[1], 'repeat looks the same as the first: ' + r.colors);
    await page.shot('terms-every-occurrence');
    await page.eval(`document.querySelectorAll('${sel} .term-again')[2].id = 'zz-again'`);
    await page.hover('#zz-again', 700);
    const head = await page.waitFor(`document.querySelector('.hovercard.on .hc-head b')?.textContent`, { timeout: 2000 });
    assert(head === 'DNA polymerase', 'card for a repeat: ' + head);
    await page.mouse('mouseMoved', 5, 5); await sleep(500);
  });
  await test('tips: [text](tip:…) reads as plain text and shows its note in a hover card', async () => {
    const sel = `[id="m-${termsMsg}"] .msg-body`;
    const r = await page.eval(`(() => { const b = document.querySelector('${sel}'), t = b.querySelector('.tipref');
      return { text: t?.textContent, para: t?.closest('p').innerText, tip: t?.dataset.tip, termInside: !!t?.querySelector('.term') }; })()`);
    assert(r.text === 'template strand' && /^The template strand is read\. Helicase opens it\./.test(r.para) && !r.termInside, JSON.stringify(r));
    assert(r.tip === 'the strand being **read** (3′→5′), not the new one', 'note: ' + r.tip);
    await page.eval(`document.querySelector('${sel} .tipref').id = 'zz-tip'`);
    await page.hover('#zz-tip', 700);
    const c = await page.waitFor(`(() => { const c = document.querySelector('.hovercard.on'); return c && { head: c.querySelector('.hc-head b')?.textContent, kind: c.querySelector('.hc-kind')?.textContent,
      body: c.querySelector('.hc-body')?.innerText, bold: c.querySelector('.hc-body strong')?.textContent }; })()`, { timeout: 2000 });
    assert(c.head === 'template strand' && c.kind === 'in this message' && /the strand being read \(3′→5′\), not the new one/.test(c.body) && c.bold === 'read', JSON.stringify(c));
    await page.shot('tip-card');
    await page.mouse('mouseMoved', 5, 5); await sleep(500);
  });
  await test('glossary coverage: post and terms-missing list bold phrases that are no term or alias', async () => {
    assert(/glossary: bold here but not in the glossary: "Helicase"\./.test(postOut) && !/Correct|Polymerase"|plasma/.test(postOut.split('glossary:')[1]), postOut);
    const out = learn('terms-missing', 'cells');
    assert(new RegExp(`^  Helicase +${termsMsg.replace('.', '\\.')}$`, 'm').test(out) && !/Polymerase|plasma membrane|Correct/.test(out), out);
    learn('term', 'add', 'cells', 'helicase', '--short', 'Unzips DNA.', '--skill', '1.2');
    assert(/every bold phrase in the last tutor message is a glossary term or alias/.test(learn('terms-missing', 'cells')), 'after adding it');
    assert(!/glossary:/.test(post('cells', 'Now **helicases** are known.')), 'plural of a known term reported');
  });
  await test('images: bin/learn image keeps a Commons file (fake API) or a local file in the topic; media: shows it with its credit, offline; click zooms', async () => {
    const http = await import('node:http');
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const hits = [];
    let throttled = 0;
    const fake = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); hits.push(u.pathname + ' ' + (req.headers['user-agent'] || ''));
      if (u.pathname === '/w/api.php' && u.searchParams.get('generator') === 'search')
        return res.end(JSON.stringify({ query: { pages: [{ index: 1, title: 'File:Test cell.png', imageinfo: [{ width: 1, height: 1, mime: 'image/png', extmetadata: { LicenseShortName: { value: 'CC0' }, Artist: { value: 'Jane Doe' } } }] }] } }));
      // a bigger raster file: Commons throttles its original and, once, its 500px thumbnail
      if (u.pathname === '/w/api.php' && u.searchParams.get('titles') === 'File:Big cell.png') {
        const w = Number(u.searchParams.get('iiurlwidth')) || 0, base = `http://127.0.0.1:${fake.address().port}/commons`;
        return res.end(JSON.stringify({ query: { pages: [{ title: 'File:Big cell.png', imageinfo: [{ width: 800, height: 400, mime: 'image/png', user: 'Uploader1', url: `${base}/b/bc/Big_cell.png`,
          ...(w ? { thumburl: w < 800 ? `${base}/thumb/b/bc/Big_cell.png/${w}px-Big_cell.png?utm_source=x` : `${base}/b/bc/Big_cell.png`, thumbwidth: Math.min(w, 800), thumbheight: Math.min(w, 800) / 2 } : {}),
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Big_cell.png', extmetadata: { LicenseShortName: { value: 'CC0' }, Credit: { value: 'Own work' } } }] }] } }));
      }
      if (u.pathname === '/commons/b/bc/Big_cell.png' || (u.pathname.endsWith('/500px-Big_cell.png') && !throttled++))
        { res.writeHead(429, { 'retry-after': '0' }); return res.end('use thumbnails'); }
      if (u.pathname.endsWith('px-Big_cell.png')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
      if (u.pathname === '/w/api.php') return res.end(JSON.stringify({ query: { pages: [u.searchParams.get('titles') !== 'File:Test cell.png' ? { title: u.searchParams.get('titles'), missing: true } : {
        title: 'File:Test cell.png', imageinfo: [{ width: 1, height: 1, mime: 'image/png', url: `http://127.0.0.1:${fake.address().port}/commons/a/ab/Test_cell.png`,
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Test_cell.png', extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jd">Jane Doe</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' }, ImageDescription: { value: 'A <i>test</i> cell' } } }] }] } }));
      if (u.pathname === '/commons/a/ab/Test_cell.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
      res.writeHead(404); res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const env = { ...ENV, LEARN_COMMONS_API: `http://127.0.0.1:${fake.address().port}/w/api.php` };
    // async: the fake server runs in this process, so a blocking execFileSync would starve it
    const { execFile } = await import('node:child_process');
    const img = (...a) => new Promise((res, rej) => execFile(process.execPath, [BIN, 'image', ...a], { env, encoding: 'utf8' }, (e, out, err) => e ? rej(Object.assign(e, { stderr: err })) : res(out)));
    const fails = p => p.then(() => '', e => String(e.stderr));
    try {
      assert(/File:Test cell\.png  1×1 png  CC0 · Jane Doe/.test(await img('search', 'test cell')), 'search');
      const out = await img('cells', 'https://commons.wikimedia.org/wiki/File:Test_cell.png');
      assert(/saved cells\/media\/test-cell\.png .*CC BY-SA 4\.0 · Jane Doe/.test(out) && /!\[caption\]\(media:test-cell\.png\)/.test(out), out);
      assert(hits.every(h => /^\S+ learn-tutor\//.test(h)), 'generic user agent: ' + hits);
      const big = await img('cells', 'File:Big cell.png');
      const bigHits = hits.filter(h => h.includes('Big_cell.png')).map(h => h.split(' ')[0]);
      assert(/saved cells\/media\/big-cell\.png \(330×165\) · CC0 · Uploader1 \(uploader\)/.test(big), 'standard thumbnail, smaller after a 429, uploader as author: ' + big);
      assert(bigHits.join() === '/commons/thumb/b/bc/Big_cell.png/500px-Big_cell.png,/commons/thumb/b/bc/Big_cell.png/330px-Big_cell.png', 'never the original: ' + bigHits);
      const missing = await fails(img('cells', 'File:Nope.png'));
      assert(/no file "File:Nope\.png" on Commons/.test(missing), missing);
    } finally { fake.close(); }
    const mine = path.join(HOME, 'fig.png'); fs.writeFileSync(mine, PNG);
    assert(/needs --author and --license/.test(await fails(img('cells', mine))), 'local file without credit');
    assert(/saved cells\/media\/fig\.png/.test(await img('cells', mine, '--author', 'Me', '--license', 'CC0')), 'local file');
    const idx = JSON.parse(fs.readFileSync(path.join(HOME, 'topics/cells/media/index.json'), 'utf8'));
    assert(idx['test-cell.png'].author === 'Jane Doe' && idx['test-cell.png'].description === 'A test cell' && fs.readFileSync(path.join(HOME, 'topics/cells/media/test-cell.png')).equals(PNG), JSON.stringify(idx));
    assert(/test-cell\.png  CC BY-SA 4\.0 · Jane Doe/.test(await img('list', 'cells')), 'list');
    assert((await fetch(`${BASE}/media/cells/%2e%2e%2ftopic.json`)).status === 404 && (await fetch(`${BASE}/media/cells/index.json`)).status === 404, 'only images are served');
    await sleep(500);   // the topic reloads with the new media index
    post('cells', '![A test cell](media:test-cell.png)\n\nThe same file, hotlinked: ![hotlinked](https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_cell.png/320px-Test_cell.png)\n\n![My figure](media:fig.png)');
    const id = lastTutor('cells').id, sel = `[id="m-${id}"] .msg-body`;
    const nope = (() => { try { post('cells', '![gone](media:nope.png)'); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/link media:nope\.png: not in media\//.test(nope) && lastTutor('cells').id === id, 'missing media posted: ' + nope);
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const r = await page.waitFor(`(() => { const f = [...document.querySelectorAll('${sel} .media-fig')]; return f.length === 3 && f.every(x => x.querySelector('img').complete) &&
      f.map(x => ({ src: x.querySelector('img').getAttribute('src'), w: x.querySelector('img').naturalWidth, cap: x.querySelector('.media-cap').innerText.replace(/\\s+/g, ' ') })); })()`, { timeout: 4000 });
    assert(r.map(x => x.src).join() === '/media/cells/test-cell.png,/media/cells/test-cell.png,/media/cells/fig.png' && r.every(x => x.w === 1), JSON.stringify(r));
    assert(/^A test cell Jane Doe · CC BY-SA 4\.0 · source$/.test(r[0].cap) && /^My figure Me · CC0$/.test(r[2].cap), JSON.stringify(r.map(x => x.cap)));
    await page.click(`${sel} .media-fig img`, 300);
    const lb = await page.eval(`(() => { const l = document.querySelector('.lightbox'); return l && { img: l.querySelector('img').getAttribute('src'), cap: l.querySelector('.lightbox-cap')?.innerText.replace(/\\s+/g, ' ') }; })()`);
    assert(lb && lb.img.endsWith('/media/cells/test-cell.png') && /A test cell/.test(lb.cap) && /Jane Doe/.test(lb.cap), 'lightbox: ' + JSON.stringify(lb));
    await page.shot('image-lightbox');
    await page.key('Escape'); await sleep(100);
    assert(await page.eval(`!document.querySelector('.lightbox')`), 'Escape closes the lightbox');
  });
  await test('term page: pictures from lessons whose caption names the term; a new page file shows up live', async () => {
    post('cells', '![The cell membrane, up close](media:fig.png)');
    await page.nav(`${BASE}/#/cells/wiki/term/cell%20membrane`, 1000);
    const pics = await page.waitFor(`(() => { const p = [...document.querySelectorAll('.sheet .term-pic')]; return p.length && p.map(x => ({ src: x.querySelector('img')?.getAttribute('src'), from: x.querySelector('.linkish').textContent })); })()`, { timeout: 4000 });
    assert(pics.length === 1 && pics[0].src === '/media/cells/fig.png' && /^from /.test(pics[0].from), 'pictures: ' + JSON.stringify(pics));
    assert(/organelle/.test(await page.eval(`document.querySelector('.sheet .links-from')?.innerText || ''`)), 'organelle (see: cell membrane) links here');
    fs.mkdirSync(path.join(HOME, 'topics/cells/terms'), { recursive: true });
    fs.writeFileSync(path.join(HOME, 'topics/cells/terms/membrane.md'), '# membrane\n\nA page named after an alias, written while the page is open.\n');
    await page.waitFor(`/named after an alias/.test(document.querySelector('.sheet .term-page')?.innerText || '')`, { timeout: 5000 });
    assert(/^cells: ok/m.test(learn('check', 'cells')), 'an alias-named page checks out');
  });
  await test('visual language: the topic legend colours keys in prose and drawings, ctx.legend draws the key; wiki, resume, CLI', async () => {
    assert(/added membrane #d6b450 "membrane" in cells's legend$/m.test(learn('legend', 'cells', 'set', 'membrane', '#d6b450', 'membrane', '--term', 'plasma membrane')), 'set');
    learn('legend', 'cells', 'set', 'dna', '#3d7fd0', 'DNA strand');
    assert(/warning: #3D7FD0 is also "DNA strand" \(dna\)/.test(learn('legend', 'cells', 'set', 'zz', '#3D7FD0', 'other')), 'colour clash warned');
    learn('legend', 'cells', 'rm', 'zz');
    const fails = (...a) => { try { learn(...a); return ''; } catch (e) { return String(e.stderr); } };
    assert(/bad colour/.test(fails('legend', 'cells', 'set', 'x', 'not a colour')) && /no glossary term "nope"/.test(fails('legend', 'cells', 'set', 'x', '#fff', 'x', '--term', 'nope')), 'bad input refused');
    const list = learn('legend', 'cells');
    assert(/^  membrane +#d6b450 +membrane  \(term: plasma membrane\)$/m.test(list) && /^  dna +#3d7fd0 +DNA strand$/m.test(list) && !/zz/.test(list), list);
    assert(/Visual language[^\n]*\n  membrane +#d6b450/.test(learn('resume', 'cells')), 'resume shows the legend');
    assert(/^cells: ok$/m.test(learn('check', 'cells')), 'check');
    await sleep(400);   // topic.json changed: the browser reloads the topic
    post('cells', ['The {{membrane|membrane}} keeps the {{DNA|dna}} in, unlike {{something else|zz}}.', '',
      '```viz js', 'const b = ctx.h("span", { id: "zz-box", text: "DNA" }); ctx.key(b, "dna"); b.style.background = ctx.color("dna");', 'el.append(b, ctx.legend(["membrane", "dna"]));', '```'].join('\n'));
    const id = lastTutor('cells').id, sel = `[id="m-${id}"] .msg-body`;
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const r = await page.waitFor(`(() => { const b = document.querySelector('${sel}'); if (!b?.querySelector('#zz-box')) return null; const kc = k => b.querySelector('.lk[data-k="' + k + '"]').style.getPropertyValue('--kc');
      return { dna: kc('dna'), membrane: kc('membrane'), other: kc('zz'), box: getComputedStyle(b.querySelector('#zz-box')).backgroundColor,
        legend: [...b.querySelectorAll('.viz-legend .vl-item')].map(x => x.textContent + ' ' + getComputedStyle(x.querySelector('.vl-sw')).backgroundColor) }; })()`, { timeout: 4000 });
    assert(r.dna === '#3d7fd0' && r.membrane === '#d6b450' && r.other === 'var(--k0)', 'prose keys: ' + JSON.stringify(r));
    assert(r.box === 'rgb(61, 127, 208)' && r.legend.join() === 'membrane rgb(214, 180, 80),DNA strand rgb(61, 127, 208)', 'drawing: ' + JSON.stringify(r));
    await page.eval(`document.querySelector('${sel} .viz-legend .vl-item[data-k="dna"]').id = 'zz-lg'`);
    await page.hover('#zz-lg', 300);
    assert(await page.eval(`document.querySelector('${sel} .lk[data-k="dna"]').classList.contains('hl') && document.querySelector('#zz-box').classList.contains('hl')`), 'hovering a legend item lights up its parts');
    await page.shot('legend-message');
    await page.nav(`${BASE}/#/cells/wiki/cheatsheet`, 900);
    const rows = await page.waitFor(`[...document.querySelectorAll('.vlg-row')].map(x => [...x.children].map(c => c.textContent).join('/'))`);
    assert(rows.join('|') === '/membrane/cell membrane/membrane|/DNA strand//dna', 'cheat sheet: ' + rows.join('|'));
    await page.shot('legend-cheatsheet');
    await page.nav(`${BASE}/#/cells/wiki/term/cell%20membrane`, 900);
    assert(/membrane in diagrams|in diagrams/.test(await page.waitFor(`document.querySelector('.sheet .title-block .chip-legend')?.textContent`)), 'term page shows its colour');
  });
  await test('post refuses a message that ends with a question outside :::question (--force for a rhetorical one)', async () => {
    const n = lastTutor('cells').id;
    const err = (() => { try { post('cells', 'Here is the plan.\n\nShall I start with step 1?'); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/not posted: the message ends with a question outside a :::question block/.test(err) && lastTutor('cells').id === n, err);
    execFileSync(process.execPath, [BIN, 'post', '--topic', 'cells', '--force'], { env: ENV, input: 'Who knew?', encoding: 'utf8' });
    post('cells', 'Plan.\n\n:::question\nShall I start with step 1?\n:::');
    assert(lastTutor('cells').question && lastTutor('cells').id !== n, 'question posts');
  });
  await test('a new long tutor reply scrolls to its beginning, not to the bottom', async () => {
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    await page.eval(`(() => { const sc = document.querySelector('#threadScroll'); sc.scrollTop = sc.scrollHeight; })()`);
    await sleep(300);
    post('cells', ['Start of a long reply.', ...Array.from({ length: 80 }, (_, i) => `\nParagraph ${i + 1} of a long explanation.`)].join('\n'));
    const id = lastTutor('cells').id;
    const off = await page.waitFor(`(() => { const sc = document.querySelector('#threadScroll'), n = document.querySelector('[id="m-${id}"]');
      if (!n) return null; const d = n.getBoundingClientRect().top - sc.getBoundingClientRect().top; return Math.abs(d) < 60 ? d : null; })()`, { timeout: 5000 });
    assert(off !== null, 'reply start not at the top of the thread');
    assert(await page.eval(`(() => { const sc = document.querySelector('#threadScroll'); return sc.scrollHeight - sc.scrollTop - sc.clientHeight > 200; })()`), 'scrolled to the bottom instead');
  });
  await test('glossary sort: newest first by first mention, remembered, in wiki and dock', async () => {
    await page.eval(`localStorage.removeItem('learn:glossarySort')`);
    await page.nav(`${BASE}/#/demo/wiki/glossary`, 900);
    await page.waitFor(`document.querySelectorAll('.gl-row').length > 10`);
    assert(await page.eval(`document.querySelector('.sheet .gl-sort button.on')?.dataset.sort`) === 'alpha', 'default is A–Z');
    await page.click('.sheet .gl-sort [data-sort="new"]');
    const order = `(async () => { const { termEntry, introOf } = await import('/js/panels.js');
      const names = [...document.querySelectorAll(SEL)].map(b => [...b.childNodes].find(n => n.nodeType === 3).textContent.trim());
      return { names, ts: names.map(n => introOf(termEntry(n))?.ts || ''), heads: [...document.querySelectorAll(HEAD)].map(x => x.textContent) }; })()`;
    const check = r => {
      const dated = r.ts.filter(Boolean);
      assert(dated.length > 10 && dated.every((t, i) => !i || t <= dated[i - 1]), 'not newest first: ' + JSON.stringify(r.names.map((n, i) => n + ' ' + r.ts[i])));
      assert(r.ts.findIndex(t => !t) < 0 || r.ts.slice(r.ts.findIndex(t => !t)).every(t => !t), 'undated terms not last');
      assert(r.heads.length > 1 && r.heads.every(x => x.length > 1), 'date sections: ' + r.heads);
    };
    const wiki = await page.eval(order.replace('SEL', `'.sheet .gl-row .gl-name'`).replace('HEAD', `'.sheet .gl-letter'`));
    check(wiki);
    await page.shot('glossary-newest');
    assert(await page.eval(`localStorage['learn:glossarySort']`) === '"new"', 'not remembered');
    await page.nav(`${BASE}/#/demo/wiki/glossary`, 900);
    assert(await page.eval(`document.querySelector('.sheet .gl-sort button.on')?.dataset.sort`) === 'new', 'not restored after reload');
    const dock = await page.eval(order.replace('SEL', `'#dock .gl-item .gl-term'`).replace('HEAD', `'#dock .gl-letter'`));
    check(dock);
    assert(dock.names.join() === wiki.names.join(), 'dock and wiki order differ');
    await page.click('.sheet .gl-sort [data-sort="alpha"]');
    assert(await page.eval(`document.querySelector('.sheet .gl-letter').textContent`) === 'A', 'back to A–Z');
  });
  await test('feedback box in the toolbar: saves, confirms, stays out of the conversation', async () => {
    const jl = journal().length;
    await page.nav(`${BASE}/#/demo/learn`, 1000);   // (also leaves the URL where the light-theme test reloads it)
    await page.click('#feedbackBtn');
    await page.waitFor(`document.activeElement?.id === 'feedbackBox'`, { timeout: 2000 });
    await page.type('UI feedback from the box');
    await page.key('Enter', { meta: true });
    await page.waitFor(`document.querySelector('.fb-pop .pop-note.ok')`, { timeout: 3000 });
    await page.shot('feedback');
    const f = fs.readFileSync(path.join(HOME, 'feedback.md'), 'utf8');
    assert(/^- \[ \] \d{4}-\d{2}-\d{2} \(learner, demo · learn\): UI feedback from the box$/m.test(f), f);
    assert(await page.eval(`document.querySelector('#feedbackBox').value === '' && localStorage['learn:draft:feedback'] === '""'`), 'box/draft not cleared');
    assert(journal().length === jl, 'journaled');
    await page.key('Escape'); await sleep(100);
    assert(await page.eval(`!document.querySelector('.fb-pop')`), 'Escape closes');
  });
  await test('formulas: keyed parts are coloured without hovering; tables are centred', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    const r = await page.eval(`(() => {
      const k = document.querySelector('.msg-body .katex [data-k]'), fg = getComputedStyle(document.querySelector('.msg-body')).color;
      const t = [...document.querySelectorAll('.msg-body table')].find(t => t.offsetWidth < t.parentElement.offsetWidth - 40);
      return { keyed: !!k, colored: k && getComputedStyle(k).color !== fg,
        centred: !t || Math.abs((t.getBoundingClientRect().left - t.parentElement.getBoundingClientRect().left) - (t.parentElement.getBoundingClientRect().right - t.getBoundingClientRect().right)) < 4 }; })()`);
    assert(r.keyed && r.colored && r.centred, JSON.stringify(r));
  });
  await test('post refuses links to grade entries and unknown skills; --expect stores the rubric', async () => {
    const grade = journal().find(e => e.kind === 'grade');
    const bad = (() => { try { execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo'], { env: ENV, input: `see [this](msg:${grade.id})`, encoding: 'utf8' }); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/grade entry/.test(bad) && /not posted/.test(bad), bad);
    assert(!journal().some(e => e.text === `see [this](msg:${grade.id})`), 'was posted anyway');
    execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--skill', '4.2', '--expect', 'heads split d_model'], { env: ENV, input: 'Rubric test.\n\n:::question\nWhy several heads?\n:::', encoding: 'utf8' });
    const q = journal().at(-1);
    assert(q.question && q.expect === 'heads split d_model', JSON.stringify(q));
    assert(/Good answer needs: heads split d_model/.test(learn('pending', 'demo')), 'pending shows rubric');
  });
  await test('skill panel shows needs, unlocks and the tutor’s notes', async () => {
    await page.nav(`${BASE}/#/demo/tree/4.3`, 1200);
    await page.waitFor(`document.querySelector('#dock .deps')`, { timeout: 3000 });
    const t = await page.eval(`document.querySelector('#dock').innerText`);
    assert(/needs/i.test(t) && /unlocks/i.test(t) && /4\.4/.test(t) && /Why the mask/.test(t), t.slice(0, 400));
  });
  await test('skill tree: a deep tree packs into branch panels that fit; Tiers / Branches toggle', async () => {
    // synthetic 10 branches × 4 skills, chained across branches: 40 tiers deep in the Tiers layout
    const tj = path.join(HOME, 'topics/cells/topic.json'), orig = fs.readFileSync(tj, 'utf8');
    const skills = Array.from({ length: 10 }, (_, b) => ({ id: String(b + 1), name: `Branch ${b + 1}`, children: Array.from({ length: 4 }, (_, i) => ({
      id: `${b + 1}.${i + 1}`, name: `Skill ${b + 1}.${i + 1}`, level: (b + i) % 5,
      needs: i ? [`${b + 1}.${i}`, ...(i === 2 && b ? [`${b}.3`, 'maths'] : [])] : b ? [`${b}.4`] : ['maths'] })) }));
    fs.writeFileSync(tj, JSON.stringify({ ...JSON.parse(orig), skills, foundations: [{ id: 'maths', name: 'Maths', level: 2 }] }, null, 2));
    try {
      await page.eval(`localStorage.removeItem('learn:treeLayout'); localStorage.removeItem('learn:treeZoomBranches')`);
      await page.nav(`${BASE}/#/cells/tree`, 1200);
      await page.waitFor(`document.querySelectorAll('.tree-node').length === 41`, { timeout: 5000 });
      const st = await page.eval(`(() => { const s = document.querySelector('.tree-stage'), b = document.querySelector('.tree-body');
        return { mode: [...s.classList].find(c => c.startsWith('mode-')), on: document.querySelector('.tree-mode .on')?.dataset.mode,
          panels: document.querySelectorAll('.tree-lane').length, cols: new Set([...document.querySelectorAll('.tree-lane')].map(l => l.style.left)).size,
          zoom: document.querySelector('#treeZoomLvl').textContent, chips: document.querySelectorAll('.tree-x').length,
          hidden: [...document.querySelectorAll('.tree-edge.x')].every(e => getComputedStyle(e).opacity === '0'),
          fits: s.getBoundingClientRect().width <= b.clientWidth + 1 }; })()`);
      assert(st.mode === 'mode-branches' && st.on === 'branches', 'deep tree defaults to branches: ' + JSON.stringify(st));
      assert(st.panels === 11 && st.cols >= 3, 'packed into columns: ' + JSON.stringify(st));
      assert(parseInt(st.zoom) >= 60 && st.fits, 'readable and fits the width: ' + JSON.stringify(st));
      assert(st.chips > 10 && st.hidden, 'cross-branch links are chips, edges hidden: ' + JSON.stringify(st));
      await page.shot('tree-branches-deep');
      await page.eval(`document.querySelector('.tree-node[data-id="5.3"]').dispatchEvent(new MouseEvent('mouseenter'))`);
      await page.waitFor(`[...document.querySelectorAll('.tree-edge.x.up')].filter(e => getComputedStyle(e).opacity === '1').length >= 2`, { timeout: 2000 });
      await page.shot('tree-branches-hover');
      await page.eval(`document.querySelector('.tree-node[data-id="5.3"]').dispatchEvent(new MouseEvent('mouseleave'))`);
      await page.eval(`document.querySelector('.tree-mode [data-mode="tiers"]').click()`);
      await page.waitFor(`document.querySelector('.tree-stage.mode-tiers') && document.querySelectorAll('.tree-lane').length === 41`, { timeout: 3000 });
      assert(await page.eval(`JSON.parse(localStorage['learn:treeLayout'])`) === 'tiers', 'choice remembered');
      await page.eval(`document.querySelector('.tree-mode [data-mode="branches"]').click()`);
      await page.waitFor(`document.querySelector('.tree-stage.mode-branches')`, { timeout: 3000 });
      await page.eval(`localStorage.removeItem('learn:treeLayout')`);
    } finally { fs.writeFileSync(tj, orig); }
  });
  await test('UI code change: reload waits while the learner is active, keeps the draft', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    await page.eval(`document.querySelector('#askBox').focus()`); await page.type('half-typed');
    const css = path.join(CODE, 'web', 'tree.css');
    fs.appendFileSync(css, '\n');
    await page.waitFor(`!document.querySelector('#reloadBtn').hidden`, { timeout: 4000 });
    fs.writeFileSync(css, fs.readFileSync(css, 'utf8').replace(/\n$/, ''));
    assert(await page.eval(`document.querySelector('#askBox').value === 'half-typed'`), 'page reloaded under the learner');
    await page.click('#reloadBtn');
    await page.waitFor(`document.querySelector('#askBox')?.value === 'half-typed' && document.querySelector('#reloadBtn').hidden`, { timeout: 4000 });
    await page.eval(`document.querySelector('#askBox').value = ''; localStorage['learn:draft:ask:demo'] = '""'`);
  });
  await test("I'm away: starts background jobs, shows the running job, then the report", async () => {
    await page.nav(`${BASE}/#/demo/learn`, 900);
    await page.click('#awayBtn');
    await page.waitFor(`document.querySelectorAll('.away-job').length === 4`, { timeout: 3000 });
    await page.shot('away-popover');
    await page.eval(`localStorage['learn:awayJobs'] = '["wiki"]'`);
    await page.click('#awayBtn'); await page.click('#awayBtn');
    await page.waitFor(`document.querySelectorAll('.away-job input:checked').length === 1`, { timeout: 3000 });
    await page.eval(`[...document.querySelectorAll('.away-pop .btn-primary')].pop().click()`);
    await until(() => { try { return fs.readdirSync(path.join(HOME, 'reports')).some(f => f.endsWith('-wiki.md')); } catch { return false; } }, 'report written', 20000);
    const rep = fs.readFileSync(path.join(HOME, 'reports', fs.readdirSync(path.join(HOME, 'reports'))[0]), 'utf8');
    assert(/# Fake wiki report/.test(rep), rep);
    await page.waitFor(`document.querySelector('#awayBtn .badge-n') || document.querySelector('.away-rep.new')`, { timeout: 6000 });
    await page.eval(`document.querySelector('.away-rep.new')?.click() || (document.querySelector('#awayBtn').click(), 0)`);
    await page.waitFor(`document.querySelector('.away-rep.new')?.click() ?? true`, { timeout: 2000 }).catch(() => {});
    await page.waitFor(`/Fake wiki report/.test(document.querySelector('#dock')?.innerText || '')`, { timeout: 4000 });
    await page.key('Escape');
    const st = await api('/api/jobs');
    assert(!st.running && st.history[0].name === 'wiki' && st.history[0].exit === 0, JSON.stringify(st.history[0]));
    const fake = sessions().filter(x => x.args[0] === '-p');
    assert(!fake.length, 'headless job was logged as a tutor session');
  });
  await test('new topic from the browser: START queued, topic-switch handoff, fresh tutor answers', async () => {
    const before = sessions().length;
    await page.nav(`${BASE}/#/new`, 900);
    await page.waitFor(`document.activeElement?.id === 'ntGoal'`, { timeout: 3000 });
    await page.type('How the immune system recognises viruses');
    await page.eval(`document.querySelector('#ntKnow').value = 'high-school biology'`);
    await page.shot('new-topic');
    await page.key('Enter', { meta: true });
    await page.waitFor(`location.hash.includes('/learn') && document.querySelector('.msg.kind-start')`, { timeout: 4000 });
    const slug = await page.eval(`location.hash.split('/')[1]`);
    assert(/^immune-system/.test(slug), slug);
    const meta = JSON.parse(fs.readFileSync(path.join(HOME, 'topics', slug, 'topic.json'), 'utf8'));
    assert(meta.goal.includes('immune') && Array.isArray(meta.skills), JSON.stringify(meta));
    assert(/^.+: ok/m.test(learn('check', slug)), 'scaffold passes check');
    // the demo-topic tutor sees a TOPIC SWITCH and hands off; a fresh session for the new topic replies
    await until(() => sessions().length > before, 'fresh session', 25000);
    const j = () => fs.readdirSync(path.join(HOME, 'topics', slug, 'journal')).flatMap(f => fs.readFileSync(path.join(HOME, 'topics', slug, 'journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    await until(() => j().some(e => e.role === 'tutor' && /Echo \(start\)/.test(e.text || '')), 'tutor replied in the new topic', 25000);
    const sess = JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8'));
    assert(sess.topic === slug && sess.kind === 'handoff', JSON.stringify(sess));
    assert(await page.eval(`[...document.querySelectorAll('#topicSel option')].some(o => o.value === '__new')`), 'new-topic option in the selector');
    await page.waitFor(`/Echo .start./.test(document.querySelector('.thread').innerText)`, { timeout: 5000 });
    await page.shot('new-topic-started');
    // switching topic while staying on the learn view redraws the thread
    await page.eval(`location.hash = '#/demo/learn'`);
    await page.waitFor(`!document.querySelector('.msg.kind-start') && document.querySelectorAll('.thread .msg').length > 5`, { timeout: 3000 });
  });
  await test('light theme', async () => {
    await page.eval(`localStorage['learn:theme'] = '"light"'`);
    await page.nav(`${BASE}/?t=light#/demo/learn`, 1200);
    assert(await page.eval(`document.documentElement.dataset.theme === 'light'`), 'theme');
    await page.shot('learn-light');
    await page.eval(`localStorage['learn:theme'] = '"auto"'`);
  });
  await test('narrow window (1100px) keeps the layout', async () => {
    await page.size(1100, 800);
    await page.nav(`${BASE}/#/demo/learn`, 1200);
    const overflow = await page.eval(`document.documentElement.scrollWidth > window.innerWidth + 1`);
    assert(!overflow, 'horizontal overflow');
    await page.shot('learn-narrow');
    await page.size(1400, 900);
  });

  if (opt.real) {
    console.log('\nReal topics (read-only copy)');
    const realHome = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-real-'));
    fs.cpSync(path.join(CODE, 'data', 'topics'), path.join(realHome, 'topics'), { recursive: true });
    const rport = String(Number(PORT) + 200);
    const srv = spawn(process.execPath, [BIN, 'serve'], { env: { ...ENV, LEARN_HOME: realHome, LEARN_PORT: rport }, stdio: 'ignore' });
    await until(() => fetch(`http://localhost:${rport}/api/ping`).then(r => r.ok).catch(() => false), 'real server');
    for (const t of await (await fetch(`http://localhost:${rport}/api/topics`)).json()) {
      await test(`real topic ${t.slug}: every message renders cleanly`, async () => {
        await page.nav(`http://localhost:${rport}/?static#/${t.slug}/learn`, 1500);
        await page.eval(`(async () => { for (let i = 0; i < 50 && document.querySelector('.earlier button'); i++) { document.querySelector('.earlier button').click(); await new Promise(r => setTimeout(r, 50)); } })()`);
        const r = await page.eval(`(() => { const t = document.querySelector('.thread')?.innerText || '';
          return { n: document.querySelectorAll('.thread .msg').length, leftovers: (t.match(/\\]\\((msg|term|skill|map|wiki|tip|media):|^:::|\\{\\{/gm) || []).slice(0, 5),
            vizErr: document.querySelectorAll('.thread .viz-error').length, mathErr: document.querySelectorAll('.thread .math-error').length }; })()`);
        assert(!r.leftovers.length && !r.vizErr && !r.mathErr, JSON.stringify(r));
      });
    }
    srv.kill(); fs.rmSync(realHome, { recursive: true, force: true });
  }
}

async function finish(code) {
  try { await page?.close(); } catch {}
  if (launcher && launcher.exitCode == null) {
    launcher.kill('SIGTERM');
    await Promise.race([new Promise(r => launcher.once('exit', r)), sleep(4000)]);
  }
  // belt and braces: anything still holding the port
  try { execFileSync('sh', ['-c', `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
  if (!opt.keep) fs.rmSync(HOME, { recursive: true, force: true }); else console.log('kept ' + HOME);
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `, ${bad.length} failed` : ''} · screenshots in test/out/`);
  process.exit(code ?? (bad.length ? 1 : 0));
}
process.on('SIGINT', () => finish(130));
main().then(() => finish()).catch(async e => { console.error(e); await finish(1); });
