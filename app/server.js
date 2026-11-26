// Local web server: static UI + JSON API + Server-Sent Events. Node stdlib only.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const S = require('./store');
const T = require('./session');
const J = require('./jobs');

const WEB = path.join(S.CODE, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// server.log: one line per event that matters for "where did my message go?", with the time
const log = (...a) => console.log(new Date().toISOString(), ...a);

const clients = new Set();
function broadcast(ev) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(data);
}

// ---------- tutor status ----------
// phase: listening | thinking | handoff (old tutor wrapping up / new one booting) | starting | offline
const status = { phase: 'offline', queued: 0, inbox: [], pickedAt: 0, tutorAt: 0, context: null, launcher: false, kind: null };
let ctxAt = 0, lastSent = '';
function computeStatus(force) {
  const sess = T.readSession();
  const launcher = T.launcherAlive(sess);
  const ls = T.listeners().filter(l => !l.session || !sess || l.session === sess.id);
  const listening = ls.length > 0;
  const inbox = S.inboxEntries().map(e => `${e.topic}/${e.id}`);
  const queued = inbox.length;
  const handoffReq = !!T.readHandoff();
  const age = sess ? Date.now() - Date.parse(sess.startedAt) : Infinity;
  // "starting" only until this session first listens or picks something up
  if (sess && (listening || status.pickedAt > Date.parse(sess.startedAt))) status.upSession = sess.id;
  const booting = launcher && !listening && age < 4 * 60e3 && status.upSession !== sess?.id;
  let phase;
  // thinking: a message was picked up and this session hasn't replied since. It ends with the
  // reply, with a listener started after the pick-up (the tutor handled it without posting a lesson
  // message, e.g. a thread switch), or when the tutor is gone: never "thinking" forever.
  const picked = status.pickedAt > Math.max(status.tutorAt, sess ? Date.parse(sess.startedAt) : 0);
  const relistened = ls.some(l => l.since >= status.pickedAt);
  if ((handoffReq && launcher) || (booting && sess.kind === 'handoff')) phase = 'handoff';
  else if (picked && launcher && !relistened) phase = 'thinking';
  else if (listening) phase = 'listening';
  else if (booting) phase = 'starting';
  else phase = 'offline';
  if (Date.now() - ctxAt > 4000 || force) {
    ctxAt = Date.now();
    const c = launcher && sess ? T.contextTokens(sess.id) : null;
    status.context = c ? { tokens: c.tokens, model: c.model, limit: T.HANDOFF_TOKENS } : null;
  }
  Object.assign(status, { phase, queued, inbox, launcher, kind: sess?.kind || null });
  const pub = JSON.stringify(publicStatus());
  if (pub !== lastSent || force) { lastSent = pub; broadcast({ type: 'status', ...publicStatus() }); }
}
function publicStatus() {
  const { phase, queued, inbox, context, launcher, kind } = status;
  // inbox: "<topic>/<id>" of the messages not picked up yet (the UI says "delivering" only for those).
  // listening/thinking kept for older UI code paths
  return { phase, queued, inbox, context, launcher, kind, listening: phase === 'listening' || phase === 'thinking', thinking: phase === 'thinking' };
}

// ---------- journal change tracking ----------
const seen = new Map(); // slug -> Set(ids)
function seenSet(slug) { if (!seen.has(slug)) seen.set(slug, new Set(S.readJournal(slug).map(e => e.id))); return seen.get(slug); }
// Call before appending to a topic's journal: the seen set must be built from the journal as it
// was, or the new entries would count as already seen and never be broadcast.
function primeSeen(slug) { if (slug && S.listTopics().includes(slug)) seenSet(slug); }
function announce(slug, entries) {
  const set = seenSet(slug);
  const fresh = entries.filter(e => !set.has(e.id));
  fresh.forEach(e => set.add(e.id));
  if (fresh.some(e => e.role === 'tutor' && e.kind === 'message')) status.tutorAt = Date.now();
  if (fresh.length) broadcast({ type: 'entries', topic: slug, entries: fresh });
  computeStatus();
}
function rescanJournal(slug) { announce(slug, S.readJournal(slug)); }

// ---------- topic payload ----------
function topicPayload(slug) {
  const d = S.topicDir(slug);
  const tags = S.readJSON(path.join(d, 'tags.json'), {}) || {};
  const journal = S.readJournal(slug);
  seenSet(slug);
  return {
    slug,
    meta: S.loadTopicMeta(slug),
    glossary: S.parseGlossary(S.readText(path.join(d, 'glossary.md'), '')),
    cheatsheet: S.readText(path.join(d, 'cheatsheet.md'), ''),
    progress: S.readText(path.join(d, 'progress.md'), ''),
    map: safe(() => S.readJSON(path.join(d, 'map.json'), null)),
    pages: S.readPages(slug),
    termPages: S.readTermPages(slug),
    media: S.readMedia(slug),
    notes: safe(() => S.readNotes(slug)),
    log: S.readText(path.join(d, 'log.md'), ''),
    tags,
    journal,
  };
}
function learnerPayload() {
  return {
    profile: S.readText(path.join(S.LEARNER, 'profile.md'), ''),
    knowledge: S.readText(path.join(S.LEARNER, 'knowledge.md'), ''),
    feedback: S.readText(S.FEEDBACK, ''),
    topics: S.listTopics().map(slug => { const m = S.loadTopicMeta(slug); return { slug, title: m.title, goal: m.goal || null, foundations: m.foundations || [] }; }),
  };
}
function safe(fn) { try { return fn(); } catch (e) { return { error: e.message }; } }

// ---------- http ----------
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

const sentByCid = new Map();   // client id -> saved entry (recent sends)
const routes = {
  // home: which data this server serves, so a launcher never adopts a server of another data home
  'GET /api/ping': () => ({ ok: true, home: S.realish(S.ROOT), pid: process.pid }),
  'GET /api/topics': () => S.listTopics().map(slug => {
    const m = S.loadTopicMeta(slug);
    const files = S.journalFiles(slug);
    return { slug, title: m.title, last: files.length ? files[files.length - 1].slice(0, 10) : null, created: m.created || null };
  }),
  'GET /api/learner': () => learnerPayload(),
  // New topic from the browser: scaffold it, journal the learner's request as a START message and
  // queue it. The tutor (on a topic switch, a fresh session) builds the skill tree and runs the
  // diagnostic, as docs/bootstrap.md says.
  'POST /api/topics/new': async (req) => {
    const b = await readBody(req);
    const goal = String(b.goal || '').trim();
    if (goal.length < 3) throw new Error('Say what you want to learn');
    const title = String(b.title || '').trim() || titleFrom(goal);
    const slug = b.slug && /^[a-z0-9][a-z0-9-]*$/.test(b.slug) && !S.listTopics().includes(b.slug) ? b.slug : S.slugify(title);
    S.createTopic(slug, title, { goal });
    primeSeen(slug);
    const lines = [goal];
    if (String(b.why || '').trim()) lines.push('', `**What for / how deep:** ${String(b.why).trim()}`);
    if (String(b.know || '').trim()) lines.push('', `**What I already know:** ${String(b.know).trim()}`);
    const [saved] = S.appendJournal(slug, [{ role: 'user', kind: 'start', text: lines.join('\n') }]);
    S.enqueue(saved);
    broadcast({ type: 'topics' });
    announce(slug, [saved]);
    return { slug, title, entry: saved };
  },
  'GET /api/jobs': () => J.status(),
  'POST /api/away': async (req) => { const b = await readBody(req); const st = J.start(b.jobs); broadcast({ type: 'jobs' }); return st; },
  'POST /api/jobs/stop': async (req) => { await readBody(req); const st = J.stop(); broadcast({ type: 'jobs' }); return st; },
  'POST /api/restart': async (req) => { const b = await readBody(req); setTimeout(() => restart(b.reason || 'requested'), 50); return { ok: true }; },
  'POST /api/shutdown': async (req) => { await readBody(req); setTimeout(() => process.exit(0), 50); return { ok: true }; },
  // clients: open event streams, i.e. whether the app is open in a browser (the launcher then doesn't open another tab)
  'GET /api/status': () => ({ ...publicStatus(), clients: clients.size }),
  'POST /api/send': async (req) => {
    const b = await readBody(req);
    // the browser retries a send whose answer it didn't get (a timeout, a server restart): the
    // client id makes that retry return the saved entry instead of posting the message twice
    const cid = typeof b.cid === 'string' && b.cid.length <= 64 ? b.cid : null;
    if (cid && sentByCid.has(cid)) { log(`send ${b.topic} ${sentByCid.get(cid).id}: retry, already saved`); return sentByCid.get(cid); }
    if (!S.listTopics().includes(b.topic)) throw new Error('unknown topic');
    if (!['answer', 'ask', 'action', 'start', 'meta'].includes(b.kind)) throw new Error('bad kind');
    const text = String(b.text || '').trim();
    if (!text) throw new Error('empty');
    const e = { role: 'user', kind: b.kind, text };
    if (b.kind === 'meta') e.meta = true;
    if (b.replyTo) e.replyTo = b.replyTo;
    if (b.quote) e.quote = b.quote;
    if (b.track === 'a' || b.track === 'b') e.track = b.track;   // two threads (journal.js)
    primeSeen(b.topic);
    const [saved] = S.appendJournal(b.topic, [e]);
    S.enqueue(saved);
    if (cid) { sentByCid.set(cid, saved); if (sentByCid.size > 500) sentByCid.delete(sentByCid.keys().next().value); }
    log(`send ${b.topic} ${saved.id} ${saved.kind}${saved.track ? ' track=' + saved.track : ''}: queued (${saved.text.length} chars)`);
    announce(b.topic, [saved]);
    // app remarks for the tutor ("Tell the tutor now"): the tutor gets it (labelled META), and it is also an open item in
    // feedback.md, so later interface work can mine what the learner wanted
    if (saved.meta) {
      try { S.appendFeedback(text.length > 3900 ? text.slice(0, 3900) + '…' : text, `${b.topic} · about the app · msg ${saved.id}`); broadcast({ type: 'learner' }); }
      catch (err) { console.error('feedback.md:', err.message); }
    }
    return saved;
  },
  // Feedback box (UI / process): appended to <data>/feedback.md for the builder job; not journaled,
  // not queued for the tutor. (With "Tell the tutor now" ticked the UI sends kind "meta" above instead: both.)
  'POST /api/feedback': async (req) => {
    const b = await readBody(req);
    const r = S.appendFeedback(b.text, [b.topic, b.view].filter(Boolean).join(' · '));
    broadcast({ type: 'learner' });
    return r;
  },
  // "Fresh tutor": politely (the tutor saves its notes, then runs `bin/learn handoff`) or,
  // with force, right away (for a stuck tutor; unanswered messages are requeued).
  'POST /api/handoff': async (req) => {
    const b = await readBody(req);
    if (!T.launcherAlive()) throw new Error('The tutor was not started with bin/learn, so it cannot be replaced from here. Run bin/learn in a terminal.');
    if (b.force || status.phase === 'offline' || status.phase === 'starting') {
      T.requestHandoff({ reason: 'requested by the learner', topic: b.topic, force: true });
      computeStatus(true);
      return { mode: 'now' };
    }
    if (!S.listTopics().includes(b.topic)) throw new Error('unknown topic');
    primeSeen(b.topic);
    const [saved] = S.appendJournal(b.topic, [{ role: 'user', kind: 'action', text: `${T.FRESH_TUTOR}: save your notes and hand off` }]);
    S.enqueue(saved);
    announce(b.topic, [saved]);
    return { mode: 'after-notes', entry: saved };
  },
  'POST /api/append': async (req) => {
    const b = await readBody(req);
    primeSeen(b.topic);
    if (!S.listTopics().includes(b.topic)) throw new Error('unknown topic');
    const saved = S.appendJournal(b.topic, b.entries);
    log(`post ${b.topic} ${saved.map(e => e.id + ' ' + e.kind + (e.track ? ' track=' + e.track : '')).join(', ')}`);
    announce(b.topic, saved);
    return saved;
  },
  'POST /api/level': async (req) => {
    const b = await readBody(req);
    primeSeen(b.topic);
    const e = S.setLevel(b.topic, b.skill, b.level, b.reason);
    announce(b.topic, [e]);
    broadcast({ type: 'topic', topic: b.topic, part: 'topic.json' });
    return e;
  },
  'POST /api/picked': async (req) => {
    const b = await readBody(req);
    log(`picked up by the tutor: ${(b.ids || []).join(' ')}`);
    status.pickedAt = Date.now();
    computeStatus(true);
    return { ok: true };
  },
  'POST /api/withdraw': async (req) => {
    // remove a not-yet-picked message from the inbox (learner hit "undo")
    const b = await readBody(req);
    let removed = false;
    try { for (const f of fs.readdirSync(S.INBOX)) if (f.endsWith(`-${b.id}.json`)) { fs.unlinkSync(path.join(S.INBOX, f)); removed = true; } } catch {}
    computeStatus();
    return { removed };
  },
};

// Only this machine's own pages and tools may talk to the server. Any website the learner visits can
// send requests to localhost, and the tutor and the jobs are agents that run commands, so: the Host
// must be localhost (a DNS-rebinding page would carry its own name), and a request that changes
// something must come from the app's own origin (browsers always send Origin on a cross-site POST;
// the CLI sends none) and carry JSON (a cross-site form or no-cors fetch can't set that type).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'].map(h => `${h}:${S.PORT}`));
function refused(req) {
  if (!LOCAL_HOSTS.has(String(req.headers.host || '').toLowerCase())) return 'unexpected Host';
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOSTS.has(origin.replace(/^http:\/\//, '').toLowerCase())) return 'cross-origin request';
  const type = req.headers['content-type'];
  if ((type || Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) && !/^application\/json\b/i.test(type || '')) return 'expected application/json';
  return null;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const no = refused(req);
  if (no) return send(res, 403, { error: `refused: ${no}` });
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      // retry: reconnect a second after the server restarts (the browser's default is ~3 s)
      res.write(`retry: 1000\ndata: ${JSON.stringify({ type: 'status', ...publicStatus() })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const m = p.match(/^\/api\/topic\/([a-z0-9-]+)$/);
    if (m && req.method === 'GET') return send(res, 200, topicPayload(m[1]));
    const pm = p.match(/^\/api\/pill\/([a-z0-9-]+)$/);
    if (pm && req.method === 'GET') return S.listTopics().includes(pm[1]) ? send(res, 200, { topic: pm[1], text: require('./pill').pill(pm[1]) }) : send(res, 404, { error: 'no such topic' });
    const rp = p.match(/^\/api\/report\/([\w.-]+\.md)$/);
    if (rp && req.method === 'GET') { const t = J.readReport(rp[1]); return t == null ? send(res, 404, { error: 'no such report' }) : send(res, 200, { file: rp[1], text: t }); }
    const r = routes[`${req.method} ${p}`];
    if (r) return send(res, 200, await r(req, url));
    // a topic's downloaded images (bin/learn image)
    if (p.startsWith('/media/') && req.method === 'GET') {
      const mm = p.match(/^\/media\/([a-z0-9][a-z0-9-]*)\/([^/]+)$/);
      const file = mm && S.listTopics().includes(mm[1]) && S.MEDIA_NAME.test(mm[2]) ? path.join(S.mediaDir(mm[1]), mm[2]) : null;
      if (!file || !fs.existsSync(file)) return send(res, 404, 'no such image', 'text/plain');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=3600',
        ...(file.endsWith('.svg') ? { 'content-security-policy': "script-src 'none'" } : {}) });
      return fs.createReadStream(file).pipe(res);
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    // static
    let file = path.normalize(path.join(WEB, p === '/' ? 'index.html' : p));
    if (!file.startsWith(WEB)) return send(res, 403, 'forbidden', 'text/plain');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    log(`error ${req.method} ${p}: ${e.message}`);
    if (!res.headersSent) send(res, 400, { error: e.message }); else res.end();
  }
}

function watch() {
  const timers = new Map();
  const debounce = (key, fn, ms = 120) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(fn, ms)); };
  try {
    fs.watch(S.TOPICS, { recursive: true }, (_ev, rel) => {
      if (!rel) return;
      const parts = rel.split(path.sep);
      const slug = parts[0];
      if (!slug || !S.listTopics().includes(slug)) { debounce('topics', () => broadcast({ type: 'topics' })); return; }
      if (parts[1] === 'journal') debounce('j:' + slug, () => rescanJournal(slug));
      else if (/\.(json|md)$/.test(rel) && !rel.endsWith('.tmp')) debounce('t:' + slug + parts[1], () => broadcast({ type: 'topic', topic: slug, part: parts[1] }));
    });
  } catch (e) { console.error('watch failed', e); }
  // learner files, feedback, reports, job state: tell browsers (the Away popover, the "You" page)
  try {
    fs.watch(S.ROOT, { recursive: true }, (_ev, rel) => {
      if (!rel) return;
      if (rel === path.join('state', 'jobs.json')) debounce('jobs', () => broadcast({ type: 'jobs' }), 150);
      else if (rel.startsWith('learner') || rel === 'feedback.md' || rel.startsWith('reports')) debounce('learner', () => broadcast({ type: 'learner' }), 200);
    });
  } catch {}
  // the learner folder, when config.json keeps it outside the data home
  if (S.LEARNER_OUTSIDE) try { S.ensureDir(S.LEARNER); fs.watch(S.LEARNER, { recursive: true }, () => debounce('learner', () => broadcast({ type: 'learner' }), 200)); } catch {}
  // UI files: tell browsers the UI changed (they reload when idle, or offer a button)
  try {
    fs.watch(WEB, { recursive: true }, (_ev, rel) => { if (rel && !rel.startsWith('vendor')) debounce('web', () => broadcast({ type: 'reload-ui', file: rel }), 400); });
  } catch {}
  // server code changed (the builder job, or the tutor extending the app): restart into the new code,
  // unless background jobs are running (their runner restarts the server when they finish)
  try {
    fs.watch(path.join(S.CODE, 'app'), (_ev, f) => { if (f && f.endsWith('.js')) debounce('app', () => { if (!J.status().running) restart('app/' + f + ' changed'); else pendingRestart = 'app/' + f + ' changed'; }, 1500); });
  } catch {}
  setInterval(computeStatus, 1000);
  // a code change that came while jobs ran: restart once they're done (their runner restarts the
  // server only when they committed something)
  setInterval(() => { if (pendingRestart && !J.status().running) { const r = pendingRestart; pendingRestart = null; restart(r); } }, 5000);
}
let pendingRestart = null;

// Replace this process with a fresh `bin/learn serve` running the current code. Browsers reconnect
// by themselves (EventSource retries) and refetch what they missed.
let server = null;
// The new code must load first: an agent editing app/ in two steps can leave it broken for a
// moment, and a server that restarted into that would just be gone. Then keep the old one running
// and try again on the next change (or in a minute).
let restartRetry = null;
function restart(reason) {
  clearTimeout(restartRetry);
  try { execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(S.CODE, 'app', 'server.js'))})`], { stdio: 'pipe', timeout: 15000 }); }
  catch (e) {
    log(`learn: not restarting (${reason}): the new code doesn't load, keeping this server.\n${String(e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n')}`);
    restartRetry = setTimeout(() => restart(reason), 60e3);
    return;
  }
  log(`learn: restarting (${reason})`);
  try { server.close(); } catch {}
  for (const c of clients) { try { c.end(); } catch {} }
  const fd = fs.openSync(path.join(S.STATE, 'server.log'), 'a');
  spawn(process.execPath, [path.join(S.CODE, 'bin', 'learn'), 'serve'], { detached: true, stdio: ['ignore', fd, fd], env: process.env }).unref();
  setTimeout(() => process.exit(0), 100);
}
function titleFrom(goal) {
  const t = goal.replace(/^(i (want|would like|'d like) to (learn|understand|know)( about| how)?|teach me( about)?|learn( about)?|how (do|does))\s+/i, '').replace(/[.?!].*$/s, '').trim();
  const short = t.split(/\s+/).slice(0, 6).join(' ');
  return short ? short[0].toUpperCase() + short.slice(1) : 'New topic';
}

function start() {
  S.ensureDir(S.INBOX);
  server = http.createServer(handle);
  let tries = 0;
  const listen = () => server.listen(S.PORT, '127.0.0.1', () => log(`learn: http://localhost:${S.PORT} (pid ${process.pid}, data ${S.realish(S.ROOT)})`));
  // a bug in a watcher or a timer must not take the server down mid-lesson: log it and carry on
  process.on('uncaughtException', e => log('uncaught:', e.stack || e.message));
  process.on('unhandledRejection', e => log('unhandled rejection:', e?.stack || e));
  // after a restart the old process may still hold the port for a moment
  server.on('error', e => { if (e.code === 'EADDRINUSE' && ++tries < 40) setTimeout(listen, 100); else { log(e.message); process.exit(1); } });
  listen();
  for (const slug of S.listTopics()) seenSet(slug);
  watch();
  computeStatus(true);
  setInterval(() => broadcast({ type: 'ping' }), 25000);
}

module.exports = { start };
if (require.main === module) start();
