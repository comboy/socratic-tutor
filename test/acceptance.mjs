#!/usr/bin/env node
// Acceptance tests: the whole system on a throwaway copy of test/fixture/topics.
//
//   bin/learn test [--headed] [--keep] [--real] [--only <substring>]
//
// Starts the real launcher (bin/learn start) with the fake tutor in place of claude, on its own
// port and data directory, then drives the UI in headless Chrome. Never touches topics/ or a
// running tutor. Screenshots land in test/out/ (gitignored) for a quick look.
//   --real   also smoke-test rendering of every message in your real topics (read-only copy)
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { launch, chromePath, reapOrphans } from './lib/chrome.mjs';

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
// config.json of the test home. redeliverSeconds: a message the fake tutor leaves unanswered
// (FAKE-NOREPLY) would be handed to it again two minutes later, in the middle of some other test;
// the tests of that net set their own values.
const BASE_CONFIG = { redeliverSeconds: 100000 };
const setConfig = (patch = {}) => fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({ ...BASE_CONFIG, ...patch }));
setConfig();
const PORT = String(4800 + Math.floor(Math.random() * 150));
const BASE = `http://localhost:${PORT}`;
// (LEARN_HOST: a server started with --host hands it to everything it starts, a background job
// running the tests included; the tests' own server is on loopback)
delete process.env.LEARN_HOST;
const ENV = { ...process.env, LEARN_HOME: HOME, LEARN_NO_GIT: '1', LEARN_PORT: PORT, LEARN_CLAUDE: path.join(CODE, 'test', 'fake-tutor.mjs'),
  CLAUDE_CONFIG_DIR: path.join(HOME, 'claude'), LEARN_HANDOFF_TOKENS: '150000', FAKE_TOKENS_PER_TURN: '30000' };
// stderr is captured (it is in the error when the command fails): a refusal a test expects must not read as a failure
const learn = (...a) => execFileSync(process.execPath, [BIN, ...a], { env: ENV, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
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
  const reaped = reapOrphans();
  if (reaped) console.log(`(stopped ${reaped} headless Chrome(s) left behind by an earlier, killed test run)`);
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
    // -i is accepted (case-insensitive is the default), never searched for; unknown flags are refused
    const grep = (...a) => spawnSync(process.execPath, [BIN, 'grep', ...a], { env: ENV, encoding: 'utf8' });
    assert(grep('-i', 'SOFTMAX', '--topic', 'demo').stdout === grep('softmax', '--topic', 'demo').stdout, 'grep -i');
    assert(!grep('--case', 'SOFTMAX', '--topic', 'demo').stdout.trim(), 'grep --case is case-sensitive');
    const bad = grep('-w', 'softmax');
    assert(bad.status === 1 && /unknown option -w/.test(bad.stderr) && !bad.stdout, 'unknown flag: ' + bad.stderr + bad.stdout);
    assert(/one pattern, got 2/.test(grep('soft', 'max').stderr), 'two patterns');
  });
  await test('bin/learn check passes on the fixture topics', async () => {
    const out = learn('check');
    assert(/demo: ok/.test(out) && /cells: ok/.test(out), out);
  });
  await test('bin/learn hook reminds only the tutor session', async () => {
    const id = JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8')).id;
    const yes = execFileSync(process.execPath, [BIN, 'hook'], { env: ENV, stdio: 'pipe', input: JSON.stringify({ session_id: id, source: 'compact' }), encoding: 'utf8' });
    const no = execFileSync(process.execPath, [BIN, 'hook'], { env: ENV, stdio: 'pipe', input: JSON.stringify({ session_id: 'other', source: 'compact' }), encoding: 'utf8' });
    assert(/compacted/.test(yes) && no === '', 'hook output wrong');
  });

  await test('the server only answers this machine: a foreign Host, a cross-origin POST and a non-JSON POST are refused; the app\'s own requests work', async () => {
    const req = (method, p, headers, body) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
      r.on('error', reject); if (body) r.write(body); r.end();
    });
    const fb = () => { try { return fs.readFileSync(path.join(HOME, 'feedback.md'), 'utf8'); } catch { return ''; } };
    const before = fb(), host = `localhost:${PORT}`, body = JSON.stringify({ text: 'from another site' });
    assert((await req('GET', '/api/topics', { host: 'rebound.example:' + PORT })).status === 403, 'foreign Host read');
    assert((await req('POST', '/api/feedback', { host, origin: 'https://evil.example', 'content-type': 'application/json' }, body)).status === 403, 'cross-origin POST');
    assert((await req('POST', '/api/feedback', { host, 'content-type': 'text/plain' }, body)).status === 403, 'text/plain POST');
    assert((await req('POST', '/api/feedback', { host }, body)).status === 403, 'POST body without a type');
    assert(fb() === before, 'feedback.md changed');
    assert((await req('GET', '/api/topics', { host: `127.0.0.1:${PORT}` })).status === 200, 'own GET');
    assert((await req('POST', '/api/ping', { host, origin: `http://localhost:${PORT}`, 'content-type': 'application/json' }, '{}')).status !== 403, 'own POST');
  });
  // bin/learn --host: other machines need the access token. Binding a real network address here
  // would ask the learner's firewall, so LEARN_TEST_REMOTE makes every request count as remote.
  await test('reachable from other machines (--host): no token 401, ?token sets a cookie, a cross-origin POST is refused, the CLI uses the token', async () => {
    const rhome = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-remote-'));
    fs.cpSync(path.join(CODE, 'test', 'fixture', 'topics'), path.join(rhome, 'topics'), { recursive: true });
    const rport = String(Number(PORT) + 150), renv = { ...ENV, LEARN_HOME: rhome, LEARN_PORT: rport, LEARN_TEST_REMOTE: '1' };
    const srv = spawn(process.execPath, [BIN, 'serve'], { env: renv, stdio: 'ignore' });
    const req = (method, p, headers = {}, body) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: rport, path: p, method, headers: { host: `tutor.lan:${rport}`, ...headers } }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
      r.on('error', reject); if (body) r.write(body); r.end();
    });
    try {
      await until(() => req('GET', '/api/ping').then(r => r.status === 401).catch(() => false), 'remote server');
      const tokenFile = path.join(rhome, '.access-token');
      const tok = fs.readFileSync(tokenFile, 'utf8').trim();
      assert(tok.length >= 32, 'token: ' + tok);
      assert((fs.statSync(tokenFile).mode & 0o077) === 0, 'token file readable by others');
      assert(/^\.access-token$/m.test(fs.readFileSync(path.join(rhome, '.gitignore'), 'utf8')), 'token not gitignored');
      const no = await req('GET', '/');
      assert(no.status === 401 && /bin\/learn status/.test(no.body) && !no.body.includes(tok), 'no token: ' + no.status + ' ' + no.body);
      assert((await req('GET', '/api/topics')).status === 401, 'API without token');
      assert((await req('GET', '/?token=wrong' + tok.slice(5))).status === 401, 'wrong token in the link');
      assert((await req('GET', '/api/topics', { cookie: `learn-${rport}=nope` })).status === 401, 'wrong cookie');
      assert((await req('GET', '/api/topics', { authorization: 'Bearer nope' })).status === 401, 'wrong bearer');
      const visit = await req('GET', `/?token=${tok}&x=1`);
      const sc = String(visit.headers['set-cookie'] || '');
      assert(visit.status === 302 && visit.headers.location === '/?x=1', 'redirect strips the token: ' + visit.status + ' ' + visit.headers.location);
      assert(/HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && sc.startsWith(`learn-${rport}=`), 'cookie: ' + sc);
      const cookie = sc.split(';')[0];
      const ok = await req('GET', '/api/topics', { cookie });
      assert(ok.status === 200 && JSON.parse(ok.body).length === 2, 'with the cookie: ' + ok.status);
      assert((await req('GET', '/', { cookie })).status === 200, 'page with the cookie');
      // a page visit renews the cookie (400 days from the last visit; an older Strict cookie becomes Lax); an API call doesn't
      assert(String((await req('GET', '/', { cookie, accept: 'text/html,*/*' })).headers['set-cookie'] || '') === sc, 'page visit should renew the cookie');
      assert(!ok.headers['set-cookie'], 'API answer sets a cookie');
      const fb = () => { try { return fs.readFileSync(path.join(rhome, 'feedback.md'), 'utf8'); } catch { return ''; } };
      const body = JSON.stringify({ text: 'remote feedback' }), json = { cookie, 'content-type': 'application/json' };
      assert((await req('POST', '/api/feedback', json, body)).status === 403, 'cookie POST without Origin');
      assert((await req('POST', '/api/feedback', { ...json, origin: 'http://evil.example' }, body)).status === 403, 'cookie POST from another origin');
      assert((await req('POST', '/api/feedback', { cookie, origin: `http://tutor.lan:${rport}`, 'content-type': 'text/plain' }, body)).status === 403, 'text/plain POST');
      assert((await req('POST', '/api/feedback', { 'content-type': 'application/json', origin: `http://tutor.lan:${rport}` }, body)).status === 401, 'POST without token');
      assert(!fb().includes('remote feedback'), 'a refused POST got through');
      assert((await req('POST', '/api/feedback', { ...json, origin: `http://tutor.lan:${rport}` }, body)).status === 200, 'same-origin POST with the cookie');
      assert(fb().includes('remote feedback'), 'feedback not saved');
      // the CLI isn't on loopback either (here: counts as remote): it sends the token, and status prints the link
      const st = execFileSync(process.execPath, [BIN, 'status'], { env: renv, encoding: 'utf8' });
      assert(/server: up/.test(st) && st.includes(`?token=${tok}`) && /SSH tunnel|ssh -L/.test(st), 'status: ' + st);
      const bad = spawnSync(process.execPath, [BIN, 'status', '--host', 'not-an-ip'], { env: renv, encoding: 'utf8' });
      assert(bad.status === 1 && /--host needs an IP/.test(bad.stderr), '--host validation: ' + bad.stderr);
    } finally { srv.kill(); fs.rmSync(rhome, { recursive: true, force: true }); }
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

  await test('live updates keep coming when a file is replaced again and again (atomic writes: a Linux watch loses the file after the first)', async () => {
    const ctl = new AbortController(), seen = [];
    const res = await fetch(BASE + '/api/events', { signal: ctl.signal });
    (async () => { const dec = new TextDecoder(); try { for await (const chunk of res.body) for (const m of dec.decode(chunk).matchAll(/^data: (.*)$/gm)) seen.push(JSON.parse(m[1])); } catch {} })();
    const f = path.join(HOME, 'topics/demo/notes.json'), body = fs.readFileSync(f, 'utf8');
    const count = () => seen.filter(e => e.type === 'topic' && e.topic === 'demo' && e.part === 'notes.json').length;
    try {
      for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(f + '.x.tmp', body + ' '.repeat(i)); fs.renameSync(f + '.x.tmp', f);
        await until(() => count() >= i, `update ${i} of notes.json reached the browser (got ${count()})`, 6000);
        await sleep(300);
      }
    } finally { ctl.abort(); fs.writeFileSync(f, body); }
  });

  console.log('\nTutor commands');
  await test('resume prints the whole startup bundle in one go', async () => {
    const r = learn('resume', 'demo');
    for (const s of ['# Resume: ', 'Learner profile', 'Knowledge across topics', 'Resume here', 'Skill tree', '◀ FOCUS', 'Pending question', 'spaced review', 'suspected holes', 'parked', 'Glossary terms', 'Last ']) assert(r.includes(s), 'missing: ' + s + '\n' + r.slice(0, 600));
    assert(/n1 \[4\.3\] Why the mask/.test(r) && !/Mixed up loss/.test(r), 'open notes only');
    assert(/@linalg/.test(r) && /needs 4\.1,3\.2/.test(r), 'needs and foundations shown');
    assert(/Short gap|day or more|week or more/.test(r), 'gap advice');
  });
  await test('commit -- paths commits only those files (a job and a tutor writing at once); a pathless commit warns while a job runs', async () => {
    const G = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-git-'));
    try {
      const genv = { ...ENV, LEARN_HOME: G, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
      const git = (...a) => execFileSync('git', a, { cwd: G, env: genv, encoding: 'utf8' });
      const commit = (...a) => spawnSync(process.execPath, [BIN, 'commit', ...a], { env: genv, encoding: 'utf8', cwd: G });
      fs.cpSync(path.join(CODE, 'test', 'fixture', 'topics'), path.join(G, 'topics'), { recursive: true });
      git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'init');
      fs.appendFileSync(path.join(G, 'topics/demo/progress.md'), '\ntutor edit\n');           // the tutor's
      fs.mkdirSync(path.join(G, 'topics/demo/terms'), { recursive: true });
      fs.writeFileSync(path.join(G, 'topics/demo/terms/new-page.md'), 'half-written');       // the job's
      const r = commit('wiki: a page', '--', 'topics/demo/terms');
      assert(r.status === 0 && /committed \w+: 1 file\(s\) \(topics\/demo\/terms\/new-page\.md\)/.test(r.stdout), r.stdout + r.stderr);
      assert(git('status', '--porcelain').trim() === 'M topics/demo/progress.md', 'the tutor\'s file was committed: ' + git('status', '--porcelain'));
      assert(/outside the data home/.test(commit('x', '--', '../elsewhere').stderr) && /usage: commit/.test(commit('x', '--').stderr), 'bad paths');
      assert(/nothing to commit in topics\/demo\/terms/.test(commit('again', '--', 'topics/demo/terms').stdout), 'nothing to commit');
      // a job is running (this test process stands in for its runner): a pathless commit warns
      fs.mkdirSync(path.join(G, 'state'), { recursive: true });
      fs.writeFileSync(path.join(G, 'state/jobs.json'), JSON.stringify({ runner: { pid: process.pid }, current: { name: 'wiki' }, queue: [], history: [] }));
      const all = commit('tutor: everything');
      assert(all.status === 0 && /background job "wiki" is running/.test(all.stderr) && !git('status', '--porcelain').replace(/^\?\? state\/\n?/m, '').trim(), all.stderr + git('status', '--porcelain'));
    } finally { fs.rmSync(G, { recursive: true, force: true }); }
  });
  await test('data home as a folder of a bigger repo, through a data/ symlink, learner folder kept outside it (config.json "learner"): no nested repo, a learner/ link, commits only ours, real paths shown', async () => {
    const B = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-repo-')), L = path.join(os.tmpdir(), 'learn-link-' + process.pid), F = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-fresh-'));
    const id = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
    const genv = { ...ENV, ...id, LEARN_HOME: L }; delete genv.LEARN_NO_GIT;
    const git = (...a) => execFileSync('git', a, { cwd: B, env: genv, encoding: 'utf8' });
    const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { env: genv, encoding: 'utf8', cwd: CODE });
    const ensureHome = env => execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(CODE, 'app', 'store.js'))}).ensureHome()`], { env });
    try {
      git('init', '-q');
      fs.cpSync(path.join(CODE, 'test', 'fixture', 'topics'), path.join(B, 'tutor', 'topics'), { recursive: true });
      fs.cpSync(path.join(CODE, 'test', 'fixture', 'learner'), path.join(B, 'learner'), { recursive: true });
      fs.writeFileSync(path.join(B, 'tutor', 'config.json'), JSON.stringify({ learner: '../learner' }));
      fs.writeFileSync(path.join(B, 'other-tool.md'), 'not ours\n');
      fs.symlinkSync(path.join(B, 'tutor'), L);
      ensureHome(genv);
      assert(!fs.existsSync(path.join(B, 'tutor', '.git')), 'a nested repo was created');
      assert(fs.lstatSync(path.join(B, 'tutor', 'learner')).isSymbolicLink() && fs.readFileSync(path.join(L, 'learner', 'profile.md'), 'utf8') === fs.readFileSync(path.join(B, 'learner', 'profile.md'), 'utf8'), 'learner/ link');
      assert(/^\/learner$/m.test(fs.readFileSync(path.join(B, 'tutor', '.gitignore'), 'utf8')), 'link gitignored');
      const c1 = run('commit', 'first');
      assert(c1.status === 0 && /^committed \w+: /.test(c1.stdout), c1.stdout + c1.stderr);
      const tracked = git('ls-files');
      assert(/^tutor\/topics\/demo\/topic\.json$/m.test(tracked) && /^learner\/profile\.md$/m.test(tracked) && !/^tutor\/(learner|state)\b/m.test(tracked), tracked);
      assert(git('status', '--porcelain').trim() === '?? other-tool.md', 'committed what isn\'t ours: ' + git('status', '--porcelain'));
      // the reviewer edits the profile by its usual path and commits just that
      fs.appendFileSync(path.join(L, 'learner', 'profile.md'), '\n- a new observation\n');
      fs.appendFileSync(path.join(L, 'topics', 'demo', 'progress.md'), '\ntutor edit\n');
      const c2 = run('commit', 'review: profile', '--', 'learner/profile.md');
      assert(c2.status === 0 && /1 file\(s\) \(learner\/profile\.md\)/.test(c2.stdout), c2.stdout + c2.stderr);
      assert(/^ M tutor\/topics\/demo\/progress\.md$/m.test(git('status', '--porcelain')), 'the tutor\'s file was committed');
      assert(/1 file\(s\) \(tutor\/topics\/demo\/progress\.md\)/.test(run('commit', 'tutor', '--', path.join(L, 'topics/demo/progress.md')).stdout), 'path through the data/ symlink');
      assert(/outside the data home/.test(run('commit', 'x', '--', path.join(B, 'other-tool.md')).stderr), 'refuses a file of another tool');
      assert(/Learner profile \([^)]*learner\/profile\.md, all topics\)/.test(run('resume', 'demo').stdout), 'resume names the profile');
      assert(new RegExp(`learner: \\S*${path.basename(B)}/learner`).test(run('status').stdout), 'status shows the real learner folder');
      // a fresh data home outside any repo still gets a repo of its own
      ensureHome({ ...genv, LEARN_HOME: F });
      assert(fs.existsSync(path.join(F, '.git')) && fs.existsSync(path.join(F, 'learner', 'profile.md')) && !fs.existsSync(path.join(F, 'config.json')), 'fresh home');
    } finally { for (const d of [B, F]) fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(L, { force: true }); }
  });
  await test('note / focus / summary / term / tree / log commands', async () => {
    assert(/added n5 \(hole, 4\.1\)/.test(learn('note', 'hole', '--topic', 'demo', '--skill', '4.1', 'test hole')), 'note add');
    assert(/closed n5/.test(learn('note', 'done', 'n5', 'fixed', '--topic', 'demo')), 'note done');
    // a foundation is where a cross-topic hole lives: --skill @linalg (or linalg)
    assert(/added n6 \(hole, linalg\)/.test(learn('note', 'hole', '--topic', 'demo', '--skill', '@linalg', 'matrix shapes shaky')), 'note on a foundation');
    assert(/n6 \[@linalg\] matrix shapes shaky/.test(learn('resume', 'demo')) && /@linalg .*\(1 note\)/.test(learn('resume', 'demo')), 'resume shows the foundation note');
    assert(/^demo: ok/m.test(learn('check', 'demo')) && !/unknown skill/.test(learn('check', 'demo')), 'check accepts it');
    assert(/no skill or foundation @nope/.test((() => { try { learn('note', 'hole', '--topic', 'demo', '--skill', '@nope', 'x'); return ''; } catch (e) { return String(e.stderr); } })()), 'unknown foundation refused');
    learn('note', 'done', 'n6', '--topic', 'demo');
    assert(/demo focus: 4\.2/.test(learn('focus', 'demo', '4.2')), 'focus');
    learn('summary', 'demo', '4.2', `- tested ([x](msg:${journal().find(e => e.role === 'tutor' && e.kind === 'message').id}))`);
    const meta = JSON.parse(fs.readFileSync(path.join(HOME, 'topics/demo/topic.json'), 'utf8'));
    assert(meta.focus === '4.2' && /tested/.test(meta.skills.find(s => s.id === '4').children.find(c => c.id === '4.2').summary), 'focus/summary saved');
    learn('term', 'add', 'demo', 'test term', '--short', 'A term added by the test.', '--skill', '4.2', '--full', '**T**est **T**erm', '--aliases', 'tt');
    assert(/full: \*\*T\*\*est/.test(learn('term', 'show', 'demo', 'tt')), 'term show by alias');
    assert(/already in the glossary/.test((() => { try { learn('term', 'add', 'demo', 'TT', '--short', 'x'); return ''; } catch (e) { return String(e.stderr); } })()), 'duplicate term refused');
    const outline = learn('tree', 'demo');
    assert(/^@linalg /m.test(outline) && /^ {2}4\.3 Causal mask <- 4\.1, 3\.2$/m.test(outline), outline);
    const drop = (() => { try { execFileSync(process.execPath, [BIN, 'tree', 'demo', '--set'], { env: ENV, stdio: 'pipe', input: '1 Tokenization\n  1.1 Tokens\n', encoding: 'utf8' }); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/drops skills/.test(drop), 'tree --set refuses to drop skills: ' + drop);
    learn('log', 'demo', 'a test log line');
    assert(/a test log line/.test(fs.readFileSync(path.join(HOME, 'topics/demo/log.md'), 'utf8')), 'log');
    assert(/^demo: ok/m.test(learn('check', 'demo')), 'still valid');
  });
  await test('progress.md naming a closed note: check warns, resume flags it under "Resume here"; a mention that says it is closed is fine', async () => {
    const f = path.join(HOME, 'topics/demo/progress.md'), orig = fs.readFileSync(f, 'utf8');
    try {
      fs.writeFileSync(f, orig + '- Still to do: the residual stream link (n4).\n- n1 is open; n3 closed in .12.\n');
      const out = learn('check', 'demo');
      assert(/progress\.md: line \d+ mentions n4, closed/.test(out) && !/mentions n[13]\b/.test(out), out);
      const r = learn('resume', 'demo');
      assert(/Possibly stale[^\n]*\n  n4 closed/.test(r) && !/^  n[13] closed/m.test(r), r.slice(0, 2000));
    } finally { fs.writeFileSync(f, orig); }
    assert(!/Possibly stale/.test(learn('resume', 'demo')), 'clean progress.md: no warning');
  });
  await test('share check finds personal traces in a code repo (topic titles, home path, data files in history); share export makes a fresh one-commit repo', async () => {
    const R = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-share-')), X = path.join(os.tmpdir(), 'learn-share-x-' + process.pid);
    const g = (...a) => execFileSync('git', a, { cwd: R, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const run = (...a) => spawnSync(process.execPath, [BIN, 'share', ...a], { env: ENV, encoding: 'utf8' });
    try {
      g('init', '-q'); g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 'Test Person');
      fs.writeFileSync(path.join(R, 'clean.md'), 'Nothing here.\n'); g('add', '-A'); g('commit', '-qm', 'init');
      const ok = run('check', '--dir', R);
      assert(ok.status === 0 && /nothing personal found/.test(ok.stdout), ok.stdout + ok.stderr);
      fs.mkdirSync(path.join(R, 'topics')); fs.writeFileSync(path.join(R, 'topics/x.md'), 'x'); g('add', '-A'); g('commit', '-qm', 'Session 2: lesson'); g('rm', '-rq', 'topics'); g('commit', '-qm', 'move data out');
      fs.writeFileSync(path.join(R, 'leak.md'), `My topic: How LLMs work (demo), notes in ${os.homedir()}/x\n`); g('add', '-A'); g('commit', '-qm', 'leak');
      const bad = run('check', '--history', '--dir', R);
      assert(bad.status === 1 && /your topic[\s\S]*leak\.md:1  \[How LLMs work \(demo\)\]/.test(bad.stdout) && /home path[\s\S]*leak\.md:1/.test(bad.stdout)
        && /lesson commit[\s\S]*Session 2/.test(bad.stdout) && /author email[\s\S]*t@example\.invalid/.test(bad.stdout) && /data files in history[\s\S]*topics\/x\.md/.test(bad.stdout) && /share export/.test(bad.stdout), bad.stdout);
      const ex = run('export', X);
      assert(ex.status === 0 && fs.existsSync(path.join(X, 'bin/learn')) && fs.existsSync(path.join(X, 'AGENTS.md')) && !fs.existsSync(path.join(X, 'data')), ex.stdout + ex.stderr);
      assert(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: X, encoding: 'utf8' }).trim() === '1', 'one commit');
      assert(/not empty/.test(run('export', X).stderr), 'refuses a non-empty dir');
    } finally { fs.rmSync(R, { recursive: true, force: true }); fs.rmSync(X, { recursive: true, force: true }); }
  });
  await test('knowledge pill: where they stand, short, for a reader who knows the subject: skills grouped by level, foundations, recent corrections, about them (background, how they learn; not app-specific sections); no process, no subject, no ids; --write / --all', async () => {
    const t = learn('pill', 'demo');
    assert(/^# What I understand: How LLMs work \(demo\)/.test(t) && /^\*\*(Can [^*]+|Heard of it) \(\d\):\*\* \S/m.test(t) && /^\*\*Not yet:\*\* /m.test(t) && /\*\*About them:\*\*/.test(t), t.slice(0, 1500));
    assert(/A fictional learner used by the tests/.test(t) && /Their tutors noticed: Explanation first, then one question/.test(t) && !/Dark theme/.test(t), 'about them: ' + t.slice(-800));
    assert(t.length < 4000 && !/^\s*- [✓◐✗]|Covered:|Difficulty:|Not covered yet|^## /m.test(t) && !/\*\*\d+\.\d+ /.test(t), 'process or per-skill detail left: ' + t.slice(0, 2500));
    assert(!/\b[Yy]ou\b/.test(t.split('\n').filter(l => !l.startsWith('>')).join('\n')), 'second person: ' + t);
    assert(!/\]\((msg|skill|term|wiki):|\b20\d\d-\d\d-\d\d\.\d+\b/.test(t), 'workspace links or message ids left: ' + (t.match(/.*(\]\((msg|skill|term|wiki):|\b20\d\d-\d\d-\d\d\.\d+\b).*/) || [])[0]);
    assert(/wrote \S*learner\/pills\/demo\.md/.test(learn('pill', 'demo', '--write')) && fs.readFileSync(path.join(HOME, 'learner/pills/demo.md'), 'utf8') === t, 'written');
    assert(/pills\/cells\.md/.test(learn('pill', '--all')), '--all');
    const P = (await api('/api/pill/demo')).text;
    assert(P.split('\n')[0] === t.split('\n')[0], 'api');
  });
  await test('new, import, terms, doctor: a topic made in the terminal, an old terminal session imported as dated journal entries, the glossary names, the setup checks', async () => {
    const H = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-cli-')), env = { ...ENV, LEARN_HOME: H };
    const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8' });
    try {
      assert(run('new', 'Bad_Slug').status === 1, 'a bad slug is refused');
      assert(/^created .*topics\/tides/.test(run('new', 'tides', 'Tides and the moon').stdout), 'new');
      assert(JSON.parse(fs.readFileSync(path.join(H, 'topics/tides/topic.json'), 'utf8')).title === 'Tides and the moon', 'title');
      const again = run('new', 'tides', 'Again');
      assert(again.status === 1 && /exists/.test(again.stderr), 'an existing topic is not overwritten: ' + again.stderr);
      // a Claude Code transcript: consecutive turns of one side join, tool calls, harness lines and torn lines are left out
      const L = (type, ts, content, extra = {}) => JSON.stringify({ type, timestamp: ts, message: { content }, ...extra });
      fs.writeFileSync(path.join(H, 'old.jsonl'), [
        L('user', '2026-01-05T12:00:00.000Z', 'teach me about tides'),
        L('assistant', '2026-01-05T12:00:05.000Z', [{ type: 'text', text: 'Two bulges.' }, { type: 'tool_use', name: 'x' }]),
        L('assistant', '2026-01-05T12:00:06.000Z', [{ type: 'text', text: 'Why two?' }]),
        L('user', '2026-01-05T12:00:07.000Z', 'hidden', { isMeta: true }),
        L('user', '2026-01-05T12:00:08.000Z', '<system-reminder>x</system-reminder>'),
        'not json',
        L('user', '2026-01-07T12:00:00.000Z', 'inertia'),
      ].join('\n'));
      assert(run('import').status === 1, 'import without arguments is a usage error');
      const imp = run('import', path.join(H, 'old.jsonl'), '--topic', 'tides');
      assert(/^imported 4 entries into tides \(2026-01-05, 2026-01-07\)/.test(imp.stdout), imp.stdout + imp.stderr);
      const day = d => fs.readFileSync(path.join(H, 'topics/tides/journal', d + '.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const d1 = day('2026-01-05'), d2 = day('2026-01-07');
      assert(d1.length === 3 && d1[0].kind === 'session' && /old\.jsonl/.test(d1[0].text) && d1[1].role === 'user' && d1[1].imported && d1[2].role === 'tutor' && d1[2].text === 'Two bulges.\n\nWhy two?', JSON.stringify(d1));
      assert(d2.length === 1 && d2[0].id === '2026-01-07.1' && d2[0].text === 'inertia' && d2[0].ts === '2026-01-07T12:00:00.000Z', JSON.stringify(d2));
      // imported turns are history: no open question, nothing waiting for a tutor
      assert(/no pending question/.test(run('pending', 'tides').stdout), 'pending after import');
      run('term', 'add', 'tides', 'spring tide', '--short', 'The larger tide at new and full moon.');
      run('term', 'add', 'tides', 'neap tide', '--short', 'The smaller tide at the half moons.');
      assert(run('terms', 'tides').stdout.trim() === 'spring tide, neap tide', 'terms: ' + run('terms', 'tides').stdout);
      // doctor with the fake tutor: the agent checks are skipped, Node and git must pass
      const doc = run('doctor');
      assert(doc.status === 0 && /✓ Node 22\+/.test(doc.stdout) && /✓ git/.test(doc.stdout) && /Chrome \(tests only\)/.test(doc.stdout) && /All set/.test(doc.stdout), doc.stdout + doc.stderr);
    } finally { fs.rmSync(H, { recursive: true, force: true }); }
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

  // The learner, on another machine, was asked for the token again in a new tab of a browser that
  // already had it: the cookie was SameSite=Strict, which a tab opened from a link on another page
  // doesn't send.
  await test('from another machine, in a browser: the token link once; a second tab, a link from another page and the link itself on another page do not ask again; a changed token asks once', async () => {
    const rhome = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-remote-'));
    fs.cpSync(path.join(CODE, 'test', 'fixture', 'topics'), path.join(rhome, 'topics'), { recursive: true });
    const rport = String(Number(PORT) + 151), RB = `http://localhost:${rport}`;
    const srv = spawn(process.execPath, [BIN, 'serve'], { env: { ...ENV, LEARN_HOME: rhome, LEARN_PORT: rport, LEARN_TEST_REMOTE: '1' }, stdio: 'ignore' });
    const tokenFile = path.join(rhome, '.access-token');
    const inApp = `/· learn$/.test(document.title) && !!document.querySelector('.thread .msg')`;
    const asked = `/bin\\/learn status/.test(document.body.innerText)`;
    const elsewhere = href => 'data:text/html,' + encodeURIComponent(`<title>elsewhere</title><a id="go" href="${href}">the tutor</a>`);
    let tabs = [];
    try {
      await until(() => fetch(RB + '/api/ping').then(r => r.status === 401).catch(() => false), 'remote server');
      const tok = fs.readFileSync(tokenFile, 'utf8').trim();
      await page.nav(RB + '/#/demo/learn', 600);
      assert(await page.eval(asked), 'a browser without the token got in');
      await page.nav(`${RB}/?token=${tok}#/demo/learn`, 600);
      await page.waitFor(inApp);
      assert(!(await page.eval('location.href')).includes('token'), 'token left in the address bar: ' + await page.eval('location.href'));
      // a second tab of the same browser
      tabs = await page.openTabs(RB + '/#/demo/learn', 1);
      const second = await until(async () => (await page.tabs()).find(t => t.id === tabs[0] && t.title && !/^about:/.test(t.url) && t.title !== 'about:blank'), 'second tab');
      await sleep(600);
      const title = (await page.tabs()).find(t => t.id === tabs[0]).title;
      assert(/· learn$/.test(title), `second tab asked for the token (title "${title}", was "${second.title}")`);
      // a tab that gets here from a link on another page
      await page.nav(elsewhere(RB + '/#/demo/learn'), 300);
      await page.click('#go', 600);
      await page.waitFor(inApp).catch(async () => { throw new Error('a link from another page asked for the token: ' + await page.eval('document.body.innerText.slice(0, 80)')); });
      // everything the page does from there: live updates (EventSource), a read, a change
      assert(await page.eval(`new Promise(r => { const e = new EventSource('/api/events'); e.onmessage = () => { e.close(); r(true); }; e.onerror = () => { e.close(); r(false); }; })`), 'live updates refused');
      assert(await page.eval(`fetch('/api/topics').then(r => r.status)`) === 200, 'read refused');
      assert(await page.eval(`fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'from the other machine' }) }).then(r => r.status)`) === 200, 'change refused');
      // the token link itself, followed from another page, in a browser that has no cookie yet
      // (127.0.0.1 is another host than localhost, so the cookie above isn't its)
      await page.nav(elsewhere(`http://127.0.0.1:${rport}/?token=${tok}#/demo/learn`), 300);
      await page.click('#go', 600);
      await page.waitFor(inApp).catch(async () => { throw new Error('the token link on another page did not let in: ' + await page.eval('document.body.innerText.slice(0, 80)')); });
      // the token changed on the server: asked once (no redirect loop), and the new link works
      fs.writeFileSync(tokenFile, 'another-token-for-the-acceptance-test\n');
      await page.nav(RB + '/#/demo/learn', 600);
      assert(await page.eval(asked), 'old cookie still lets in after the token changed');
      await page.nav(`${RB}/?token=another-token-for-the-acceptance-test#/demo/learn`, 600);
      await page.waitFor(inApp);
      await page.nav(RB + '/#/demo/tree', 600);
      await page.waitFor(`/· learn$/.test(document.title)`);
    } finally { await page.closeTabs(tabs); srv.kill(); fs.rmSync(rhome, { recursive: true, force: true }); await page.nav('about:blank', 100); page.errors.length = 0; }
  });

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
  await test('ask mode with ⌘↵ keeps working after a redraw; a new question brings the box back to answering', async () => {
    await page.click('#composer .mode-ask');
    await page.waitFor(`document.querySelector('#askBox') && document.querySelector('.box.box-ask') && !document.querySelector('#answerBox')`, { timeout: 2000 });
    // a question is open, but Ask mode doesn't show it above the input (only Answer does)
    assert(await page.eval(`!!document.querySelector('#composer .goq') && !document.querySelector('#composer .box-q') && !document.querySelector('#composer .hideq')`), 'Ask mode shows the open question');
    await page.click('#askBox');
    await page.type('side question');
    await page.key('Enter', { meta: true });
    await sleep(200);
    assert(await page.eval(`localStorage['learn:draft:ask:demo'] === '""' && ![...document.querySelectorAll('#composer textarea')].some(t => t.value)`), 'ask box not cleared');
    await page.waitFor(`[...document.querySelectorAll('.thread .msg')].some(m => m.innerText.includes('Echo (ask): side question'))`);
    // the reply carried a new question and the ask draft is empty: the box is back on Answer
    await page.waitFor(`document.querySelector('#answerBox') && document.querySelector('.box.box-answer') && document.querySelector('#composer .box-q')`, { timeout: 3000 });
  });
  await test('the input hides in the corner for reading: Esc or the chevron; a, q or the corner buttons bring it back; drafts kept', async () => {
    const h0 = await page.eval(`document.querySelector('#threadScroll').clientHeight`);
    await page.click('#answerBox'); await page.type('kept draft');
    await page.key('Escape');
    await page.waitFor(`document.querySelector('.composer.collapsed .corner-answer') && !document.querySelector('#answerBox')`, { timeout: 2000 });
    const h1 = await page.eval(`document.querySelector('#threadScroll').clientHeight`);
    assert(h1 > h0 + 120, `the conversation did not get the space: ${h0} → ${h1}`);
    const corner = await page.eval(`(() => { const r = document.querySelector('.corner-btns').getBoundingClientRect(), c = document.querySelector('#center').getBoundingClientRect(); return { right: c.right - r.right, bottom: c.bottom - r.bottom, w: r.width }; })()`);
    assert(corner.right < 40 && corner.bottom < 40 && corner.w < 320, 'corner buttons not in the corner: ' + JSON.stringify(corner));
    assert(await page.eval(`!!document.querySelector('.corner-answer .corner-dot')`), 'the corner button does not say a question is waiting');
    await page.shot('composer-hidden');
    await page.nav(`${BASE}/#/demo/learn`, 900);
    assert(await page.eval(`!!document.querySelector('.composer.collapsed')`), 'hidden state not remembered');
    await page.key('q');
    await page.waitFor(`document.activeElement?.id === 'askBox'`, { timeout: 2000 });
    await page.click('#hideComposer');
    await page.waitFor(`document.querySelector('.composer.collapsed')`, { timeout: 2000 });
    await page.click('.corner-answer');
    await page.waitFor(`document.activeElement?.id === 'answerBox' && document.querySelector('#answerBox').value === 'kept draft'`, { timeout: 2000 });
    await page.eval(`document.querySelector('#answerBox').value = ''; localStorage['learn:draft:answer:demo'] = '""'`);
    await page.nav(`${BASE}/#/demo/learn`, 900);
  });
  await test('"Tell the tutor now" in the feedback box: journaled as meta, delivered as META, added to feedback.md; the --meta reply is dimmed; kept out of msgs, grep, resume', async () => {
    const pendBefore = learn('pending', 'demo').split('\n')[0];
    assert(await page.eval(`!document.querySelector('#metaBtn')`), 'the input box should no longer have its own "About the app" button');
    await page.nav(`${BASE}/#/demo/tell/app`, 900);
    await page.waitFor(`document.activeElement?.id === 'feedbackBox'`, { timeout: 2000 });
    await page.click('#feedbackLive');
    await page.waitFor(`/Send to the tutor/.test(document.querySelector('#feedbackSave').textContent)`, { timeout: 2000 });
    await page.click('#feedbackBox');
    await page.type('The hover cards could open faster (meta test)');
    await page.key('Enter', { meta: true });
    await page.waitFor(`location.hash === '#/demo/learn'`, { timeout: 3000 });   // the reply comes in the conversation: taken there
    assert(await page.eval(`localStorage['learn:draft:feedback'] === '""'`), 'feedback draft not cleared');
    await page.eval(`localStorage['learn:feedbackLive'] = 'false'`);
    const sent = await until(() => journal().find(e => e.kind === 'meta' && /meta test/.test(e.text)), 'meta entry');
    assert(sent.role === 'user' && sent.meta === true, JSON.stringify(sent));
    const fb = fs.readFileSync(path.join(HOME, 'feedback.md'), 'utf8');
    assert(new RegExp(`^- \\[ \\] \\d{4}-\\d{2}-\\d{2} \\(learner, demo · about the app · msg ${sent.id.replace('.', '\\.')}\\): The hover cards could open faster \\(meta test\\)$`, 'm').test(fb), fb.slice(-300));
    // the fake tutor answers with post --meta only what `wait` labelled META
    const reply = await until(() => journal().find(e => e.role === 'tutor' && e.kind === 'message' && /^Echo \(meta\): The hover cards/.test(e.text)), 'meta reply');
    assert(reply.meta === true && !reply.question && reply.replyTo === sent.id && reply.text === 'Echo (meta): The hover cards could open faster (meta test)', JSON.stringify(reply));
    const seen = fakeLog().find(l => l.event === 'replied' && l.id === sent.id);
    assert(seen?.meta && /about the app, not the lesson: reply with `post --meta`/.test(seen.head), 'wait did not label it META: ' + JSON.stringify(seen));
    await page.waitFor(`document.querySelector('[id="m-${reply.id}"].msg-meta:not(.folded) .msg-body') && document.querySelector('[id="m-${sent.id}"].msg-meta .meta-tag')`);
    await page.shot('about-the-app');
    assert(learn('pending', 'demo').split('\n')[0] === pendBefore, 'the meta reply changed the pending question');
    assert(!/Echo \(meta\)/.test(learn('msgs', 'demo')) && /\(app talk\) Echo \(meta\)/.test(learn('msgs', 'demo', '--all')), 'msgs');
    assert(!learn('grep', 'open faster', '--topic', 'demo').trim() && learn('grep', 'open faster', '--topic', 'demo', '--all').trim(), 'grep');
    const r = learn('resume', 'demo');
    assert(!/meta test|Echo \(meta\)/.test(r) && /\(\+ 2 app-talk entries since /.test(r), r.slice(r.indexOf('## Last')));
    const bad = (() => { try { execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--meta', '--skill', '4.1'], { env: ENV, stdio: 'pipe', input: 'x', encoding: 'utf8' }); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/--meta is a reply about the app/.test(bad), 'post --meta --skill accepted: ' + bad);
  });
  await test('two threads (experiment): the tutor opens a second thread; sending in one takes you to the other, where the reply waits; post needs --track; latency; back to one thread', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 900);
    // on by default, so the bar is there before the second thread is: it says so and offers to open it
    assert(await page.eval(`(() => { const b = document.querySelector('#tracksBar'); return !b.hidden && b.classList.contains('tracks-closed') && !b.querySelector('.track-tab') && /One thread for now/.test(b.textContent) && !document.querySelector('#composer #twoThreadsBtn'); })()`), 'one thread: the bar should show, closed, with the button in it');
    await page.shot('two-threads-closed');
    await page.click('#tracksBar #twoThreadsBtn');
    await page.waitFor(`!document.querySelector('#tracksBar').hidden && document.querySelectorAll('.track-tab').length === 2`, { timeout: 8000 });
    await page.waitFor(`document.querySelector('.track-tab.st-ready:not(.on)')`, { timeout: 8000 });   // B's question waits
    const j0 = journal();
    const bq = j0.filter(e => e.track === 'b' && e.question).pop();
    assert(bq && j0.some(e => e.kind === 'tracks' && e.open), 'thread b opened: ' + JSON.stringify(j0.slice(-3)));
    // a lesson post must name its thread now
    const bad = spawnSync(process.execPath, [BIN, 'post', '--topic', 'demo'], { env: ENV, input: 'x', encoding: 'utf8' });
    assert(bad.status === 1 && /two threads are open/.test(bad.stderr), 'post without --track: ' + bad.stderr);
    assert(/thread a/.test(learn('pending', 'demo')) && /Fake thread-b question/.test(learn('pending', 'demo')), learn('pending', 'demo'));
    assert(/Two threads are open/.test(learn('resume', 'demo')), 'resume');
    // answer in A (the tutor is slow); the UI moves to B, where the question waits
    await page.click('#answerBox'); await page.type('answer in A FAKE-DELAY-2500');
    await page.key('Enter', { meta: true });
    await page.waitFor(`document.querySelector('.track-tab.on .track-letter')?.textContent === 'B'`, { timeout: 3000 });
    await page.waitFor(`/Fake thread-b question/.test(document.querySelector('.box-q')?.innerText || '') && !/answer in A/.test(document.querySelector('#thread').innerText)`, { timeout: 3000 });
    assert(/the tutor writes that reply/.test(await page.eval(`document.querySelector('.track-note')?.textContent || ''`)), 'no note about the switch');
    await page.shot('two-threads');
    const sentA = journal().find(e => e.role === 'user' && /answer in A/.test(e.text));
    assert(sentA.track === 'a' && sentA.replyTo, JSON.stringify(sentA));
    // A's reply arrives while the learner reads B: A's tab says so, B stays on screen
    await page.waitFor(`document.querySelector('.track-tab.st-ready:not(.on) .track-letter')?.textContent === 'A'`, { timeout: 8000 });
    const replyA = journal().find(e => e.role === 'tutor' && /Echo \(answer\): answer in A/.test(e.text));
    assert(replyA.track === 'a' && replyA.replyTo === sentA.id, JSON.stringify(replyA));
    assert(fakeLog().find(l => l.event === 'replied' && l.id === sentA.id)?.head.includes('track=a'), 'wait did not print track=a');
    assert(journal().find(e => e.kind === 'grade' && e.target === sentA.id)?.track === 'a', 'grade not in thread a');
    // answer in B: back to A, at its reply
    await page.click('#answerBox'); await page.type('answer in B');
    await page.key('Enter', { meta: true });
    await page.waitFor(`document.querySelector('.track-tab.on .track-letter')?.textContent === 'A' && document.querySelector('#thread').innerText.includes('Echo (answer): answer in A')`, { timeout: 3000 });
    const sentB = await until(() => journal().find(e => e.role === 'user' && e.text === 'answer in B'), 'B answer');
    assert(sentB.track === 'b' && sentB.replyTo === bq.id, JSON.stringify(sentB));
    await until(() => journal().find(e => e.role === 'tutor' && e.track === 'b' && /answer in B/.test(e.text)), 'B reply');
    assert(/two threads: \d+ replies/.test(learn('latency', 'demo')), learn('latency', 'demo'));
    // a thread with nothing for the learner says so (tab and thread), and sending in the other doesn't take them there
    await page.waitFor(`document.querySelector('.track-tab.st-ready:not(.on) .track-letter')?.textContent === 'B'`, { timeout: 8000 });
    // "Stay here": sending doesn't take the learner to the other thread, though it has something ready
    await page.click('#trackStay');
    assert(await page.eval(`document.querySelector('#trackStay').classList.contains('on')`), 'pin not on');
    await page.click('#answerBox'); await page.type('closing A FAKE-NOREPLY');
    await page.key('Enter', { meta: true });
    await sleep(700);
    assert(await page.eval(`document.querySelector('.track-tab.on .track-letter')?.textContent`) === 'A', 'pinned, but taken to the other thread');
    await page.click('#trackStay');
    assert(!await page.eval(`document.querySelector('#trackStay').classList.contains('on')`), 'pin not off');
    await page.click('.track-tab:not(.on)');
    await page.waitFor(`document.querySelector('.track-tab.on .track-letter')?.textContent === 'B'`, { timeout: 3000 });
    await page.waitFor(`(() => { const a = document.querySelector('.track-tab:not(.on)'); return a.classList.contains('st-idle') && /nothing waiting/.test(a.textContent); })()`, { timeout: 15000 });
    assert(!await page.eval(`!!document.querySelector('.thread-idle')`), 'thread B has a question: no idle note there');
    await page.click('#answerBox'); await page.type('second answer in B FAKE-DELAY-1200');
    await page.key('Enter', { meta: true });
    await sleep(700);
    assert(await page.eval(`document.querySelector('.track-tab.on .track-letter')?.textContent`) === 'B', 'moved to a thread with nothing waiting');
    await until(() => journal().find(e => e.role === 'tutor' && e.track === 'b' && /second answer in B/.test(e.text)), 'second B reply');
    await page.click('.track-tab:not(.on)');
    const idle = await page.waitFor(`document.querySelector('.thread-idle')?.innerText`, { timeout: 8000 });
    assert(/Nothing is waiting for you in thread A/.test(idle) && /Thread B/.test(idle), idle);
    await page.shot('two-threads-idle');
    // back to one thread: the bar goes, B's messages stay, marked
    await page.eval(`[...document.querySelectorAll('#tracksBar button')].find(b => /One thread/.test(b.textContent)).click()`);
    await page.waitFor(`document.querySelector('#tracksBar').hidden && document.querySelector('.track-chip') && /Fake thread-b question/.test(document.querySelector('#thread').innerText)`, { timeout: 8000 });
    assert(!journal().filter(e => e.kind === 'tracks').pop().open, 'closed');
  });
  await test('composer resize handle drags and remembers', async () => {
    const g = await page.eval(`(() => { const b = document.querySelector('.composer-grip').getBoundingClientRect(); return [b.left + b.width / 2, b.top + 4, document.querySelector('.composer').offsetHeight]; })()`);
    await page.drag(g[0], g[1], g[0], g[1] - 120);
    const h = await page.eval(`document.querySelector('.composer').offsetHeight`);
    assert(Math.abs(h - (g[2] + 120)) < 6 && await page.eval(`+localStorage['learn:composerH'] > 0`), `height ${g[2]} → ${h}`);
    await page.eval(`document.querySelector('.composer-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  });
  await test('glossary terms while typing: a list at the word with definitions; Tab inserts, Enter and Esc keep their meaning; nothing for common or finished words; the switch turns it off; "Find term" searches by meaning', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    await page.eval(`localStorage['learn:composerHidden'] = 'false'; localStorage.removeItem('learn:termComplete')`);
    const box = `document.querySelector('#answerBox')`, pop = `document.querySelector('.tc-pop')`;
    const rows = () => page.eval(`[...document.querySelectorAll('.tc-pop .tc-row')].map(r => r.querySelector('.tc-name b').textContent + '|' + r.querySelector('.tc-def').textContent.slice(0, 12))`);
    const clear = async () => { await page.eval(`(() => { const b = ${box}; b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); })()`); await page.click('#answerBox'); };
    // the matching itself, without the page: beginnings of names and aliases, several words, later words
    const sug = await page.eval(`import('/js/complete.js').then(m => { const G = [{ term: 'DNA polymerase', aliases: ['Pol III'], short: 'copies DNA' }, { term: 'token', aliases: ['token ID'], short: 'a chunk' }, { term: 'thylakoid', aliases: [], short: 'a sac' }, { term: 'Golgi apparatus', aliases: ['Golgi'], short: 'sorts' }];
      const f = t => { const r = m.suggest(G, t); return r ? r.items.map(i => i.form).join(',') + '@' + r.from : null; };
      return [f('it uses dna pol'), f('the poly'), f('the'), f('a tok'), f('one token'), f('to'), f('thy'), f('pol i'), f('first line\\nGol'), f('xgol'), m.insertText('token', 'Tok'), m.insertText('DNA polymerase', 'dna')]; })`);
    assert(JSON.stringify(sug) === JSON.stringify(['DNA polymerase@8', 'DNA polymerase@4', null, 'token@2', null, null, 'thylakoid@0', 'Pol III@0', 'Golgi apparatus@11', null, 'Token', 'DNA polymerase']), 'suggest: ' + JSON.stringify(sug));
    // typing a term's beginning opens the list at the word: names with a line of definition
    await clear(); await page.type('The model reads tok');
    await page.waitFor(pop, { timeout: 3000 });
    const r = await rows();
    assert(r[0] === 'token|A chunk of t' && r.some(x => x.startsWith('tokenizer|')), 'rows: ' + JSON.stringify(r));
    const at = await page.eval(`(() => { const p = ${pop}.getBoundingClientRect(), b = ${box}.getBoundingClientRect(); return { inView: p.top >= 0 && p.bottom <= innerHeight && p.left >= 0 && p.right <= innerWidth, near: p.bottom <= b.bottom + 400 && p.top >= b.top - 400 }; })()`);
    assert(at.inView && at.near, 'list placement: ' + JSON.stringify(at));
    await page.shot('term-suggest');
    // Tab puts the term in (the draft is saved like typed text), the list goes
    await page.key('Tab');
    await page.waitFor(`!${pop} && ${box}.value === 'The model reads token' && document.activeElement === ${box} && JSON.parse(localStorage['learn:draft:answer:demo']) === 'The model reads token'`, { timeout: 3000 });
    // a finished term, a common word, two letters: nothing
    await page.type(' and the so'); await sleep(200);
    assert(!(await page.eval(`!!${pop}`)), 'a list for "so"');
    // arrows choose when there are several; Enter is not taken: the list goes, nothing is inserted or sent
    const jl = journal().length;
    await page.type('f'); await page.waitFor(pop, { timeout: 3000 });   // "sof" -> softmax
    await clear(); await page.type('att'); await page.waitFor(`document.querySelectorAll('.tc-pop .tc-row').length >= 2`, { timeout: 3000 });
    const first = await page.eval(`document.querySelector('.tc-row.on .tc-name b').textContent`);
    await page.key('ArrowDown');
    const second = await page.eval(`document.querySelector('.tc-row.on .tc-name b').textContent`);
    assert(first !== second, 'ArrowDown does not move the choice');
    await page.key('Enter'); await sleep(200);
    assert(await page.eval(`!${pop} && ${box}.value.startsWith('att') && !${box}.value.includes('${second}')`) && journal().length === jl, 'Enter took the suggestion or sent');
    // Esc closes the list and leaves the input; the next Esc hides the input, as always
    await clear(); await page.type('soft'); await page.waitFor(pop, { timeout: 3000 });
    await page.key('Escape'); await sleep(200);
    assert(await page.eval(`!${pop} && !!${box} && !document.querySelector('.composer.collapsed')`), 'Esc with the list open hid the input');
    await page.key('Escape');
    await page.waitFor(`document.querySelector('.composer.collapsed')`, { timeout: 2000 });
    await page.eval(`document.querySelector('.corner-answer').click()`);
    await page.waitFor(`document.activeElement?.id === 'answerBox'`, { timeout: 2000 });
    // switched off in System → Settings: no list
    await page.nav(`${BASE}/#/demo/system/settings`, 900);
    await page.waitFor(`document.querySelector('#setComplete button.on')?.dataset.v === 'true'`, { timeout: 3000 });
    await page.shot('system-settings');
    await page.eval(`document.querySelector('#setComplete button[data-v="false"]').click()`);
    await page.waitFor(`localStorage['learn:termComplete'] === 'false' && document.querySelector('#setComplete button.on').dataset.v === 'false'`, { timeout: 2000 });
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    await clear(); await page.type('the tok'); await sleep(300);
    assert(!(await page.eval(`!!${pop}`)), 'suggestions while switched off');
    // "Find term": by what it means; Enter puts it where the caret was, replacing the word begun
    await page.click('#findTermBtn');
    await page.waitFor(`document.activeElement?.id === 'findTermBox' && document.querySelector('#findTermBox').value === 'tok'`, { timeout: 3000 });
    await page.eval(`(() => { const i = document.querySelector('#findTermBox'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.type('how much each token contributes');
    await page.waitFor(`document.querySelector('.tc-row.on .tc-name b')?.textContent === 'attention weights'`, { timeout: 3000 });
    await page.shot('term-find');
    await page.key('Enter');
    await page.waitFor(`!${pop} && ${box}.value === 'the attention weights' && document.activeElement === ${box}`, { timeout: 3000 });
    assert(journal().length === jl, 'something was sent');
    await page.eval(`localStorage.removeItem('learn:termComplete')`);
    await clear();
    await page.eval(`localStorage['learn:draft:answer:demo'] = '""'`);
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
  await test('status light: green, then yellow from 70% of the handoff threshold, red from 90%, with the reason in words; stalled messages and a quiet agent without a meter count too', async () => {
    // the rule itself (app/sysstats.js)
    const H = JSON.parse(execFileSync(process.execPath, ['-e', `const Y = require('./app/sysstats'); const c = t => ({ tokens: t, limit: 400000 });
      const lv = o => { const h = Y.tutorHealth(o); return h.level + ':' + h.reasons.map(r => r.short).join('+'); };
      console.log(JSON.stringify([lv({ context: c(279000) }), lv({ context: c(280000) }), lv({ context: c(359000) }), lv({ context: c(360000) }), lv({ context: c(420000) }),
        lv({ context: c(100000), stalled: ['demo/x'] }), lv({ context: c(300000), watchdogFired: 2 }), lv({ turns: 55, handoffMessages: 80 }), lv({ turns: 56, handoffMessages: 80 }), lv({ turns: 72, handoffMessages: 80 }),
        lv({ context: c(200000), waits: { recent: 200, usual: 60, n: 5 } }), lv({ context: c(100000), waits: { recent: 200, usual: 60, n: 5 } }), lv({ context: c(200000), waits: { recent: 100, usual: 30, n: 5 } }),
        Y.tutorHealth({ context: c(310000) }).reasons[0].text]))`], { env: ENV, cwd: CODE, encoding: 'utf8' }));
    assert(JSON.stringify(H.slice(0, -1)) === JSON.stringify(['ok:', 'warn:context 70%', 'warn:context 90%', 'now:context 90%', 'now:context 105%', 'now:no reply', 'now:not answering+context 75%',
      'ok:', 'warn:56/80 messages', 'now:72/80 messages', 'warn:slow replies', 'ok:', 'ok:']), 'tutorHealth: ' + JSON.stringify(H));
    assert(/^Context 310k of 400k \(78%\)/.test(H.at(-1)), H.at(-1));
    // in the UI: the fresh session is small, so the light is green and the pill says nothing more
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    const st0 = await until(async () => { const x = await api('/api/status'); return x.phase === 'listening' && x.health && x; }, 'a listening tutor with a light');
    assert(st0.health.level === 'ok' && !st0.health.reasons.length && !(st0.context?.tokens > 60000), 'a fresh session is not green (the size of the session it replaced?): ' + JSON.stringify([st0.health, st0.context]));
    await page.waitFor(`document.querySelector('#status').dataset.light === 'ok' && !document.querySelector('#status .light-tag')`, { timeout: 5000 });
    // each fake turn adds 30k of 150k: yellow comes first, then red, before the automatic handoff
    const before = sessions().length, seen = [];
    let had = st0.context?.tokens || 0;
    for (let i = 0; i < 6 && sessions().length === before && seen.at(-1)?.level !== 'now'; i++) {
      await api('/api/send', { topic: 'demo', kind: 'ask', text: 'light filler ' + i });
      await until(() => fakeLog().some(l => l.event === 'replied' && journal().find(e => e.id === l.id)?.text === 'light filler ' + i), 'reply ' + i);
      // (the context is read every few seconds: wait for this reply's size)
      const st = await until(async () => { const x = await api('/api/status'); return x.phase === 'listening' && x.context?.tokens > had && x; }, 'the context after reply ' + i);
      had = st.context.tokens;
      const f = st.context.tokens / st.context.limit;
      assert(st.health.level === (f >= 0.9 ? 'now' : f >= 0.7 ? 'warn' : 'ok'), `level ${st.health.level} at ${Math.round(f * 100)}%`);
      if (st.health.level !== 'ok' && st.health.level !== seen.at(-1)?.level) {
        seen.push({ level: st.health.level, f });
        await page.waitFor(`document.querySelector('#status').classList.contains('light-${st.health.level}')`, { timeout: 5000 });
        const pill = await page.eval(`(() => { const e = document.querySelector('#status'); return { text: e.innerText.replace(/\\s+/g, ' '), title: e.title, tag: getComputedStyle(e.querySelector('.light-tag .long')).display !== 'none' }; })()`);
        assert(pill.tag && pill.text.includes(st.health.level === 'warn' ? 'fresh tutor soon' : 'restart now'), 'the pill says it in words: ' + JSON.stringify(pill));
        assert(/Context \d+k of 150k/.test(pill.title), 'the reason is in the tooltip: ' + pill.title);
        await page.click('#status', 300);
        const p = await page.waitFor(`document.querySelector('#popLight')?.innerText`, { timeout: 3000 });
        assert(/Context \d+k of 150k/.test(p) && (st.health.level === 'warn' ? /sensible/ : /Restart the tutor now/i).test(p), 'popover: ' + p);
        assert(await page.eval(`[...document.querySelectorAll('.tutor-pop .pop-f .btn')].find(b => /Fresh tutor/.test(b.textContent)).classList.contains('btn-primary')`), 'Fresh tutor is not the main button');
        await page.shot('status-light-' + st.health.level);
        await page.click('#status', 200);
      }
    }
    assert(seen.map(x => x.level).join() === 'warn,now', 'yellow, then red: ' + JSON.stringify(seen));
    assert(sessions().length === before, 'the light replaced the tutor: it only informs');
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
  await test('a retried send (same client id) is saved once: the server returns the entry it already has', async () => {
    const n0 = journal().length;
    const body = { topic: 'demo', kind: 'ask', text: 'retry me FAKE-NOREPLY', cid: 'test-cid-1' };
    const a = await api('/api/send', body), b = await api('/api/send', body);
    assert(a.id === b.id, `two ids: ${a.id} ${b.id}`);
    assert(journal().filter(e => e.text === body.text).length === 1 && journal().length >= n0 + 1, 'posted twice');
    await until(() => fakeLog().some(l => l.event === 'noreply' && l.id === a.id), 'picked up');
  });
  await test('"thinking" ends when the tutor goes back to listening without a reply (it never sticks)', async () => {
    const sent = await api('/api/send', { topic: 'demo', kind: 'action', text: 'FAKE-NOREPLY switch threads' });
    await until(() => fakeLog().some(l => l.event === 'noreply' && l.id === sent.id), 'picked up');
    await until(async () => (await api('/api/status')).phase === 'listening', 'listening again', 6000);
  });
  await test('a message claimed by a wait that died before showing it is delivered again by the next wait', async () => {
    const inbox = path.join(HOME, 'state/inbox'), id = 'lost-' + Date.now();
    fs.writeFileSync(path.join(inbox, `1-${id}.json.999999`), JSON.stringify({ id, topic: 'demo', role: 'user', kind: 'ask', text: 'claimed, then the wait died', ts: new Date().toISOString() }));
    await api('/api/send', { topic: 'demo', kind: 'action', text: 'FAKE-NOREPLY nudge: the tutor re-arms wait' });
    await until(() => fakeLog().some(l => l.event === 'replied' && l.id === id), 'the lost message reaches the tutor', 10000);
    assert(!fs.readdirSync(inbox).some(f => f.includes(id)), 'claim file left behind: ' + fs.readdirSync(inbox));
  });
  await test('a message the tutor was given and left unanswered (its wait printed into the void, or it went back to listening) is delivered again by the running wait, once, and answered once', async () => {
    setConfig({ redeliverSeconds: 1 });
    try {
      const sent = await api('/api/send', { topic: 'demo', kind: 'ask', text: 'FAKE-NOREPLY lost on the way' });
      await until(() => fakeLog().some(l => l.event === 'noreply' && l.id === sent.id), 'delivered the first time');
      const again = await until(() => fakeLog().find(l => l.event === 'replied' && l.id === sent.id), 'delivered again and answered, with nothing sent meanwhile', 20000);
      assert(/DELIVERED AGAIN/.test(again.head), 'not marked as delivered again: ' + again.head);
      await sleep(2500);
      assert(journal().filter(e => e.role === 'tutor' && e.kind === 'message' && e.replyTo === sent.id).length === 1, 'answered more than once');
      assert(!(await api('/api/status')).stalled.length, 'an answered message is listed as stalled');
      // one the tutor leaves alone even the second time: delivered twice, no more, and the thread says so
      await page.nav(`${BASE}/#/demo/learn`, 900);
      const never = await api('/api/send', { topic: 'demo', kind: 'ask', text: 'FAKE-NEVER answered' });
      await until(() => fakeLog().filter(l => l.event === 'noreply' && l.id === never.id).length === 2, 'delivered twice', 20000);
      await until(async () => (await api('/api/status')).stalled.includes(`demo/${never.id}`), 'status lists it as stalled', 15000);
      await page.waitFor(`/No reply yet/.test(document.querySelector('.typing.stalled')?.textContent || '') && !!document.querySelector('.typing.stalled .btn')`, { timeout: 8000 });
      await page.shot('stalled-message');
      await sleep(3000);
      assert(fakeLog().filter(l => l.event === 'noreply' && l.id === never.id).length === 2, 'delivered a third time');
    } finally { setConfig(); }
    // the next reply in the thread ends it
    const next = await api('/api/send', { topic: 'demo', kind: 'ask', text: 'and on we go' });
    await until(() => fakeLog().some(l => l.event === 'replied' && l.id === next.id), 'next message answered');
    await page.waitFor(`!document.querySelector('.typing.stalled')`, { timeout: 8000 });
  });
  await test('watchdog: a tutor that took a message, went quiet and listens no more is replaced by itself, and the fresh one answers', async () => {
    const before = sessions().length;
    const sent = await api('/api/send', { topic: 'demo', kind: 'ask', text: 'STALL-ONCE and nobody presses a button' });
    await until(() => fakeLog().some(l => l.event === 'stalling' && l.id === sent.id), 'tutor stalls');
    setConfig({ watchdogSeconds: 2 });
    try {
      await until(() => fakeLog().some(l => l.event === 'replied' && l.id === sent.id), 'a fresh tutor answers without anyone asking', 30000);
    } finally { setConfig(); }
    assert(sessions().length === before + 1, 'sessions started: ' + (sessions().length - before));
    assert(journal().filter(e => e.role === 'tutor' && e.kind === 'message' && e.replyTo === sent.id).length === 1, 'answered once');
    assert(/watchdog: .*replacing the tutor/.test(fs.readFileSync(path.join(HOME, 'state/server.log'), 'utf8')), 'server.log says why');
    await until(async () => (await api('/api/status')).phase === 'listening', 'listening again', 20000);
  });
  await test('a command never ends in silence: a server that dies mid-answer is an error for post, and wait prints its message first; a wait that cannot print puts the message back', async () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-cut-'));
    fs.cpSync(path.join(HOME, 'topics'), path.join(copy, 'topics'), { recursive: true });
    const port = Number(PORT) + 334;
    const cenv = { ...ENV, LEARN_HOME: copy, LEARN_PORT: String(port) };
    delete cenv.LEARN_SESSION;
    const enqueue = m => execFileSync(process.execPath, ['-e', `const S = require(${JSON.stringify(path.join(CODE, 'app', 'store.js'))}); S.ensureDir(S.INBOX); S.enqueue(JSON.parse(process.argv[1]))`, JSON.stringify(m)], { env: cenv });
    const runCli = (a, { input, stdout = 'pipe' } = {}) => new Promise(res => {
      const c = spawn(process.execPath, [BIN, ...a], { env: cenv, stdio: ['pipe', stdout, 'pipe'] });
      let o = '', e = ''; c.stdout?.on('data', d => o += d); c.stderr.on('data', d => e += d);
      c.stdin.end(input || '');
      const t = setTimeout(() => c.kill('SIGKILL'), 20000);
      c.on('exit', status => { clearTimeout(t); res({ status, stdout: o, stderr: e }); });
    });
    // a server that answers the ping and then dies in the middle of every other answer
    const net = await import('node:net');
    const srv = net.createServer(sock => {
      sock.on('error', () => {});
      sock.on('data', d => {
        if (/^GET \/api\/ping/.test(String(d))) { const b = JSON.stringify({ ok: true, home: fs.realpathSync(copy) }); return sock.write(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${b.length}\r\n\r\n${b}`); }
        sock.write('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 400\r\n\r\n[{"id"'); setTimeout(() => sock.destroy(), 30);
      });
    });
    await new Promise(r => srv.listen(port, '127.0.0.1', r));
    const inbox = () => fs.readdirSync(path.join(copy, 'state/inbox'));
    try {
      const p = await runCli(['post', '--topic', 'demo', '--force'], { input: 'cut off mid-answer' });
      assert(p.status === 1 && /closed the connection/.test(p.stderr), `post ended with ${p.status}: ${p.stdout}${p.stderr}`);
      enqueue({ id: 'cut-1', topic: 'demo', role: 'user', kind: 'ask', text: 'printed before the server is told', ts: new Date().toISOString() });
      const w = await runCli(['wait']);
      assert(w.status === 0 && w.stdout.includes('printed before the server is told') && /re-run `bin\/learn wait`/.test(w.stdout), `wait: ${w.status} ${w.stdout}${w.stderr}`);
      assert(!inbox().length, 'left in the inbox: ' + inbox());
    } finally { srv.close(); }
    // stdout that refuses every write (Linux has a device for that): exit 1, and the message is queued again
    if (fs.existsSync('/dev/full')) {
      enqueue({ id: 'cut-2', topic: 'demo', role: 'user', kind: 'ask', text: 'cannot be printed', ts: new Date().toISOString() });
      const full = fs.openSync('/dev/full', 'w');
      const w = await runCli(['wait'], { stdout: full });
      fs.closeSync(full);
      assert(w.status === 1 && /wait failed: .*back in the queue/.test(w.stderr), `wait on a full device: ${w.status} ${w.stderr}`);
      assert(inbox().length === 1 && /-cut-2\.json$/.test(inbox()[0]), 'not back in the inbox: ' + inbox());
      const w2 = await runCli(['wait']);
      assert(w2.status === 0 && w2.stdout.includes('cannot be printed'), 'the next wait did not deliver it: ' + w2.stdout + w2.stderr);
    }
    fs.rmSync(copy, { recursive: true, force: true });
  });
  await test('a send retried after the server restarted in between is still saved once (the entry carries the client id)', async () => {
    const body = { topic: 'cells', kind: 'ask', text: 'retried across a restart', cid: 'test-cid-restart' };
    const first = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-cid-'));
    fs.cpSync(path.join(HOME, 'topics'), path.join(first, 'topics'), { recursive: true });
    const port = String(Number(PORT) + 335), cenv = { ...ENV, LEARN_HOME: first, LEARN_PORT: port };
    const post = async () => (await fetch(`http://localhost:${port}/api/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const up = () => until(() => fetch(`http://localhost:${port}/api/ping`).then(r => r.ok).catch(() => false), 'server');
    let srv = spawn(process.execPath, [BIN, 'serve'], { env: cenv, stdio: 'ignore' });
    try {
      await up();
      const a = await post();
      srv.kill(); await new Promise(r => srv.once('exit', r));
      srv = spawn(process.execPath, [BIN, 'serve'], { env: cenv, stdio: 'ignore' });
      await up();
      const b = await post();
      assert(a.id && a.id === b.id, `two entries: ${a.id} ${b.id}`);
    } finally { srv.kill(); fs.rmSync(first, { recursive: true, force: true }); }
  });
  await test('ping names the data home, status lists the queue by topic/id and the open browser tabs', async () => {
    const p = await api('/api/ping');
    assert(p.home === fs.realpathSync(HOME), JSON.stringify(p));
    const st = await api('/api/status');
    assert(Array.isArray(st.inbox) && typeof st.clients === 'number' && st.clients >= 1, JSON.stringify(st));
  });
  await test('awaitingReply: a reply in the same thread or one naming the message answers it; a reply in the other thread, or app talk about something else, does not', async () => {
    const { awaitingReply } = await import('../web/js/journal.js');
    const u = (id, ts, track, kind = 'answer') => ({ id, ts, role: 'user', kind, track });
    const t = (id, ts, extra) => ({ id, ts, role: 'tutor', kind: 'message', ...extra });
    // the evening that showed the bug: last message in B, answered by a --meta reply (no thread)
    const J = [u('1', '01', 'b'), t('2', '02', { meta: true, replyTo: '1' })];
    assert(!awaitingReply(J, 'b') && !awaitingReply(J), 'meta reply naming it answers it');
    assert(awaitingReply([u('1', '01', 'b'), t('2', '02', { track: 'a' })], 'b')?.id === '1', 'reply in A does not answer B');
    assert(!awaitingReply([u('1', '01', 'b'), t('2', '02', { track: 'b' })], 'b'), 'reply in B answers B');
    assert(awaitingReply([u('1', '01'), t('2', '02', { meta: true, replyTo: '0' })])?.id === '1', 'unrelated app talk is no reply');
    assert(!awaitingReply([u('1', '01'), t('2', '02', {})]), 'one thread: any later message answers');
  });
  await test('many tabs open (each bin/learn start used to open one): one event stream for all of them, sends go through, live updates reach every tab', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 900);
    const tabs = await page.openTabs(`${BASE}/#/demo/learn`, 8);
    try {
      await sleep(2500);
      // reload the driven tab: it gives up the stream, another tab takes it, this one follows
      await page.nav(`${BASE}/#/demo/learn`, 2500);
      const st = await api('/api/status');
      assert(st.clients === 1, 'event streams open: ' + st.clients);
      await page.click('#answerBox'); await page.type('sent with nine tabs open FAKE-NOREPLY');
      const t0 = Date.now();
      await page.key('Enter', { meta: true });
      await page.waitFor(`document.querySelector('#answerBox').value === '' && [...document.querySelectorAll('.thread .msg')].some(m => m.innerText.includes('sent with nine tabs open'))`, { timeout: 8000 });
      assert(Date.now() - t0 < 3000, 'slow send: ' + (Date.now() - t0) + 'ms');
      // a follower still gets live updates: a reply posted from the CLI shows up here
      execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--force'], { env: ENV, stdio: 'pipe', input: 'Relayed to every tab', encoding: 'utf8' });
      await page.waitFor(`[...document.querySelectorAll('.thread .msg')].some(m => m.innerText.includes('Relayed to every tab'))`, { timeout: 5000 });
    } finally { await page.closeTabs(tabs); }
  });
  await test('a send that fails keeps the text, says why next to the box, and works when retried', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 900);
    await page.click('#answerBox'); await page.type('kept through a failure');
    await page.eval(`window.__fetch = window.fetch; window.fetch = (u, o) => String(u).includes('/api/send') ? Promise.resolve(new Response(JSON.stringify({ error: 'simulated refusal' }), { status: 400 })) : window.__fetch(u, o)`);
    await page.key('Enter', { meta: true });
    await page.waitFor(`/simulated refusal/.test(document.querySelector('.send-error')?.textContent || '')`, { timeout: 4000 });
    assert(await page.eval(`document.querySelector('#answerBox').value === 'kept through a failure' && JSON.parse(localStorage['learn:draft:answer:demo']) === 'kept through a failure'`), 'text lost after a failed send');
    assert(!journal().some(e => e.text === 'kept through a failure'), 'saved although refused');
    await page.eval(`window.fetch = window.__fetch`);
    await page.key('Enter', { meta: true });
    await page.waitFor(`document.querySelector('#answerBox').value === '' && !document.querySelector('.send-error')`, { timeout: 5000 });
    await until(() => journal().some(e => e.text === 'kept through a failure'), 'sent on retry');
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
  await test('wiki You: the knowledge pill shows and copies', async () => {
    await page.nav(`${BASE}/#/demo/wiki/you`, 900);
    await page.waitFor(`document.querySelector('#pillShow')`, { timeout: 4000 });
    await page.click('#pillShow');
    await page.waitFor(`/^What I understand: How LLMs work/.test(document.querySelector('.pill-text h1')?.textContent || '')`, { timeout: 4000 });
    await page.eval(`document.querySelector('.pill-text').scrollIntoView()`);
    await page.shot('wiki-you-pill');
  });
  await test('your instructions to every tutor: edited on the Tell page, saved into profile.md "In my own words" (rest kept), shown on the You page, the running tutor is told once, with its next message', async () => {
    const env = { ...ENV, LEARN_SESSION: 'instr-test-session' };
    const node = code => execFileSync(process.execPath, ['-e', code], { env, cwd: CODE, encoding: 'utf8' });
    node(`require('./app/session').markInstructionsSeen('instr-test-session')`);
    await page.nav(`${BASE}/#/demo/wiki/you`, 900);
    await page.waitFor(`document.querySelector('#instrEdit')`, { timeout: 4000 });
    await page.click('#instrEdit');
    await page.waitFor(`location.hash === '#/demo/system/instructions' && document.querySelector('#instrBox') && document.querySelector('#instrSave').disabled`, { timeout: 4000 });
    await page.eval(`document.querySelector('#instrBox').value = ''`);
    await page.click('#instrBox'); await page.type('Be direct.\n\nNo softening.');
    await page.click('#instrSave');
    await page.waitFor(`/Saved/.test(document.querySelector('.tell-note.ok')?.textContent || '') && document.querySelector('#instrSave').disabled`, { timeout: 4000 });
    await page.shot('tell-instructions');
    await page.nav(`${BASE}/#/demo/wiki/you`, 900);
    await page.waitFor(`/No softening/.test(document.querySelector('.instr')?.innerText || '')`, { timeout: 4000 });
    const prof = fs.readFileSync(path.join(HOME, 'learner/profile.md'), 'utf8');
    assert(/## In my own words \(authoritative\)\n\nWritten by the learner\.[^\n]*\n\n> Be direct\.\n>\n> No softening\.\n/.test(prof), prof);
    assert(prof.startsWith('# Learner profile') && /## Background[\s\S]*## How I like to learn[\s\S]*Dark theme/.test(prof), 'rest of the profile lost: ' + prof);
    assert(!/In my own words|No softening/.test(await page.eval(`[...document.querySelectorAll('.sheet')].find(s => /How you like to learn/.test(s.innerText))?.innerText || ''`)), 'shown twice');
    const told = node(`process.stdout.write(String(require('./app/session').instructionsChanged('instr-test-session')))`);
    assert(/Be direct\.\n\nNo softening\./.test(told), 'not told: ' + told);
    assert(node(`process.stdout.write(String(require('./app/session').instructionsChanged('instr-test-session')))`) === 'null', 'told twice');
    // a draft survives a reload; Revert drops it
    await page.nav(`${BASE}/#/demo/tell/instructions`, 900);
    await page.click('#instrBox'); await page.type(' DRAFT');
    await page.nav(`${BASE}/#/demo/tell/instructions`, 900);
    await page.waitFor(`/DRAFT/.test(document.querySelector('#instrBox')?.value || '') && !document.querySelector('#instrSave').disabled`, { timeout: 4000 });
    await page.click('#instrRevert');
    assert(await page.eval(`!/DRAFT/.test(document.querySelector('#instrBox').value) && localStorage['learn:draft:instructions'] === 'null'`), 'revert');
    assert(!/DRAFT/.test(fs.readFileSync(path.join(HOME, 'learner/profile.md'), 'utf8')), 'reverted draft saved');
  });
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
    // the message may be further back than the first page of the conversation (earlier tests add messages)
    const T = `document.querySelector('.thread .term[data-term="temperature"], .thread .ref-term[data-id="temperature"]')`;
    await page.eval(`(() => { for (let i = 0; i < 5 && !${T}; i++) document.querySelector('.earlier button')?.click(); })()`);
    await page.waitFor(T, { timeout: 3000 });
    await page.eval(`document.querySelector('.thread .term[data-term="temperature"], .thread .ref-term[data-id="temperature"]').id = 'zz-temp'`);
    await page.click('#zz-temp', 300);
    const dock = await page.waitFor(`(() => { const d = document.querySelector('#dock'); return d.querySelector('.term-page .callout-fog') && { title: d.querySelector('.title-block h2').textContent,
      marker: !!d.querySelector('.gl-has-page'), btn: [...d.querySelectorAll('.actions .btn')].map(b => b.textContent).join('|') }; })()`, { timeout: 3000 });
    assert(dock.title === 'temperature' && /Open its page/.test(dock.btn), 'dock: ' + JSON.stringify(dock));
    await page.shot('term-page-dock');
  });
  // a message in the (otherwise empty) cells topic exercising the auto-linker, tips and the
  // glossary coverage reminder
  const post = (topic, text) => execFileSync(process.execPath, [BIN, 'post', '--topic', topic], { env: ENV, stdio: 'pipe', input: text, encoding: 'utf8' });
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
    assert(r.pol.join('|') === "polymerase|Polymerase|DNA Polymerase|polymerases|polymerase|polymerase|Polymerase|polymerase", 'every occurrence (the last is a coloured highlight, itself the term): ' + JSON.stringify(r));
    assert(r.again.join() === 'false,true,true,true,true,true,true,false', 'first clear, repeats faint (a coloured highlight keeps its own underline): ' + r.again);
    assert(r.where.join() === 'h2,strong,p,p,p,td,p+callout,p', 'places: ' + r.where);
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
  await test('term pages during the lesson: post names the terms a message taught and their page file; resume lists focus terms without one', async () => {
    const out = post('cells', 'The **nucleus** holds the DNA; **DNA polymerase** copies it. **Ribosomes** come later.');
    assert(/^term pages \(after re-arming wait;.*"nucleus" \(new: \S*topics\/cells\/terms\/nucleus\.md\), "DNA polymerase" \(new: \S*dna-polymerase\.md\), and of the new terms above\./m.test(out), out);
    fs.mkdirSync(path.join(HOME, 'topics/cells/terms'), { recursive: true });
    fs.writeFileSync(path.join(HOME, 'topics/cells/terms/nucleus.md'), 'The nucleus is where the DNA is kept.');
    assert(/"nucleus" \(extend \S*nucleus\.md\)/.test(post('cells', 'Inside the **nucleus**.')), 'existing page');
    assert(!/term pages/.test(post('cells', 'No bold terms here.')), 'reminder without bold terms');
    const r = learn('resume', 'cells');
    assert(/## Term pages \(1 of \d+ terms have one/.test(r), r.slice(r.indexOf('## Term pages'), r.indexOf('## Term pages') + 300));
    fs.rmSync(path.join(HOME, 'topics/cells/terms/nucleus.md'));
  });
  await test('show: ids repeat across topics, so show takes --topic t or t/<id> and says when an id is in two topics', async () => {
    const ids = topic => fs.readdirSync(path.join(HOME, 'topics', topic, 'journal')).flatMap(f => fs.readFileSync(path.join(HOME, 'topics', topic, 'journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id));
    const demo = new Set(ids('demo')), both = ids('cells').find(id => demo.has(id));
    assert(both, 'no id in both topics to test with');
    const showErr = (...a) => spawnSync(process.execPath, [BIN, 'show', ...a], { env: ENV, encoding: 'utf8' });
    const a = showErr('--topic', 'cells', both), b = showErr(`cells/${both}`), c = showErr(both), d = showErr('--topic', 'demo', both);
    assert(a.status === 0 && b.stdout === a.stdout && d.status === 0 && d.stdout !== a.stdout, 'show --topic / t/<id>: ' + a.stderr + b.stderr);
    assert(/also in (cells|demo): `show (cells|demo)\//.test(c.stderr), 'no hint about the other topic: ' + c.stderr);
    assert(/^learn: not found: 2099-01-01\.1 in cells/m.test(showErr('--topic', 'cells', '2099-01-01.1').stderr), 'missing id');
    assert(/show \[--topic t\] <id>[^·\n]*· show <topic>\/<id>/.test(learn('help')), 'help lists the topic/id form');
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
  await test('viz figure: a real image with the rest dimmed, numbered focus regions + list (linked hover), an arrow, a blanked label; full size on click', async () => {
    // a busy 400×300 "textbook diagram" with labels everywhere
    const svgFile = path.join(HOME, 'busy.svg');
    fs.writeFileSync(svgFile, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f4f1e8"/>
      ${[...Array(10)].map((_, i) => `<circle cx="${40 + (i % 5) * 80}" cy="${80 + Math.floor(i / 5) * 120}" r="26" fill="hsl(${i * 36},60%,60%)"/><text x="${40 + (i % 5) * 80}" y="${125 + Math.floor(i / 5) * 120}" font-size="13" text-anchor="middle">label ${i + 1}</text>`).join('')}</svg>`);
    learn('image', 'cells', svgFile, '--author', 'Test Author', '--license', 'CC0');
    const fig = (src, more = '') => ['Only two parts matter here.', '', '```viz figure', `{ src: "${src}", caption: "Look at **1** and **2** only",`,
      '  focus: [ { x: .02, y: .1, w: .2, h: .36, label: "the first circle", key: "first" }, { x: 240, y: 170, w: 80, h: 120, label: "the ninth one" } ],',
      '  arrows: [ { from: [.95, .1], to: [.75, .25], label: "start here" } ],', `  hide: [ { x: .3, y: .38, w: .4, h: .07 } ]${more} }`, '```'].join('\n');
    const bad = spawnSync(process.execPath, [BIN, 'post', '--topic', 'cells'], { env: ENV, input: fig('nope.png'), encoding: 'utf8' });
    assert(bad.status === 1 && /media:nope\.png: viz figure src not in media/.test(bad.stderr), 'missing figure image posted: ' + bad.stderr);
    post('cells', fig('busy.svg') + '\n\nSee {{the first one|first}}.');
    const id = lastTutor('cells').id, sel = `[id="m-${id}"] .viz-figure`;
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const r = await page.waitFor(`(() => { const v = document.querySelector('${sel}'); if (!v || !v.querySelector('.fig-region') || !v.querySelector('.media-credit')) return null;   // the credit comes with media/index.json, a moment after the post
      const regs = [...v.querySelectorAll('.fig-region')], st = v.querySelector('.fig-stage').getBoundingClientRect();
      return { regions: regs.length, nums: regs.map(g => g.querySelector('text').textContent).join(), list: [...v.querySelectorAll('.fig-list li')].map(li => li.innerText.replace(/\\s+/g, ' ')),
        mask: v.querySelectorAll('mask rect').length, hide: v.querySelectorAll('.fig-hide').length, arrow: v.querySelector('.fig-arrow-label')?.textContent,
        box2: (() => { const b = regs[1].querySelector('rect'); return [b.getAttribute('x'), b.getAttribute('width')].join(); })(),
        credit: v.querySelector('.media-credit')?.textContent, cap: v.querySelector('.media-cap-text')?.textContent, w: Math.round(st.width), err: !!v.querySelector('.viz-err-msg') }; })()`, { timeout: 5000 });
    assert(r.regions === 2 && r.nums === '1,2' && r.list.join('|') === '1 the first circle|2 the ninth one' && r.mask === 3 && r.hide === 1 && r.arrow === 'start here', JSON.stringify(r));
    assert(r.box2 === '240,80' && r.credit === 'Test Author · CC0' && r.cap === 'Look at 1 and 2 only' && r.w > 300 && !r.err, 'pixels / credit / size: ' + JSON.stringify(r));
    await page.eval(`document.querySelector('${sel} .fig-list li').id = 'zz-fig1'`);
    await page.hover('#zz-fig1', 300);
    const hl = await page.eval(`[...document.querySelectorAll('[id="m-${id}"] [data-k="first"]')].map(e => e.classList.contains('hl') + ':' + e.tagName.toLowerCase())`);
    assert(hl.includes('true:g') && hl.includes('true:span'), 'hovering the list row lights the region and the prose: ' + JSON.stringify(hl));
    await page.shot('viz-figure');
    await page.mouse('mouseMoved', 5, 5);
    await page.click(`${sel} .fig-stage`, 400);
    const big = await page.eval(`(() => { const b = document.querySelector('.lightbox .fig-big'); return b && { w: Math.round(b.getBoundingClientRect().width), regions: b.querySelectorAll('.fig-region').length, list: !!document.querySelector('.lightbox .fig-list') }; })()`);
    assert(big && big.w > r.w && big.regions === 2 && big.list, 'full size: ' + JSON.stringify(big));
    await page.shot('viz-figure-full');
    await page.key?.('Escape');
    await page.eval(`document.querySelector('.lightbox')?.click()`); await sleep(200);
    assert(!(await page.eval(`!!document.querySelector('.lightbox')`)), 'lightbox closes');
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
    const lkTerm = await page.eval(`(() => { const e = document.querySelector('${sel} .lk[data-k="membrane"]'); return e.classList.contains('term') + ' ' + e.dataset.term + ' ' + e.querySelectorAll('.term').length; })()`);
    assert(/^true .*membrane 0$/.test(lkTerm), 'a coloured highlight is also its glossary term (hover card): ' + lkTerm);
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
    execFileSync(process.execPath, [BIN, 'post', '--topic', 'cells', '--force'], { env: ENV, stdio: 'pipe', input: 'Who knew?', encoding: 'utf8' });
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
  await test('bookkeeping never moves the conversation: grade, level, note, term at the bottom; growth, folds and new lines above and below', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 1200);
    const place = id => page.eval(`(() => { const sc = document.querySelector('#threadScroll'), top = sc.getBoundingClientRect().top;
      const n = ${id ? `document.getElementById(${JSON.stringify(id)})` : `[...document.querySelectorAll('#thread > [id]')].find(n => n.getBoundingClientRect().bottom > top + 1)`};
      return n && { id: n.id, off: Math.round(n.getBoundingClientRect().top - top), st: Math.round(sc.scrollTop), gap: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) }; })()`);
    const same = (a, b, what) => assert(b && Math.abs(b.off - a.off) <= 1, `${what} moved the text: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    // 1. at the bottom, where a reply was just read: the tutor's bookkeeping lands below, nothing moves
    await page.eval(`(() => { const sc = document.querySelector('#threadScroll'); sc.scrollTop = sc.scrollHeight; })()`);
    await sleep(400);
    const a = await place();
    assert(a.gap < 2, 'not at the bottom: ' + JSON.stringify(a));
    await page.eval(`window.__probe = [...document.querySelectorAll('#thread .msg-tutor')].at(-1)`);
    learn('level', 'demo', '4.2', '1', 'scroll test');
    learn('note', 'review', '--topic', 'demo', '--skill', '4.2', 'scroll test note');
    learn('term', 'add', 'demo', 'scroll probe', '--short', 'A term added by the scroll test.');
    execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--grade', 'partial', '--note', 'scroll test'], { env: ENV, encoding: 'utf8' });
    await page.waitFor(`[...document.querySelectorAll('#thread .sysline')].some(x => /scroll test/.test(x.textContent))`);
    await sleep(1200);   // the topic-file broadcasts arrive and settle
    const b = await place(a.id);
    same(a, b, 'bookkeeping at the bottom');
    assert(Math.abs(b.st - a.st) <= 1 && b.gap > 10, `scrolled to the new line: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    assert(await page.eval(`window.__probe.isConnected`), 'the conversation was redrawn instead of updated in place');
    assert(!await page.eval(`document.querySelector('.newpill')`), 'bookkeeping showed the "New message" pill');
    // 2. reading in the middle: something above the window grows (an image loading) or folds (tagged as app talk)
    await page.eval(`(() => { const sc = document.querySelector('#threadScroll'); sc.scrollTop = Math.round(sc.scrollHeight / 2); })()`);
    await sleep(400);
    const c = await place();
    await page.eval(`(() => { const top = document.querySelector('#threadScroll').getBoundingClientRect().top;
      const b = [...document.querySelectorAll('#thread .msg-body')].filter(x => x.getBoundingClientRect().bottom < top - 10).at(-1);
      b.append(Object.assign(document.createElement('div'), { className: 'grow-probe', style: 'height: 300px' })); })()`);
    await sleep(300);
    const d = await place(c.id);
    same(c, d, 'content growing above');
    assert(d.st >= c.st + 295, 'scrollTop did not follow the growth: ' + JSON.stringify([c, d]));
    await page.eval(`document.querySelector('.grow-probe').remove()`);
    await sleep(300);
    same(c, await place(c.id), 'content shrinking above');
    const above = await page.eval(`(() => { const top = document.querySelector('#threadScroll').getBoundingClientRect().top;
      return [...document.querySelectorAll('#thread .msg-tutor')].filter(m => m.getBoundingClientRect().bottom < top - 10).at(-1).dataset.id; })()`);
    learn('meta', 'demo', above);
    await page.waitFor(`document.querySelector('[id="m-${above}"].msg-meta.folded')`);
    await sleep(300);
    same(c, await place(c.id), 'an entry above folding');
    learn('meta', 'demo', above, '--off');
    await page.waitFor(`document.querySelector('[id="m-${above}"]:not(.msg-meta) .msg-body')`);
    await sleep(300);
    same(c, await place(c.id), 'an entry above unfolding');
    // 3. a level change below the window: no move, no pill
    learn('level', 'demo', '4.2', '1', 'scroll test again');
    await page.waitFor(`[...document.querySelectorAll('#thread .sysline')].some(x => /scroll test again/.test(x.textContent))`);
    await sleep(800);
    same(c, await place(c.id), 'a level change below');
    assert(!await page.eval(`document.querySelector('.newpill')`), 'a level change showed the "New message" pill');
  });
  await test('bin/learn meta tags an old exchange (append-only): folded in the thread, out of msgs --skill, the skill and session pages, stats, resume; --off undoes it', async () => {
    const file = path.join(HOME, 'topics/demo/journal/2026-01-08.jsonl'), before = fs.readFileSync(file, 'utf8');
    assert(/^2026-01-08\.13 \[4\.4\]/m.test(learn('msgs', 'demo', '--skill', '4.4')), 'not listed before');
    const yours = async () => { await page.nav(`${BASE}/#/demo/stats`, 900); return Number(await page.waitFor(`[...document.querySelectorAll('.tile')].find(t => /Your messages/.test(t.textContent))?.querySelector('.tile-value span')?.textContent`)); };
    const skillLists = async () => { await page.nav(`${BASE}/#/demo/wiki/skill/4.4`, 900); return page.eval(`[...document.querySelectorAll('.sheet .msgline-id')].some(x => /#13$/.test(x.textContent))`); };
    const n0 = await yours();
    assert(await skillLists(), 'skill page does not list it before');
    const out = learn('meta', 'demo', '2026-01-08.12', '2026-01-08.13');
    assert(/tagged 2026-01-08\.12 \[ask\]/.test(out) && /tagged 2026-01-08\.13 \[tutor\]/.test(out), out);
    assert(fs.readFileSync(file, 'utf8') === before, 'an old journal file was rewritten');
    const tag = journal().at(-1);
    assert(tag.kind === 'tag' && tag.tag === 'meta' && tag.ids.join() === '2026-01-08.12,2026-01-08.13', JSON.stringify(tag));
    assert(/already tagged/.test(learn('meta', 'demo', '2026-01-08.13')), 'tagging twice appends again');
    assert(/is a grade entry/.test((() => { try { learn('meta', 'demo', '2026-01-08.4'); return ''; } catch (e) { return String(e.stderr); } })()), 'tagged a grade');
    assert(!/2026-01-08\.13/.test(learn('msgs', 'demo', '--skill', '4.4')), 'msgs --skill still lists it');
    assert(!/2026-01-08\.1[23] \[/.test(learn('resume', 'demo')), 'resume still shows it');
    assert(/^2026-01-08\.13 \[tutor, app talk\]/m.test(learn('recent', '80', '--topic', 'demo')) && /\(app talk\)/.test(learn('show', '2026-01-08.13')), 'recent/show do not mark it');
    assert(!/KV cache last time/.test(learn('grep', 'KV cache', '--topic', 'demo')), 'grep finds it');
    assert(await yours() === n0 - 1, 'stats still count the tagged ask');
    assert(!await skillLists(), 'the skill page lists it');
    await page.nav(`${BASE}/#/demo/wiki/session/2026-01-08`, 900);
    const sess = await page.eval(`({ has: !!document.querySelector('.sheet [data-id="2026-01-08.13"]'), note: /2 messages about the app not shown/.test(document.querySelector('.sheet').innerText) })`);
    assert(!sess.has && sess.note, 'session page: ' + JSON.stringify(sess));
    // (the earlier of the two: the thread draws back to the message asked for, and how many entries
    // the tests before this one added decides whether a page boundary falls between the two)
    await page.nav(`${BASE}/#/demo/learn/m/2026-01-08.12`, 1500);
    const t = await page.eval(`(() => { const n = document.querySelector('[id="m-2026-01-08.13"]'), q = document.querySelector('[id="m-2026-01-08.12"]');
      return { folded: n.matches('.msg-meta.folded') && q.matches('.msg-meta.folded'), body: !!n.querySelector('.msg-body'), preview: n.querySelector('.meta-preview')?.textContent || '' }; })()`);
    assert(t.folded && !t.body && /^Short version/.test(t.preview), 'thread: ' + JSON.stringify(t));
    await page.click('[id="m-2026-01-08.13"] .meta-fold');
    assert(await page.eval(`!!document.querySelector('[id="m-2026-01-08.13"].msg-meta:not(.folded) .msg-body')`), 'does not unfold');
    await page.shot('meta-folded');
    learn('meta', 'demo', '2026-01-08.12', '2026-01-08.13', '--off');
    assert(/^2026-01-08\.13 \[4\.4\]/m.test(learn('msgs', 'demo', '--skill', '4.4')), '--off did not bring it back');
    await page.waitFor(`document.querySelector('[id="m-2026-01-08.13"]:not(.msg-meta) .msg-body')`);
  });
  await test('glossary sort: newest first by first mention, remembered, in wiki and dock', async () => {
    await page.eval(`localStorage.removeItem('learn:glossarySort')`);
    await page.nav(`${BASE}/#/demo/wiki/glossary`, 900);
    await page.waitFor(`document.querySelectorAll('.gl-row').length > 10`);
    await page.mouse('mouseMoved', 2, 2); await sleep(300);   // no hover card left over from where the pointer last was
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
  await test('glossary filter: ranked by where it matches (name start, inside the name, description), a typo finds the term; wiki and dock', async () => {
    await page.eval(`localStorage.removeItem('learn:glossarySort')`);
    await page.nav(`${BASE}/#/demo/wiki/glossary`, 900);
    await page.waitFor(`document.querySelectorAll('.gl-row').length > 10`);
    const filter = (box, q, SEL, HEAD) => page.eval(`(() => { const i = document.querySelector('${box}'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input'));
      return { names: [...document.querySelectorAll('${SEL}')].map(b => [...b.childNodes].find(n => n.nodeType === 3).textContent.trim()), heads: [...document.querySelectorAll('${HEAD}')].map(x => x.textContent) }; })()`);
    for (const [where, box, SEL, HEAD] of [['wiki', '.sheet input[type=search]', '.sheet .gl-row .gl-name', '.sheet .gl-letter'], ['dock', '#dock .dock-search input', '#dock .gl-item .gl-term', '#dock .gl-letter']]) {
      const r = await filter(box, 'token', SEL, HEAD);
      assert(r.names.slice(0, 3).join() === 'token,tokenizer,special tokens', `${where}: "token" should list token, tokenizer, special tokens first (A–Z put a description match first): ${r.names}`);
      assert(r.heads.join('|') === 'Name starts with it|In the name|In the description' && r.names.indexOf('vocabulary') > 2, `${where}: tiers as sections, description matches last: ${r.heads} / ${r.names}`);
      const typo = await filter(box, 'sofmax', SEL, HEAD);
      assert(typo.names.join() === 'softmax' && typo.heads.join() === 'Similar spelling', `${where}: a typo finds the term: ${JSON.stringify(typo)}`);
      const alias = await filter(box, 'byte', SEL, HEAD);
      assert(alias.names[0] === 'BPE', `${where}: an alias counts as a name: ${alias.names}`);
      assert((await filter(box, 'zzzz', SEL, HEAD)).names.length === 0 && await page.eval(`!!document.querySelector('${where === 'wiki' ? '.sheet' : '#dock'} .empty-row')`), `${where}: no match says so`);
      if (where === 'wiki') { await filter(box, 'token', SEL, HEAD); await page.shot('glossary-filter'); }
      const all = await filter(box, '', SEL, HEAD);
      assert(all.heads[0] === 'A' && all.names.length > 10, `${where}: an empty filter is the A–Z list again`);
    }
  });
  await test('the toolbar button opens the System page on the tab used last: instructions, and changes to the app (saved for the builder, the tutor not interrupted, open items listed); again goes back; the old /tell links still work', async () => {
    const jl = journal().length;
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    await page.eval(`localStorage['learn:tellTab'] = '"instructions"'`);
    await page.click('#feedbackBtn');
    await page.waitFor(`location.hash === '#/demo/system/instructions' && document.activeElement?.id === 'instrBox' && document.querySelector('#feedbackBtn.on') && document.querySelectorAll('.view.system .tab').length === 4`, { timeout: 3000 });
    await page.click('#tellTab-app');
    await page.waitFor(`document.activeElement?.id === 'feedbackBox' && /Save for the builder/.test(document.querySelector('#feedbackSave').textContent)`, { timeout: 3000 });
    await page.type('UI feedback from the box');
    await page.key('Enter', { meta: true });
    await page.waitFor(`document.querySelector('.tell-note.ok')`, { timeout: 3000 });
    await page.waitFor(`[...document.querySelectorAll('.tell-item')].some(i => /UI feedback from the box/.test(i.innerText))`, { timeout: 3000 });
    await page.shot('feedback');
    const box = await page.eval(`(() => { const r = document.querySelector('#feedbackBox').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
    assert(box.w >= 600 && box.h >= 160, 'the feedback box is a real writing surface: ' + JSON.stringify(box));
    const f = fs.readFileSync(path.join(HOME, 'feedback.md'), 'utf8');
    assert(/^- \[ \] \d{4}-\d{2}-\d{2} \(learner, demo · tell\): UI feedback from the box$/m.test(f), f);
    assert(await page.eval(`document.querySelector('#feedbackBox').value === '' && localStorage['learn:draft:feedback'] === '""'`), 'box/draft not cleared');
    assert(journal().length === jl, 'journaled');
    await page.click('#feedbackBtn');
    await page.waitFor(`location.hash === '#/demo/learn'`, { timeout: 3000 });   // back where it came from (and where the light-theme test reloads)
  });
  await test('System page, Status: the tutor session and its light, tokens from the transcript, delivery (all picked up, none twice), reply times, days, sessions, jobs, server; what is not measured says so; settings switch the theme', async () => {
    // the numbers (GET /api/system) against what this run did
    const sent = fs.readFileSync(path.join(HOME, 'state/server.log'), 'utf8').split('\n').filter(l => / send \S+ \S+ \w+.*: queued/.test(l)).length;
    const y = await api('/api/system?topic=demo');
    assert(y.delivery.today.sent === sent && sent > 5 && y.delivery.week.sent === sent, `sent ${y.delivery.today.sent}, the log has ${sent}`);
    assert(y.delivery.today.picked <= sent && y.delivery.today.picked >= sent * 0.7 && y.delivery.today.pickMedianMs >= 0, 'picked: ' + JSON.stringify(y.delivery.today));
    assert(y.delivery.today.again >= 1, 'the messages this run delivered a second time are counted: ' + JSON.stringify(y.delivery.today));
    assert(y.delivery.today.watchdog >= 1, 'the watchdog restarts of this run are counted: ' + JSON.stringify(y.delivery.today));
    assert(y.tutor.session && y.tutor.limits.handoffTokens === 150000 && y.tutor.limits.warnAt === 0.7 && y.tutor.limits.nowAt === 0.9 && y.tutor.health, 'tutor: ' + JSON.stringify(y.tutor));
    const today = y.days.find(d => d.d === new Date().toLocaleDateString('sv'));
    assert(today && today.sent >= 5 && today.replies >= 5 && today.handoffs >= 1 && today.waitN >= 3, 'today: ' + JSON.stringify(y.days));
    assert(y.latency.topic === 'demo' && y.latency.today.n >= 3 && y.latency.today.median >= 0, 'latency: ' + JSON.stringify(y.latency));
    assert(y.sessions.list.length >= 2 && y.sessions.list.filter(r => r.current).length === 1 && y.sessions.list.some(r => r.tokens > 100000 && !r.current), 'sessions with the context they ended at: ' + JSON.stringify(y.sessions));
    assert(y.jobs.tokens === null && Array.isArray(y.jobs.history), 'jobs');
    assert(/^[0-9a-f]{7,}$/.test(y.server.head.hash) && y.server.pid > 0 && y.server.uptimeS >= 0 && y.server.clients >= 1, 'server: ' + JSON.stringify(y.server));
    // tokens: summed over the transcript, each API call once
    const sid = JSON.parse(fs.readFileSync(path.join(HOME, 'state/session.json'), 'utf8')).id;
    const tfile = path.join(HOME, 'claude/projects/fake', sid + '.jsonl');
    const lines = fs.existsSync(tfile) ? fs.readFileSync(tfile, 'utf8').split('\n').filter(Boolean).length : 0;
    assert(lines ? y.tutor.session.usage.turns === lines && y.tutor.session.usage.output === 100 * lines : y.tutor.session.usage === null, 'usage: ' + JSON.stringify(y.tutor.session.usage) + ' lines ' + lines);
    const dup = execFileSync(process.execPath, ['-e', `const fs = require('fs'), os = require('os'), path = require('path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-usage-')); process.env.CLAUDE_CONFIG_DIR = dir;
      fs.mkdirSync(path.join(dir, 'projects/p/s1/subagents'), { recursive: true });
      const line = (id, out) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10, output_tokens: out } } }) + '\\n';
      fs.writeFileSync(path.join(dir, 'projects/p/s1.jsonl'), line('a', 5) + line('a', 50) + '{"type":"user"}\\n' + line('b', 7) + 'not json "usage"\\n');
      fs.writeFileSync(path.join(dir, 'projects/p/s1/subagents/x.jsonl'), line('c', 3));
      const A = require('./app/agent').agent(); const u = A.usage('s1');
      fs.appendFileSync(path.join(dir, 'projects/p/s1.jsonl'), line('d', 1));
      console.log(JSON.stringify([u, A.usage('s1').output, A.usage('nope')])); fs.rmSync(dir, { recursive: true });`], { env: ENV, cwd: CODE, encoding: 'utf8' });
    assert(dup.trim() === JSON.stringify([{ turns: 2, input: 2, cacheWrite: 20, cacheRead: 2000, output: 57, partial: false, subagents: { n: 1, turns: 1, input: 1, cacheWrite: 10, cacheRead: 1000, output: 3 } }, 58, null]), 'usage: ' + dup);
    // the page
    await page.nav(`${BASE}/#/demo/system/status`, 1200);
    const t = await page.waitFor(`document.querySelector('#sysDelivery') && document.querySelector('.sys-page').innerText`, { timeout: 5000 });
    for (const want of [/TUTOR/i, /Context/, /Tokens, this session/, /DELIVERY/i, new RegExp(`Today: ${sent} messages sent`), /Handed over a second time/, /REPLY TIMES/i, /RECENT DAYS/i, /TUTOR SESSIONS/i, /BACKGROUND JOBS/i, /SERVER/i, y.server.startHead.hash])
      assert(new RegExp(want).test(t), `the page lacks ${want}: ` + t.slice(0, 300));
    assert(await page.eval(`document.querySelector('#sysLight').dataset.level === ${JSON.stringify((await api('/api/status')).health.level)}`), 'the light on the page');
    assert(await page.eval(`document.documentElement.scrollWidth <= innerWidth + 1`), 'horizontal overflow');
    await page.shot('system-status');
    // background jobs: runs are listed with how long they took; what they used is "not measured"
    if (y.jobs.history.length) assert(await page.eval(`[...document.querySelectorAll('.sys-panel')].find(p => /Background jobs/i.test(p.querySelector('.sys-h').textContent)).querySelectorAll('.not-measured').length`) === y.jobs.history.length, 'job tokens not marked');
    // it follows what happens: a message sent now is counted without a reload
    await api('/api/send', { topic: 'demo', kind: 'ask', text: 'counted on the system page' });
    await page.waitFor(`/Today: ${sent + 1} messages sent/.test(document.querySelector('#sysDelivery').innerText)`, { timeout: 20000 });
    // a link from before the page was called System, and the tab the button remembers
    await page.nav(`${BASE}/#/demo/tell/app`, 900);
    await page.waitFor(`document.querySelector('#feedbackBox') && document.querySelector('#tellTab-app.on') && document.querySelector('#feedbackBtn.on')`, { timeout: 3000 });
    // settings: the theme, as buttons
    await page.nav(`${BASE}/#/demo/system/settings`, 900);
    await page.eval(`document.querySelector('#setTheme button[data-v="dark"]').click()`);
    await page.waitFor(`document.documentElement.dataset.theme === 'dark' && document.querySelector('#setTheme button.on').dataset.v === 'dark' && localStorage['learn:theme'] === '"dark"'`, { timeout: 2000 });
    await page.nav(`${BASE}/#/demo/system/status`, 1200);
    await page.waitFor(`document.querySelector('#sysDelivery')`, { timeout: 5000 });
    await page.shot('system-status-dark');
    await page.size(1100, 800);
    await sleep(300);
    assert(await page.eval(`document.documentElement.scrollWidth <= innerWidth + 1`), 'horizontal overflow at 1100px');
    await page.shot('system-status-narrow');
    await page.size(1400, 900);
    await page.nav(`${BASE}/#/demo/system/settings`, 900);
    await page.eval(`document.querySelector('#setTheme button[data-v="auto"]').click()`);
    await page.waitFor(`!document.documentElement.dataset.theme && localStorage['learn:theme'] === '"auto"'`, { timeout: 2000 });
    await page.eval(`localStorage['learn:tellTab'] = '"instructions"'`);
    await page.nav(`${BASE}/#/demo/learn`, 900);
  });
  await test('formulas: keyed parts are coloured without hovering; tables are centred', async () => {
    // (a formula of its own: the thread draws the latest 60 entries, and the fixture's formulas
    // scroll out of that as earlier tests add messages)
    execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--force'], { env: ENV, stdio: 'pipe', input: 'A keyed formula: $\\k{sq}{x^2} + \\k{one}{1}$, where {{the square|sq}} grows faster.', encoding: 'utf8' });
    await page.nav(`${BASE}/#/demo/learn`, 1000);
    const r = await page.eval(`(() => {
      const k = document.querySelector('.msg-body .katex [data-k]'), fg = getComputedStyle(document.querySelector('.msg-body')).color;
      const t = [...document.querySelectorAll('.msg-body table')].find(t => t.offsetWidth < t.parentElement.offsetWidth - 40);
      return { keyed: !!k, colored: k && getComputedStyle(k).color !== fg,
        centred: !t || Math.abs((t.getBoundingClientRect().left - t.parentElement.getBoundingClientRect().left) - (t.parentElement.getBoundingClientRect().right - t.getBoundingClientRect().right)) < 4 }; })()`);
    assert(r.keyed && r.colored && r.centred, JSON.stringify(r));
  });
  await test('post refuses a viz block that would show an error box (unknown type, syntax error, d3 redeclared); check lists old ones', async () => {
    const before = journal().length;
    const tryPost = text => spawnSync(process.execPath, [BIN, 'post', '--topic', 'demo'], { env: ENV, input: text, encoding: 'utf8' });
    const a = tryPost('Look:\n\n```viz js\nconst d3 = ctx.d3;\nd3.select(el).append("svg");\n```');
    assert(a.status === 1 && /viz js \(line 4 of the message\): SyntaxError: Identifier 'd3' has already been declared \(el, ctx and d3 are already in scope/.test(a.stderr), 'redeclared d3: ' + a.stderr);
    const b = tryPost('```viz bars\n{ items: [{ label: "a", value: 1 }\n```\n\n```viz sankey\n{}\n```\n\n```viz js\nconst s = "open;\n```');
    assert(/viz bars \(line 3/.test(b.stderr) && /unknown viz type "sankey"/.test(b.stderr) && /viz js \(line 10.*Invalid or unexpected token/.test(b.stderr), 'bars/unknown/js: ' + b.stderr);
    assert(journal().length === before, 'a broken viz was posted');
    assert(tryPost('Fine:\n\n```viz js\nel.append(ctx.slider("x", 0, 1, 0.5, 0.1, () => {}));\n```\n\n`viz js` in code is not a block.').status === 0, 'a good viz refused');
    const forced = spawnSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--force', '--meta'], { env: ENV, input: '```viz js\nlet el = 1;\n```', encoding: 'utf8' });
    assert(forced.status === 0, '--force: ' + forced.stderr);
    assert(/viz js shows an error box \(line 2\): SyntaxError: Identifier 'el'/.test(learn('check', 'demo')), 'check lists it');
  });
  await test('msg: hover preview shows a drawing as a placeholder, never its code or an error; viz js marker ids are scoped per drawing', async () => {
    const draw = color => ['```viz js', 'const svg = d3.select(el).append("svg").attr("width", 120).attr("height", 30);',
      `svg.append("defs").append("marker").attr("id", "ah").attr("viewBox", "0 0 10 10").attr("refX", 10).attr("refY", 5).attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto").append("path").attr("d", "M0,0L10,5L0,10z").attr("fill", "${color}");`,
      `svg.append("line").attr("x1", 5).attr("y1", 15).attr("x2", 110).attr("y2", 15).attr("stroke", "${color}").attr("marker-end", "url(#ah)");`,
      'el.dataset.uid = ctx.uid("ah");', '```'].join('\n');
    // A: the drawing sits where a 1400-character cut used to land, inside its code
    post('demo', 'Long one.\n\n' + 'word '.repeat(270) + '\n\n' + draw('#c33') + '\n\nAfter the drawing.');
    const A = lastTutor('demo').id;
    post('demo', 'Short one.\n\n' + draw('#36c') + '\n\nThe end.');
    const B = lastTutor('demo').id;
    post('demo', `See [the long one](msg:${A}) and [the short one](msg:${B}).`);
    const C = lastTutor('demo').id;
    await page.nav(`${BASE}/#/demo/learn`, 1200);
    await page.waitFor(`document.querySelector('[id="m-${C}"] .ref-msg')`, { timeout: 4000 });
    const card = async i => {
      await page.mouse('mouseMoved', 5, 5); await sleep(400);
      await page.eval(`document.querySelectorAll('[id="m-${C}"] .ref-msg')[${i}].id = 'zz-pv${i}'`);
      await page.hover(`#zz-pv${i}`, 700);
      return page.waitFor(`(() => { const c = document.querySelector('.hovercard.on'); return c && { ph: c.querySelectorAll('.viz-ph').length, err: c.querySelectorAll('.viz-error, .viz-err-msg').length,
        viz: c.querySelectorAll('.viz').length, code: /viz js|d3\\.select|Invalid or unexpected/.test(c.textContent), end: /…\\s*Click/.test(c.textContent) }; })()`, { timeout: 2000 });
    };
    const a = await card(0), b = await card(1);
    assert(!a.err && !a.viz && !a.code && a.end, 'long preview: ' + JSON.stringify(a));
    assert(b.ph === 1 && !b.err && !b.viz && !b.code, 'short preview: ' + JSON.stringify(b));
    await page.shot('msg-preview-drawing');
    await page.mouse('mouseMoved', 5, 5); await sleep(400);
    const ids = await page.eval(`[${JSON.stringify(A)}, ${JSON.stringify(B)}].map(id => { const v = document.querySelector('[id="m-' + id + '"] .viz-js'); const mk = v.querySelector('marker');
      return { marker: mk.id, ref: v.querySelector('line').getAttribute('marker-end'), uid: v.dataset.uid }; })`);
    assert(ids[0].marker !== ids[1].marker && ids.every(x => x.ref === `url(#${x.marker})` && x.uid === x.marker && /^ah-/.test(x.marker)), 'marker ids: ' + JSON.stringify(ids));
  });
  await test('aside callout: off the main line, drawn smaller and dimmed, with its own label when given', async () => {
    post('cells', ['The membrane keeps the inside in.', '', ':::aside', 'Robert Hooke named cells after the small rooms of monks.', ':::', '', ':::aside A number', 'About 37 trillion of them.', ':::', '', 'Back on the main line.'].join('\n'));
    const id = lastTutor('cells').id;
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const r = await page.waitFor(`(() => { const m = document.querySelector('[id="m-${id}"] .msg-body'), a = m && [...m.querySelectorAll('.callout-aside')]; if (!a || a.length < 2) return null;
      const px = n => parseFloat(getComputedStyle(n).fontSize);
      return { labels: a.map(x => x.querySelector('.callout-label').textContent), smaller: px(a[0].querySelector('.callout-body')) < px(m.querySelector(':scope > p')),
        dimmed: getComputedStyle(a[0].querySelector('.callout-body')).color !== getComputedStyle(m.querySelector(':scope > p')).color, raw: /:::/.test(m.textContent) }; })()`, { timeout: 5000 });
    assert(r.labels.join('|') === 'Aside|A number' && r.smaller && r.dimmed && !r.raw, JSON.stringify(r));
    await page.eval(`document.querySelector('[id="m-${id}"]').scrollIntoView({ block: 'center' })`);
    await page.shot('aside');
  });
  await test('sidebar skills: the name gets the row (thin indent, no fold slot on sub-skills); a chapter\'s progress is a thin bar under its title', async () => {
    await page.nav(`${BASE}/#/demo/learn`, 900);
    const r = await page.waitFor(`(() => { const p = document.querySelector('#left .trow.parent'), c = document.querySelector('#left .trow.child'); if (!p || !c) return null;
      const x = (row, sel) => row.querySelector(sel).getBoundingClientRect(), bar = p.querySelector('.meter.under')?.getBoundingClientRect();
      return { indent: x(c, '.name').left - x(p, '.name').left, nameShare: x(c, '.name').width / c.getBoundingClientRect().width, tw: !!c.querySelector('.tw'),
        barBelow: bar && bar.top >= x(p, '.name').bottom - 4, barH: bar?.height, barW: bar && bar.width / p.getBoundingClientRect().width, inline: !!p.querySelector('.right .meter') }; })()`);
    assert(r.indent > 0 && r.indent <= 24 && r.nameShare > 0.7 && !r.tw, 'sub-skill rows: ' + JSON.stringify(r));
    assert(r.barBelow && r.barH <= 4 && r.barW > 0.8 && !r.inline, 'chapter bar: ' + JSON.stringify(r));
  });
  await test('grading names its message: --grade-of grades an answer sent from the Ask box or in the other thread and closes the right question; a graded answer is not silently graded again', async () => {
    // the learner's messages, written straight into the journal (no tutor listens on this topic)
    const say = entry => JSON.parse(execFileSync(process.execPath, ['-e', `const S = require(${JSON.stringify(path.join(CODE, 'app', 'store.js'))}); console.log(JSON.stringify(S.appendJournal('cells', [JSON.parse(process.argv[1])])[0]))`, JSON.stringify({ role: 'user', ...entry })], { env: ENV, encoding: 'utf8' }));
    const run = (input, ...a) => spawnSync(process.execPath, [BIN, 'post', '--topic', 'cells', ...a], { env: ENV, input, encoding: 'utf8' });
    const jl = () => fs.readdirSync(path.join(HOME, 'topics/cells/journal')).sort().flatMap(f => fs.readFileSync(path.join(HOME, 'topics/cells/journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    const q = text => { const r = run(`${text}\n\n:::question\n${text} question?\n:::`); assert(r.status === 0, r.stderr); return jl().filter(e => e.role === 'tutor' && e.question).at(-1); };
    // one thread: answered properly, graded; then the next question is answered from the Ask box
    const q0 = q('Grade test zero');
    const a0 = say({ kind: 'answer', text: 'a proper answer', replyTo: q0.id });
    assert(run('', '--grade', 'wrong').status === 0 && jl().at(-1).target === a0.id, 'plain --grade grades the latest answer');
    assert(run('', '--grade', 'partial').status === 0 && jl().at(-1).target === a0.id, 'nothing from the learner since: the tutor can correct its verdict');
    const q1 = q('Grade test one');
    const ask = say({ kind: 'ask', text: 'my answer, typed in the Ask box' });
    assert(learn('pending', 'cells').startsWith(q1.id), 'an ask leaves the question open');
    const again = run('Right.', '--grade', 'correct');
    assert(again.status === 1 && /already has a grade \(partial\)/.test(again.stderr) && again.stderr.includes(`${ask.id} [ask]`) && /--grade-of/.test(again.stderr), 'a graded answer was graded again: ' + again.stderr + again.stdout);
    assert(/not a message from the learner/.test(run('', '--grade', 'correct', '--grade-of', q1.id).stderr) && /no message/.test(run('', '--grade', 'correct', '--grade-of', '2020-01-01.1').stderr), '--grade-of takes only the learner\'s messages');
    const ok = run('Right.', '--grade', 'correct', '--grade-of', ask.id);
    const g1 = jl().find(e => e.kind === 'grade' && e.target === ask.id);
    assert(ok.status === 0 && g1?.questionId === q1.id && ok.stdout.includes(`correct → ${ask.id}`), ok.stderr + ok.stdout);
    assert(/no pending question/.test(learn('pending', 'cells')), 'the grade of an ask closes the question it answered: ' + learn('pending', 'cells'));
    // two threads: an answer sent in thread a that was for thread b's question
    learn('track', 'cells', 'open', 'Thread one', 'Thread two');
    try {
      const mk = (t, text) => { const r = run(`${text}\n\n:::question\n${text}?\n:::`, '--track', t); assert(r.status === 0, r.stderr); return jl().filter(e => e.question).at(-1); };
      const qa = mk('a', 'Question of thread a'), qb = mk('b', 'Question of thread b');
      const stray = say({ kind: 'answer', text: 'this answers b', track: 'a', replyTo: qa.id });
      assert(/no answer to grade in thread b.*--grade-of/s.test(run('', '--grade', 'wrong', '--track', 'b').stderr), 'hint for an answer in the other thread');
      const r = run('', '--grade', 'wrong', '--grade-of', stray.id, '--track', 'b');
      assert(r.status === 0 && jl().at(-1).questionId === qb.id && jl().at(-1).track === 'b', r.stderr + JSON.stringify(jl().at(-1)));
      const pend = learn('pending', 'cells');
      assert(pend.includes(qa.id) && !pend.includes(qb.id) && /thread b[^\n]*──\n\(no pending question\)/.test(pend), 'b\'s question closed, a\'s open again: ' + pend);
    } finally { learn('track', 'cells', 'close'); }
    // the learner's own messages: terms typed in lower case still open their cards
    const low = say({ kind: 'ask', text: 'so dna polymerase works inside the nucleus' });
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const terms = await page.waitFor(`(() => { const t = [...document.querySelectorAll('[id="m-${low.id}"] .term')].map(x => x.dataset.term); return t.length ? t : null; })()`, { timeout: 6000 });
    assert(terms.includes('DNA polymerase') && terms.includes('nucleus'), 'lower-case term in the learner\'s message: ' + terms);
    assert(run('Noted.').status === 0, 'reply, so no unanswered message is left behind in this topic');
  });
  await test('terms in the learner\'s messages: capitals don\'t count where that is safe (names, plain acronyms), and do where a word would match', async () => {
    const { termMatcher } = await import(path.join(CODE, 'web/js/terms.js'));
    const G = ['DNA', 'Golgi apparatus', 'TIM', 'ZeRO', 'A site', 'W_K'].map(term => ({ term, aliases: term === 'Golgi apparatus' ? ['Golgi'] : [] }));
    const found = (text, o) => termMatcher(G, o).find(text).map(h => h.text).join();
    assert(found('the golgi and dna, DNAs too') === 'DNAs', 'strict (the tutor\'s text): ' + found('the golgi and dna, DNAs too'));
    assert(found('the golgi and dna, DNAs too', { loose: true }) === 'golgi,dna,DNAs', 'loose: ' + found('the golgi and dna, DNAs too', { loose: true }));
    assert(found('three times zero on a site with w_k', { loose: true }) === '', 'words that only look like terms: ' + found('three times zero on a site with w_k', { loose: true }));
  });
  await test('post refuses links to grade entries and unknown skills; --expect stores the rubric', async () => {
    const grade = journal().find(e => e.kind === 'grade');
    const bad = (() => { try { execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo'], { env: ENV, stdio: 'pipe', input: `see [this](msg:${grade.id})`, encoding: 'utf8' }); return ''; } catch (e) { return String(e.stderr); } })();
    assert(/grade entry/.test(bad) && /not posted/.test(bad), bad);
    assert(!journal().some(e => e.text === `see [this](msg:${grade.id})`), 'was posted anyway');
    execFileSync(process.execPath, [BIN, 'post', '--topic', 'demo', '--skill', '4.2', '--expect', 'heads split d_model'], { env: ENV, stdio: 'pipe', input: 'Rubric test.\n\n:::question\nWhy several heads?\n:::', encoding: 'utf8' });
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
    await page.click('#composer .mode-ask');
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
  await test("I'm going away: one button; a planner decides the jobs and briefs them; the plan shows while it runs, then the reports", async () => {
    await api('/api/feedback', { text: 'something for the builder', topic: 'demo', view: 'learn' });
    await page.nav(`${BASE}/#/demo/learn`, 900);
    await page.click('#awayBtn');
    await page.waitFor(`document.querySelector('#awayGo') && document.querySelector('.away-waiting')`, { timeout: 3000 });
    assert(await page.eval(`!document.querySelector('.away-pop input[type=checkbox]')`), 'no job checkboxes');
    assert(/open feedback item/.test(await page.eval(`document.querySelector('.away-waiting').innerText`)), 'shows what is waiting');
    await page.shot('away-popover');
    fs.writeFileSync(path.join(HOME, 'state/fake-job-seconds'), '2');
    await page.click('#awayGo');
    await page.waitFor(`document.querySelector('.away-step.now') && /Write wiki pages|Wiki/i.test(document.querySelector('.away-step.now').innerText)`, { timeout: 12000 });
    assert(/fake: terms without pages/.test(await page.eval(`document.querySelector('.away-plan').innerText`)), 'the plan shows why');
    await page.shot('away-running');
    fs.rmSync(path.join(HOME, 'state/fake-job-seconds'));
    await until(() => { try { return fs.readdirSync(path.join(HOME, 'reports')).some(f => f.endsWith('-wiki.md')); } catch { return false; } }, 'report written', 20000);
    const reps = fs.readdirSync(path.join(HOME, 'reports')).sort();
    assert(reps.some(f => f.endsWith('-plan.md')) && /# Fake wiki report/.test(fs.readFileSync(path.join(HOME, 'reports', reps.find(f => f.endsWith('-wiki.md'))), 'utf8')), reps.join());
    const planPrompt = fs.readFileSync(path.join(HOME, 'state/fake-job-plan.txt'), 'utf8'), wikiPrompt = fs.readFileSync(path.join(HOME, 'state/fake-job-wiki.txt'), 'utf8');
    assert(/## Snapshot[\s\S]*## Feedback queue: \d+ open[\s\S]*## Topic demo[\s\S]*## Jobs you can schedule[\s\S]*- task: /.test(planPrompt), planPrompt.slice(-1500));
    assert(/## Why this run[\s\S]*Why: fake: terms without pages\nBrief: FAKE-BRIEF/.test(wikiPrompt) && /^# Wiki writer/m.test(wikiPrompt), wikiPrompt.slice(0, 2500));
    await page.waitFor(`document.querySelector('#awayBtn .badge-n') || document.querySelector('.away-rep.new')`, { timeout: 6000 });
    await page.eval(`document.querySelector('.away-rep.new')?.click() || (document.querySelector('#awayBtn').click(), 0)`);
    await page.waitFor(`document.querySelector('.away-rep.new')?.click() ?? true`, { timeout: 2000 }).catch(() => {});
    await page.waitFor(`/Fake (wiki|plan) report/.test(document.querySelector('#dock')?.innerText || '')`, { timeout: 4000 });
    await page.key('Escape');
    const st = await api('/api/jobs');
    assert(!st.running && st.history[0].name === 'wiki' && st.history[0].exit === 0 && st.history[1].name === 'plan', JSON.stringify(st.history.slice(0, 2)));
    assert(!sessions().filter(x => x.args[0] === '-p').length, 'headless job was logged as a tutor session');
    // the CLI still runs named jobs without planning; a plan the runner can't read falls back to the obvious work
    const parse = t => execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(CODE, 'app/jobs.js'))}).parsePlan(${JSON.stringify(t)})))`], { env: ENV, encoding: 'utf8' });
    assert(parse('# x\n```json\n{"plan":[{"job":"builder","why":"w"},{"job":"nope"}]}\n```') === '[{"job":"builder","why":"w","brief":""}]', 'parsePlan keeps known jobs');
    assert(parse('no plan') === 'null' && parse('```json\n{bad\n```') === 'null', 'unreadable plan');
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
  await test('messages waiting in two topics at once: each is answered, the sessions don\'t hand off to each other forever', async () => {
    const before = sessions().length;
    const jt = t => fs.readdirSync(path.join(HOME, 'topics', t, 'journal')).flatMap(f => fs.readFileSync(path.join(HOME, 'topics', t, 'journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    await api('/api/send', { topic: 'demo', kind: 'ask', text: 'two topics, first' });
    await api('/api/send', { topic: 'cells', kind: 'ask', text: 'two topics, second' });
    await until(() => jt('demo').some(e => e.role === 'tutor' && /Echo \(ask\): two topics, first/.test(e.text || '')) && jt('cells').some(e => e.role === 'tutor' && /Echo \(ask\): two topics, second/.test(e.text || '')), 'both topics answered', 40000);
    await sleep(2500);   // a ping-pong would keep starting sessions
    const started = sessions().length - before;
    await sleep(2500);
    assert(sessions().length - before === started && started <= 3, `sessions keep starting: ${started} → ${sessions().length - before}`);
    await until(async () => (await api('/api/status')).phase === 'listening', 'tutor listening again', 15000);
  });
  await test('corrections in place: post --corrects appends an entry, the message changes where it stands, marked, with the earlier version one click away; CLI readers see the corrected text', async () => {
    const run = (input, ...a) => spawnSync(process.execPath, [BIN, 'post', '--topic', 'cells', ...a], { env: ENV, input, encoding: 'utf8' });
    const file = () => { const d = path.join(HOME, 'topics/cells/journal'); return fs.readdirSync(d).sort().map(f => fs.readFileSync(path.join(d, f), 'utf8')).join(''); };
    const jl = () => file().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert(run('Mitosis has FIVEPHASES in this telling.\n\n:::question\nName the FIVEPHASES?\n:::', '--expect', 'old rubric').status === 0, 'post');
    const m = jl().at(-1);
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const sel = `[id="m-${m.id}"]`;
    assert(await page.eval(`document.querySelector('${sel} .msg-body').innerText.includes('FIVEPHASES') && !document.querySelector('${sel} .badge-corrected')`), 'the message as posted');
    // refusals: no note, the same text, the learner's message, a grade entry
    const mine = JSON.parse(execFileSync(process.execPath, ['-e', `const S = require(${JSON.stringify(path.join(CODE, 'app', 'store.js'))}); console.log(JSON.stringify(S.appendJournal('cells', [{ role: 'user', kind: 'ask', text: 'the learner\\'s own words' }])[0]))`], { env: ENV, encoding: 'utf8' }));
    const before = file();
    assert(/say what changed/.test(run('Mitosis has FOURPHASES.', '--corrects', m.id).stderr), 'a correction needs a note');
    assert(/already has/.test(run(m.text, '--corrects', m.id, '--note', 'x').stderr), 'same text');
    assert(/only your own messages/.test(run('rewritten', '--corrects', mine.id, '--note', 'x').stderr), 'the learner\'s words are never rewritten');
    assert(/no --grade/.test(run('x', '--corrects', m.id, '--note', 'x', '--grade', 'correct').stderr), 'no grade with a correction');
    assert(file() === before, 'a refused correction wrote something');
    const ok = run('Mitosis has FOURPHASES in this telling.\n\n:::question\nName the FOURPHASES?\n:::', '--corrects', m.id, '--note', 'four phases, not five', '--expect', 'new rubric');
    assert(ok.status === 0 && ok.stdout.includes(`corrected ${m.id} in place`), ok.stderr + ok.stdout);
    // append-only: every earlier line is untouched, one "correction" line was added
    assert(file().startsWith(before) && jl().length === before.split('\n').filter(Boolean).length + 1 && jl().at(-1).kind === 'correction' && jl().at(-1).target === m.id, 'journal not append-only');
    // the open page: same place, new text, marked, with the note
    await page.waitFor(`document.querySelector('${sel} .badge-corrected')`);
    const now = await page.eval(`(() => { const n = document.querySelector('${sel}'); return { body: n.querySelector('.msg-body').innerText, line: n.querySelector('.corrected-line').innerText, n: document.querySelectorAll('.thread .msg').length, box: document.querySelector('#composer .box-q')?.innerText || '' }; })()`);
    assert(now.body.includes('FOURPHASES') && !now.body.includes('FIVEPHASES') && /four phases, not five/.test(now.line), 'corrected in place: ' + JSON.stringify(now));
    assert(now.box.includes('FOURPHASES'), 'the question above the answer box is the corrected one: ' + now.box);
    await page.eval(`document.querySelector('${sel}').scrollIntoView({ block: 'center' })`); await sleep(300);
    await page.shot('corrected');
    await page.click(`${sel} .prev-version`);
    const prev = await page.eval(`(() => { const n = document.querySelector('${sel}'); return { body: n.querySelector('.msg-body').innerText, cls: n.className, line: n.querySelector('.corrected-line').innerText }; })()`);
    assert(prev.body.includes('FIVEPHASES') && /showing-prev/.test(prev.cls) && /Earlier version/.test(prev.line), 'the earlier version: ' + JSON.stringify(prev));
    await page.shot('corrected-earlier');
    await page.click(`${sel} .cur-version`);
    assert(await page.eval(`document.querySelector('${sel} .msg-body').innerText.includes('FOURPHASES')`), 'back to the corrected version');
    // a reload gets the same from the server
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    assert(await page.eval(`document.querySelector('${sel} .msg-body').innerText.includes('FOURPHASES') && !!document.querySelector('${sel} .badge-corrected') && document.querySelectorAll('.thread .msg').length === ${now.n}`), 'after a reload');
    // CLI readers: the corrected text, once; the earlier one on request; the new rubric
    const show = learn('show', '--topic', 'cells', m.id);
    assert(show.includes('FOURPHASES') && !show.includes('FIVEPHASES') && /corrected .*four phases, not five/.test(show) && show.includes('new rubric'), show);
    assert(learn('show', '--topic', 'cells', m.id, '--previous').includes('FIVEPHASES'), 'show --previous');
    assert(learn('grep', 'FOURPHASES', '--topic', 'cells').trim().split('\n').length === 1 && !learn('grep', 'FIVEPHASES', '--topic', 'cells').trim(), 'grep reads the corrected text, once');
    const pend = learn('pending', 'cells');
    assert(pend.startsWith(m.id) && pend.includes('FOURPHASES') && pend.includes('new rubric'), 'pending: ' + pend);
    assert(/\[correction\] of /.test(learn('recent', '3', '--topic', 'cells')), 'recent lists the correction');
    // a second correction keeps both earlier versions
    assert(run('Mitosis has FOURPHASES, plus cytokinesis.', '--corrects', m.id, '--note', 'cytokinesis added').status === 0, 'second correction');
    await page.waitFor(`/Earlier versions \\(2\\)/.test(document.querySelector('${sel} .prev-version')?.innerText || '')`);
    assert(!learn('pending', 'cells').includes(m.id), 'a correction that drops the :::question takes it out of the open questions');
    assert(/cells: ok/.test(learn('check', 'cells')), 'check');
  });
  await test('review queue: post --queue keeps several questions open in thread b, answered in any order from the strip above the box, each graded on its own; the pending question is untouched', async () => {
    const say = entry => JSON.parse(execFileSync(process.execPath, ['-e', `const S = require(${JSON.stringify(path.join(CODE, 'app', 'store.js'))}); console.log(JSON.stringify(S.appendJournal('cells', [JSON.parse(process.argv[1])])[0]))`, JSON.stringify({ role: 'user', ...entry })], { env: ENV, encoding: 'utf8' }));
    const run = (input, ...a) => spawnSync(process.execPath, [BIN, 'post', '--topic', 'cells', ...a], { env: ENV, input, encoding: 'utf8' });
    const jl = () => fs.readdirSync(path.join(HOME, 'topics/cells/journal')).sort().flatMap(f => fs.readFileSync(path.join(HOME, 'topics/cells/journal', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    const Q = name => `${name} intro.\n\n:::question\n${name} QUESTION?\n:::`;
    assert(/only one thread is open/.test(run(Q('Early'), '--queue', '--expect', 'x').stderr), 'the queue needs the second thread');
    learn('track', 'cells', 'open', 'Lesson thread', 'Review thread');
    try {
      assert(run(Q('Lesson-a'), '--track', 'a', '--expect', 'ra').status === 0 && run(Q('Lesson-b'), '--track', 'b', '--expect', 'rb').status === 0, 'the threads\' own questions');
      const pa = jl().filter(e => e.question).at(-2), pb = jl().filter(e => e.question).at(-1);
      assert(/needs a :::question/.test(run('No question here.', '--queue', '--expect', 'x').stderr) && /--expect/.test(run(Q('NoRubric'), '--queue').stderr), 'a queued question needs a question block and a rubric');
      const r1 = run(Q('Queued-one'), '--queue', '--expect', 'rubric one'), r2 = run(Q('Queued-two'), '--queue', '--expect', 'rubric two', '--skill', '1.1');
      assert(r1.status === 0 && r2.status === 0 && /review queue, thread b: 2 open/.test(r2.stdout), r1.stderr + r2.stderr + r2.stdout);
      const [q1, q2] = jl().filter(e => e.queue);
      assert(q1.track === 'b' && q2.queue === true, 'queued in thread b: ' + JSON.stringify(q1));
      const pend = learn('pending', 'cells');
      assert(pend.includes(pa.id) && pend.includes(pb.id) && (pend.match(/review queue, thread b/g) || []).length === 2 && pend.includes('rubric two'), 'pending lists each thread\'s question and the queue: ' + pend);
      assert(/Review queue: 2 open/.test(learn('resume', 'cells')), 'resume shows the queue');
      // the UI: thread b's tab counts them, the strip above the box picks which one the box answers
      await page.nav(`${BASE}/#/cells/learn`, 800);
      await page.eval(`localStorage['learn:track:cells'] = '"b"'`);
      await page.nav(`${BASE}/#/cells/learn`, 1200);
      const ui = () => page.eval(`(() => ({ picks: [...document.querySelectorAll('.q-strip .q-pick')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), box: document.querySelector('#composer .box-q')?.innerText || '',
        tab: document.querySelector('.track-tab.on .track-st')?.innerText || '', pend: document.querySelector('.msg.pending-q')?.dataset.id || null,
        answerThis: [...document.querySelectorAll('.answer-this')].filter(b => !b.hidden).map(b => b.dataset.q), tags: [...document.querySelectorAll('.queue-tag')].map(b => b.textContent) }))()`);
      let u = await ui();
      assert(u.picks.join() === 'Lesson*,Review 1,Review 2' && u.box.includes('Lesson-b QUESTION') && /3 questions/.test(u.tab) && u.pend === pb.id, 'three open questions, the lesson one first: ' + JSON.stringify(u));
      assert(u.answerThis.join() === [q1.id, q2.id].join() && u.tags.join() === 'Review question,Review question', 'queued messages are marked and offer "Answer this": ' + JSON.stringify(u));
      await page.click(`.q-pick[data-q="${q2.id}"]`);
      u = await ui();
      assert(u.picks.join() === 'Lesson,Review 1,Review 2*' && u.box.includes('Queued-two QUESTION') && u.pend === q2.id, 'picked the second queued question: ' + JSON.stringify(u));
      // a draft belongs to its question
      await page.click('#answerBox'); await page.type('half an answer to two'); await sleep(200);
      await page.click(`.q-pick[data-q="${q1.id}"]`);
      assert(await page.eval(`document.querySelector('#answerBox').value === '' && /✎/.test(document.querySelector('.q-pick[data-q="${q2.id}"]').textContent)`), 'the draft stays with its question');
      await page.shot('review-queue');
      // the answer to q2 (out of order): closes q2 only; the tutor is told which question and its rubric
      const ans = say({ kind: 'answer', text: 'my answer to queued two', track: 'b', replyTo: q2.id });
      await page.waitFor(`document.querySelectorAll('.q-strip .q-pick').length === 2`);
      u = await ui();
      assert(u.picks.join() === 'Lesson,Review 1*' && u.tags.join() === 'Review question,Review' && /1 question/.test(u.tab), 'q2 is closed, q1 and the lesson question stay: ' + JSON.stringify(u));
      const p2 = learn('pending', 'cells');
      assert(p2.includes(pb.id) && p2.includes(q1.id) && !p2.includes(q2.id) && p2.includes(pa.id), 'pending after one queue answer: ' + p2);
      // `wait` (in a copy of the data, so the running tutor doesn't take the message)
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-queue-'));
      fs.cpSync(path.join(HOME, 'topics'), path.join(copy, 'topics'), { recursive: true });
      const cenv = { ...ENV, LEARN_HOME: copy, LEARN_PORT: String(Number(PORT) + 333) };
      execFileSync(process.execPath, ['-e', `const S = require(${JSON.stringify(path.join(CODE, 'app', 'store.js'))}); S.ensureDir(S.INBOX); S.enqueue(JSON.parse(process.argv[1]))`, JSON.stringify(ans)], { env: cenv });
      const w = spawnSync(process.execPath, [BIN, 'wait'], { env: cenv, encoding: 'utf8', timeout: 15000 });
      fs.rmSync(copy, { recursive: true, force: true });
      assert(w.stdout.includes(`replying-to=${q2.id}`) && w.stdout.includes(`answers review-queue question ${q2.id} [skill 1.1]`) && w.stdout.includes('rubric: rubric two') && w.stdout.includes(`--grade-of ${ans.id}`) && /1 more open in the queue: top it up/.test(w.stdout), 'wait explains a queue answer: ' + w.stdout + w.stderr);
      // graded on its own; the thread's pending question is still the lesson one
      const g = run('Good.', '--track', 'b', '--grade', 'correct', '--grade-of', ans.id);
      assert(g.status === 0 && jl().find(e => e.kind === 'grade' && e.target === ans.id)?.questionId === q2.id, g.stderr + g.stdout);
      assert(learn('pending', 'cells').includes(pb.id), 'the lesson question of thread b is still open');
      // skip closes a queued question too; then the strip is gone
      say({ kind: 'action', text: 'skip', track: 'b', replyTo: q1.id });
      await page.waitFor(`!document.querySelector('.q-strip')`);
      assert(!/review queue/.test(learn('pending', 'cells')), 'the queue is empty');
    } finally { learn('track', 'cells', 'close'); await page.eval(`localStorage.removeItem('learn:track:cells')`); }
    assert(/cells: ok/.test(learn('check', 'cells')), 'check');
  });
  await test('viz-check: draws a message\'s viz blocks headless in both themes, reports hidden, overlapping, cut-off, unreadable and tiny text, saves PNGs; post reminds', async () => {
    const vc = (...a) => spawnSync(process.execPath, [BIN, 'viz-check', ...a], { env: ENV, encoding: 'utf8' });
    const bad = path.join(HOME, 'bad-drawing.md');
    fs.writeFileSync(bad, ['A drawing.', '', '```viz js', `const svg = d3.select(el).append('svg').attr('viewBox', '0 0 400 160').attr('width', '100%').style('max-width', '400px');`,
      `svg.append('text').attr('x', 20).attr('y', 40).attr('fill', 'var(--fg)').text('helicase');`, `svg.append('text').attr('x', 40).attr('y', 43).attr('fill', 'var(--fg)').text('primase');`,
      `svg.append('text').attr('x', 200).attr('y', 100).attr('fill', 'var(--fg)').text('covered label');`, `svg.append('rect').attr('x', 190).attr('y', 80).attr('width', 130).attr('height', 30).attr('fill', 'steelblue');`,
      `svg.append('text').attr('x', 350).attr('y', 140).attr('fill', 'var(--fg)').text('runs off the edge here');`, `svg.append('text').attr('x', 20).attr('y', 140).attr('fill', 'var(--fg)').attr('font-size', 6).text('tiny');`,
      `svg.append('text').attr('x', 20).attr('y', 90).attr('fill', 'black').text('fixed black');`, '```', '', '```viz bars', '{ items: [{ label: "A", value: 3 }, { label: "B", value: 5 }] }', '```', ''].join('\n'));
    const r = vc('cells', bad);
    assert(r.status === 1, 'exit 1 on problems: ' + r.stderr + r.stdout);
    for (const want of [/2 drawings/, /#1 viz js \(line 3\)/, /hidden text: "covered label"/, /overlapping text: "helicase" and "primase"/, /text cut off: "runs off the edge here"/, /tiny text: "tiny"/,
      /unreadable text: "fixed black".*\(dark theme only\)/, /#2 viz bars \(line 14\): ok/]) assert(want.test(r.stdout), `missing ${want} in:\n${r.stdout}`);
    const dir = path.join(HOME, 'state', 'viz-check', 'bad-drawing');
    for (const f of ['1-light.png', '1-dark.png', '2-light.png', 'message-dark.png']) assert(fs.statSync(path.join(dir, f)).size > 1000, 'no PNG ' + f);
    fs.mkdirSync(OUT, { recursive: true }); fs.copyFileSync(path.join(dir, '1-light.png'), path.join(OUT, 'viz-check-1-light.png'));
    // a posted message, by id: post reminds, a clean drawing passes; nothing to check is said so
    const good = 'A flow.\n\n```viz js\nconst svg = d3.select(el).append("svg").attr("viewBox", "0 0 300 60").attr("width", "100%").style("max-width", "300px");\nsvg.append("text").attr("x", 20).attr("y", 30).attr("fill", "var(--fg)").text("a clear label");\n```';
    const p = spawnSync(process.execPath, [BIN, 'post', '--topic', 'cells'], { env: ENV, input: good, encoding: 'utf8' });
    const id = (p.stdout.match(/posted message (\S+)/) || [])[1];
    assert(p.status === 0 && id && p.stdout.includes(`bin/learn viz-check ${id}`), 'post reminds to check the drawing: ' + p.stdout + p.stderr);
    const ok = vc('cells', id);
    assert(ok.status === 0 && /nothing measurable is wrong/.test(ok.stdout) && /look at the PNGs/.test(ok.stdout), ok.stdout + ok.stderr);
    const none = spawnSync(process.execPath, [BIN, 'viz-check', '-'], { env: ENV, input: 'just prose', encoding: 'utf8' });
    assert(none.status === 0 && /no viz blocks/.test(none.stdout), none.stdout + none.stderr);
    assert(vc('cells', '2020-01-01.1').status === 1, 'an unknown message is an error');
  });
  await test('prepared visuals: listed, found, asked for; embedded with one line and stepped through in the UI; post refuses an unknown one; check renders every step; ready needs a fresh check', async () => {
    const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { env: ENV, encoding: 'utf8' });
    const post = input => spawnSync(process.execPath, [BIN, 'post', '--topic', 'cells'], { env: ENV, input, encoding: 'utf8' });
    const list = learn('visuals', 'cells');
    assert(/1 ready/.test(list) && list.includes('ball-crosses  [1.1]') && list.includes('![caption](visual:ball-crosses)') && /use: +a synthetic test fixture/.test(list), list);
    assert(learn('visuals', 'cells', 'find', 'gate', 'wall').includes('ball-crosses') && /no visual matches/.test(learn('visuals', 'cells', 'find', 'ribosome')), 'find');
    // the queue: a tutor asks in one line
    assert(/queued for the visuals job/.test(learn('visuals', 'cells', 'want', 'a gate that opens and closes', '--skill', '1.2', '--ref', '2026-01-01.1')), 'want');
    const reqs = fs.readFileSync(path.join(HOME, 'topics/cells/visuals/requests.md'), 'utf8');
    assert(/^- \[ \] \d{4}-\d\d-\d\d \(1\.2 · msg 2026-01-01\.1\): a gate that opens and closes$/m.test(reqs), reqs);
    assert(learn('visuals', 'cells').includes('a gate that opens and closes'), 'the list shows what is wanted');
    assert(/- visuals: 1 ready, 0 draft, 1 wanted by tutors/.test(learn('away', '--snapshot')), 'the planner sees it');
    const res = learn('resume', 'cells');
    assert(/## Prepared visuals/.test(res) && res.includes('ball-crosses') && res.includes('visuals want'), 'resume lists them');
    // one line in a message; an unknown name is refused like a missing image
    const bad = post('Look.\n\n![x](visual:no-such-thing)\n');
    assert(bad.status !== 0 && /no such prepared visual/.test(bad.stderr + bad.stdout), 'unknown visual refused: ' + bad.stdout + bad.stderr);
    const ok = post('Watch the ball.\n\n![Where does it end up?](visual:ball-crosses?step=2)\n');
    const id = (ok.stdout.match(/posted message (\S+)/) || [])[1];
    assert(ok.status === 0 && id, ok.stdout + ok.stderr);
    await page.nav(`${BASE}/#/cells/learn`, 1200);
    const sel = `.msg[data-id="${id}"] .viz-visual`;
    await page.waitFor(`!!document.querySelector('${sel} .sc-svg circle')`);
    const state = () => page.eval(`(() => { const v = document.querySelector('${sel}'); return { count: v.querySelector('.sc-count').textContent, cx: Math.round(v.querySelector('circle').getAttribute('cx')), title: v.querySelector('.viz-title')?.textContent,
      cap: [...v.querySelectorAll('.sc-cap.on')].map(c => c.textContent.trim()).join('|'), note: v.querySelector('.visual-note')?.textContent, kit: v.querySelector('svg').textContent.includes('kit loaded'), btn: v.querySelector('.sc-main').textContent }; })()`);
    let st = await state();
    assert(st.count === '2 / 3' && st.cx === 330 && st.title === 'Where does it end up?' && /gate lets it pass/.test(st.cap) && /made-up scene/.test(st.note) && st.kit && /Next/.test(st.btn), 'opens on step 2, as a still: ' + JSON.stringify(st));
    await page.click(`${sel} .sc-main`, 100);
    await page.waitFor(`document.querySelector('${sel} .sc-count').textContent === '3 / 3' && /Replay/.test(document.querySelector('${sel} .sc-main').textContent)`);
    st = await state();
    assert(st.cx === 480 && /comes to rest/.test(st.cap), 'Next plays the next step and stops: ' + JSON.stringify(st));
    await page.shot('visual');
    await page.eval(`document.querySelector('${sel} .sc-bar .btn').click()`);
    assert((await state()).count === '2 / 3', 'Back');
    assert(page.errors.length === 0, 'no JS errors: ' + page.errors.join('\n'));
    // check: every step rendered and measured; ready only for a file that was checked as it is
    const stale = run('visuals', 'cells', 'ready', 'ball-crosses', '--reviewed', 'test');
    assert(stale.status !== 0 && /never rendered/.test(stale.stderr), 'ready needs a check: ' + stale.stderr + stale.stdout);
    const chk = run('visuals', 'cells', 'check', 'ball-crosses');
    assert(chk.status === 0 && /3 step\(s\), 4 frame\(s\)/.test(chk.stdout) && /#3 step 2: It squeezes through: ok/.test(chk.stdout) && /nothing measurable is wrong/.test(chk.stdout), chk.stdout + chk.stderr);
    const dir = path.join(HOME, 'state', 'viz-check', 'visual-cells-ball-crosses');
    for (const f of ['1-dark.png', '4-light.png', 'message-dark.png']) assert(fs.statSync(path.join(dir, f)).size > 1000, 'no PNG ' + f);
    fs.copyFileSync(path.join(dir, '3-dark.png'), path.join(OUT, 'visual-check-step2-dark.png'));
    assert(learn('visuals', 'cells', 'show', 'ball-crosses').includes('steps: 1 The ball reaches the wall · 2 It squeezes through · 3 It settles'), 'the check records the steps');
    assert(run('visuals', 'cells', 'ready', 'ball-crosses').status !== 0, 'ready without --reviewed is refused');
    const rdy = run('visuals', 'cells', 'ready', 'ball-crosses', '--reviewed', 'frames looked at by the test');
    assert(rdy.status === 0 && /reviewed: \d{4}-\d\d-\d\d frames looked at by the test/.test(fs.readFileSync(path.join(HOME, 'topics/cells/visuals/ball-crosses.js'), 'utf8')), rdy.stdout + rdy.stderr);
    // a draft: still usable, but post says so; a broken one is caught by the check
    fs.writeFileSync(path.join(HOME, 'topics/cells/visuals/half-done.js'), '/* visual\ntitle: Half done\nskills: 1.2\nstatus: draft\n*/\nconst sc = ctx.scene({ w: 300, h: 80, steps: [] });\nsc.label(sc.svg, 150, 40, "a");\nsc.label(sc.svg, 152, 42, "b");\nnope();\n');
    const draft = post('![x](visual:half-done)\n');
    assert(draft.status === 0 && /not rendered and reviewed yet/.test(draft.stdout + draft.stderr), 'a draft is flagged: ' + draft.stdout + draft.stderr);
    const broken = run('visuals', 'cells', 'check', 'half-done');
    assert(broken.status === 1 && /error box/.test(broken.stdout) && /nope is not defined/.test(broken.stdout), broken.stdout + broken.stderr);
    assert(run('visuals', 'cells', 'ready', 'half-done', '--reviewed', 'x').status !== 0 && /status: draft/.test(fs.readFileSync(path.join(HOME, 'topics/cells/visuals/half-done.js'), 'utf8')), 'a visual with problems is not marked ready');
    assert(/cells: ok/.test(learn('check', 'cells')), 'check: ' + learn('check', 'cells'));
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
  // (not this process: a keep-alive fetch to the server shows up in lsof too)
  try { execFileSync('sh', ['-c', `lsof -ti tcp:${PORT} | grep -vx ${process.pid} | xargs kill 2>/dev/null`]); } catch {}
  if (!opt.keep) fs.rmSync(HOME, { recursive: true, force: true }); else console.log('kept ' + HOME);
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `, ${bad.length} failed` : ''} · screenshots in test/out/`);
  process.exit(code ?? (bad.length ? 1 : 0));
}
// any way of stopping the run takes Chrome, the launcher and the temp data down with it
let finishing = false;
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => { if (!finishing) { finishing = true; finish(code); } });
main().then(() => finish()).catch(async e => { console.error(e); await finish(1); });
