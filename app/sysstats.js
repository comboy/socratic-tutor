// What the System page shows (web/js/system.js, GET /api/system) and what colours the tutor's
// status light (tutorHealth, sent with every status event): numbers about the machinery, not about
// the learning (those are the Stats view's). Everything here is measured from files that already
// exist: the journals, the agent's transcript (app/agent.js), state/server.log, state/jobs.json,
// git. What nothing records is reported as null and the page says "not measured": a made-up
// number would be worse than none, since this page is what trust in the delivery rests on.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./store');
const T = require('./session');

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const p75 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.75)] : null; };
const k = n => Math.round(n / 1000) + 'k';
const day = ts => S.localDate(new Date(ts));

// ---------------------------------------------------------------- reply latency
// How long the learner waited: for each lesson message of theirs, the time until the tutor's next
// lesson message in the same thread; with two threads, whether the other thread had a reply ready
// to read at that moment (the wait was hidden) or not (felt). -> [{ at, s, two, hidden }]
function replyWaits(J, since = 0) {
  const meta = S.metaIds(J);
  const lesson = J.filter(e => !meta.has(e.id) && !e.imported && (e.role === 'user' ? ['answer', 'ask', 'action'].includes(e.kind) : e.kind === 'message'));
  const rows = [];
  lesson.forEach((u, i) => {
    if (u.role !== 'user' || Date.parse(u.ts) < since) return;
    const t = S.trackOf(u), reply = lesson.slice(i + 1).find(e => e.role === 'tutor' && S.trackOf(e) === t);
    if (!reply) return;
    // two threads: did the other one have a tutor message waiting (its last entry before u)?
    const other = lesson.slice(0, i).filter(e => S.trackOf(e) !== t && e.track).pop();
    rows.push({ at: u.ts, s: (Date.parse(reply.ts) - Date.parse(u.ts)) / 1000, two: !!u.track, hidden: !!(u.track && other?.role === 'tutor') });
  });
  return rows;
}
const waitSummary = rows => ({ n: rows.length, median: rows.length ? Math.round(median(rows.map(r => r.s))) : null, p75: rows.length ? Math.round(p75(rows.map(r => r.s))) : null });
// the journal's last `days` day files: bounded, whatever the journal's age
function recentJournal(topic, days = 7) {
  return S.listTopics().includes(topic) ? S.journalFiles(topic).slice(-days).flatMap(f => S.readJournalFile(topic, f)) : [];
}

// ---------------------------------------------------------------- the status light
// green: nothing to do. yellow ("warn"): a fresh tutor would be sensible at the next break.
// red ("now"): restart it now. The light only informs: the automatic handoff (bin/learn wait, at
// the threshold) and the watchdog (app/server.js) go on working by themselves.
//
// Why these numbers (measured on a real session, 2026-11-26: the context grew by about 10k tokens
// per exchange, 160k in under three hours):
// - yellow from 70% of the handoff threshold. The automatic switch comes after whichever reply
//   crosses the threshold, in the middle of whatever is being explained, and costs about a minute;
//   from 70% there are roughly ten exchanges left to pick a better moment (a break, a finished
//   section), and every reply is getting slower and costlier as the context grows.
// - red from 90%: a few exchanges left; and at 100%, where the switch follows the next reply.
// - red when a message given to the tutor has no reply long after a running tutor would have been
//   handed it again (status.stalled), or when the watchdog has already replaced the tutor twice in
//   a row without an answer: nothing automatic is left to try.
// - yellow when replies are slower than usual and the context is a likely cause (at least 40%
//   full): the last five waits against the week's median. A slow reply with a small context has
//   another cause (a long explanation, a drawing), which a restart wouldn't cure.
// - an agent without a context meter: the same fractions of its message limit (handoffMessages).
// Session age alone is not a signal: what age does to a tutor is a large context (measured
// directly) and instructions that changed since it read them, which is reported as a note
// (guideChanged), not as a colour: the docs change many times a day while the app is being built,
// and a light that is always yellow says nothing.
const WARN_AT = 0.7, NOW_AT = 0.9, SLOW_CTX = 0.4;
// -> { level: 'ok' | 'warn' | 'now', reasons: [{ level, short, text }] }   (worst first)
function tutorHealth({ context = null, turns = 0, handoffMessages = T.HANDOFF_MESSAGES, stalled = [], watchdogFired = 0, waits = null } = {}) {
  const reasons = [];
  const add = (level, short, text) => reasons.push({ level, short, text });
  if (stalled.length) add('now', 'no reply', `${stalled.length === 1 ? 'A message' : stalled.length + ' messages'} given to the tutor ${stalled.length === 1 ? 'has' : 'have'} had no reply for minutes. Restart it now: what is unanswered is sent again to the fresh one.`);
  if (watchdogFired >= 2) add('now', 'not answering', 'The tutor was replaced twice by itself and there is still no reply. Restarting again may not cure it: say so on the System page (Change the app) if it stays like this.');
  let f = null;
  if (context?.tokens && context.limit) {
    f = context.tokens / context.limit;
    const of = `Context ${k(context.tokens)} of ${k(context.limit)}`, pct = `context ${Math.round(f * 100)}%`;
    if (f >= 1) add('now', pct, `${of}: over the limit. A fresh tutor takes over by itself after the next reply; restarting now saves that wait.`);
    else if (f >= NOW_AT) add('now', pct, `${of} (${Math.round(f * 100)}%): a few exchanges before the automatic switch to a fresh tutor. Better now, at a moment you choose, than in the middle of an explanation.`);
    else if (f >= WARN_AT) add('warn', pct, `${of} (${Math.round(f * 100)}%): replies get slower as it fills. A fresh tutor at your next break would be sensible; it switches by itself at ${k(context.limit)}.`);
  } else if (handoffMessages) {
    f = turns / handoffMessages;
    const of = `${turns} of ${handoffMessages} messages in this session`, pct = `${turns}/${handoffMessages} messages`;
    if (f >= NOW_AT) add('now', pct, `${of} (this agent has no context meter, so messages are counted): the automatic switch to a fresh tutor is close.`);
    else if (f >= WARN_AT) add('warn', pct, `${of} (this agent has no context meter, so messages are counted): a fresh tutor at your next break would be sensible.`);
  }
  if (waits && waits.recent != null && waits.usual != null && waits.recent >= 120 && waits.recent >= 2 * waits.usual && (f == null || f >= SLOW_CTX))
    add('warn', 'slow replies', `Replies are slower than usual (the last ${waits.n}: about ${Math.round(waits.recent / 10) * 10} s; this week usually ${Math.round(waits.usual / 10) * 10} s) and the context is ${f == null ? 'of unknown size' : Math.round(f * 100) + '% full'}. A fresh tutor may be quicker.`);
  reasons.sort((a, b) => (a.level === 'now' ? 0 : 1) - (b.level === 'now' ? 0 : 1));
  return { level: reasons[0]?.level || 'ok', reasons };
}
// The last five waits of this session against the week's median before them (the status light).
// -> { recent, usual, n } or null when there's too little to compare
function sessionWaits(sess) {
  if (!sess?.topic) return null;
  const rows = replyWaits(recentJournal(sess.topic, 7), Date.now() - 7 * 86400e3);
  const mine = rows.filter(r => r.at > sess.startedAt).slice(-5);
  const before = rows.slice(0, rows.length - mine.length);
  if (mine.length < 5 || before.length < 10) return null;
  return { recent: median(mine.map(r => r.s)), usual: median(before.map(r => r.s)), n: mine.length };
}
// tutor lesson messages this session has posted in its topic
function sessionTurns(sess) {
  if (!sess?.topic) return 0;
  return recentJournal(sess.topic, 3).filter(e => e.role === 'tutor' && e.kind === 'message' && e.ts > sess.startedAt).length;
}
// When the tutor's own guide last changed in a commit (protocol, method, AGENTS.md): a session
// started before that follows the older text until it is replaced. ISO time or null.
let guideAt = { at: 0, v: null };
function guideChanged() {
  if (Date.now() - guideAt.at < 60e3) return guideAt.v;
  let v = null;
  try { v = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'docs/protocol.md', 'docs/method.md', 'AGENTS.md'], { cwd: S.CODE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim() || null; } catch {}
  guideAt = { at: Date.now(), v };
  return v;
}

// ---------------------------------------------------------------- tutor sessions, remembered
// state/sessions.json: one record per tutor session the server has seen, with the context size it
// last had: { list: [{ id, startedAt, kind, topic, agent, tokens, model, seenAt }] } (the last 100).
// session.json only knows the current one, and "how large do sessions get, how often do they hand
// off" needs the earlier ones. Written when a session appears and when its context has grown (once
// per tutor turn); when the next session appears, the one before gets its final size from its
// transcript (the last reply before a handoff lands between two looks).
const SESSIONS = path.join(S.STATE, 'sessions.json');
let noted = { id: null, tokens: null };
function readSessions() { try { return (S.readJSON(SESSIONS, null) || {}).list || []; } catch { return []; } }
function noteSession(sess, context) {
  if (!sess?.id) return;
  const tokens = context?.tokens ?? null;
  if (noted.id === sess.id && noted.tokens === tokens) return;
  const list = readSessions();
  let r = list.find(x => x.id === sess.id);
  if (!r) {
    const prev = list.at(-1);
    if (prev) try { const c = T.contextTokens(prev.id); if (c?.tokens) prev.tokens = c.tokens; } catch {}
    r = { id: sess.id }; list.push(r);
  }
  Object.assign(r, { startedAt: sess.startedAt, kind: sess.kind || null, topic: sess.topic || r.topic || null, agent: sess.agent || null, seenAt: new Date().toISOString() });
  if (tokens != null) { r.tokens = tokens; r.model = context.model || r.model || null; }
  S.ensureDir(S.STATE);
  S.writeJSON(SESSIONS, { list: list.slice(-100) });
  noted = { id: sess.id, tokens };
}

// ---------------------------------------------------------------- state/server.log
// The server writes one line per event of a message's way (app/server.js `log`): saved and
// queued, picked up by the tutor, a browser's retry, the watchdog replacing the tutor, its own
// restarts. Read from the end (2 MB: weeks of lessons), so the cost doesn't grow with the log.
function logEvents() {
  const file = path.join(S.STATE, 'server.log');
  const ev = { from: null, sent: new Map(), picks: [], retries: [], watchdog: [], restarts: [], starts: [] };
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, n = Math.min(size, 2 << 20), buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      text = buf.toString('utf8');
      if (n < size) text = text.slice(text.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
  } catch { return ev; }
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/);
    if (!m) continue;
    const t = Date.parse(m[1]), rest = m[2];
    if (!ev.from) ev.from = m[1];
    let x;
    if ((x = rest.match(/^send (\S+) (\S+) \w+.*: queued/))) ev.sent.set(`${x[1]}/${x[2]}`, t);
    else if (/^send \S+ \S+: retry, already saved/.test(rest)) ev.retries.push(t);
    else if ((x = rest.match(/^picked up by the tutor: (.*)$/))) for (const id of x[1].split(' ').filter(Boolean)) ev.picks.push({ id, t });
    else if (/^watchdog: .*replacing the tutor/.test(rest)) ev.watchdog.push(t);
    else if (/^learn: restarting \(/.test(rest)) ev.restarts.push(t);
    else if (/^learn: \S+ \(pid \d+/.test(rest)) ev.starts.push(t);
  }
  return ev;
}
// Counts for one period. again: messages the tutor was handed more than once (delivered again
// after going unanswered, or requeued for a fresh tutor): each one is a message that would have
// been lost without the net.
function delivery(ev, since) {
  const sent = [...ev.sent].filter(([, t]) => t >= since);
  const first = new Map(), count = new Map();
  for (const p of ev.picks) { if (!first.has(p.id)) first.set(p.id, p.t); if (p.t >= since) count.set(p.id, (count.get(p.id) || 0) + (first.get(p.id) === p.t ? 0 : 1)); }
  const delays = sent.filter(([id]) => first.has(id)).map(([id, t]) => first.get(id) - t).filter(d => d >= 0);
  return {
    sent: sent.length, picked: sent.filter(([id]) => first.has(id)).length,
    pickMedianMs: delays.length ? Math.round(median(delays)) : null, pickMaxMs: delays.length ? Math.max(...delays) : null,
    again: [...count.values()].filter(n => n > 0).length,
    retries: ev.retries.filter(t => t >= since).length,
    watchdog: ev.watchdog.filter(t => t >= since).length,
    restarts: ev.restarts.filter(t => t >= since).length,
  };
}

// ---------------------------------------------------------------- the page's payload
let headAt = { at: 0, v: null };
function gitHead() {
  if (Date.now() - headAt.at < 60e3) return headAt.v;
  let v = null;
  try {
    const [hash, date, ...subj] = execFileSync('git', ['log', '-1', '--format=%h%x09%cI%x09%s'], { cwd: S.CODE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim().split('\t');
    if (hash) v = { hash, date, subject: subj.join('\t') };
  } catch {}
  headAt = { at: Date.now(), v };
  return v;
}
const startedAt = new Date().toISOString(), startHead = gitHead();

// A long session's transcripts take a second or more to read the first time, and a request reads
// for 120 ms at most (app/agent.js `usage`): the rest is read here, in short slices between the
// server's other work, so the page's "still counting" ends within seconds instead of many refreshes.
let warming = null;
function warmUsage(A, id) {
  if (warming) return;
  const step = () => {
    let u = null; try { u = A.usage(id, 40); } catch {}
    warming = u?.partial ? setTimeout(step, 40) : null;
  };
  warming = setTimeout(step, 40);
}

// status: the server's public status; clients: open browser streams; pendingRestart: why a
// restart is waiting (code changed while jobs run), or null
function system({ topic = null, status = {}, clients = 0, pendingRestart = null } = {}) {
  const now = Date.now(), today = S.localDate(), midnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime(), weekAgo = now - 7 * 86400e3;
  const cfg = S.config();
  const sess = T.readSession(), live = T.launcherAlive(sess);
  const A = require('./agent').agent();
  let usage = null;
  try { usage = live && A.usage ? A.usage(sess.id) : null; } catch {}
  if (usage?.partial) warmUsage(A, sess.id);

  // ----- per day, every topic: the last 7 day files of each journal
  const days = new Map();
  const dayOf = d => { if (!days.has(d)) days.set(d, { d, sent: 0, replies: 0, grades: 0, sessions: 0, handoffs: 0, waits: [] }); return days.get(d); };
  const topics = S.listTopics();
  for (const slug of topics) {
    const J = recentJournal(slug, 7);
    for (const e of J) {
      if (e.imported || !e.ts) continue;
      const x = dayOf(day(e.ts));
      if (e.role === 'user' && ['answer', 'ask', 'action', 'start', 'meta'].includes(e.kind)) x.sent++;
      else if (e.role === 'tutor' && e.kind === 'message') x.replies++;
      else if (e.kind === 'grade') x.grades++;
      else if (e.kind === 'session') { if (e.handoff) x.handoffs++; else x.sessions++; }
    }
    for (const r of replyWaits(J)) dayOf(day(r.at)).waits.push(r.s);
  }
  const dayRows = [...days.values()].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 7)
    .map(({ waits, ...x }) => ({ ...x, waitN: waits.length, waitMedian: waits.length ? Math.round(median(waits)) : null, waitP75: waits.length ? Math.round(p75(waits)) : null }));

  // ----- reply latency of the topic on screen
  let latency = null;
  if (topic && topics.includes(topic)) {
    const rows = replyWaits(recentJournal(topic, 7), weekAgo);
    latency = { topic, week: waitSummary(rows), today: waitSummary(rows.filter(r => day(r.at) === today)),
      felt: waitSummary(rows.filter(r => !r.hidden)), hidden: rows.filter(r => r.hidden).length };
  }

  // ----- delivery
  const ev = logEvents();
  let pending = []; try { pending = T.pendingDeliveries(); } catch {}
  const deliveryOut = {
    since: ev.from, today: delivery(ev, midnight), week: delivery(ev, weekAgo),
    now: { queued: status.queued || 0, unanswered: pending.length, stalled: (status.stalled || []).length },
    redeliverSeconds: Math.round(T.redeliverMs() / 1000), watchdogSeconds: Number(cfg.watchdogSeconds ?? 300),
  };

  // ----- tutor sessions the server has seen (state/sessions.json)
  const recs = readSessions();
  // (their transcripts are read within one small budget per request: app/agent.js `usage`)
  const until = Date.now() + 80;
  const sessions = recs.slice(-8).reverse().map(r => {
    let u = null; try { u = A.usage ? A.usage(r.id, r.id === sess?.id ? 0 : Math.max(0, until - Date.now())) : null; } catch {}
    return { startedAt: r.startedAt, seenAt: r.seenAt, kind: r.kind, topic: r.topic, tokens: r.tokens ?? null, current: live && r.id === sess?.id,
      output: u && !u.partial ? u.output + u.subagents.output : null };
  });

  // ----- background jobs (state/jobs.json keeps the last 50 runs)
  // (read here rather than through jobs.status(), which also counts what's waiting in every journal)
  let jst = {}; try { jst = JSON.parse(fs.readFileSync(path.join(S.STATE, 'jobs.json'), 'utf8')) || {}; } catch {}
  const hist = jst.history || [], jobsRunning = !!jst.runner && T.alive(jst.runner.pid);
  const js = { running: jobsRunning, current: jobsRunning ? jst.current : null, queue: jobsRunning ? jst.queue || [] : [] };
  const mins = h => h.startedAt && h.endedAt ? Math.max(0, (Date.parse(h.endedAt) - Date.parse(h.startedAt)) / 60e3) : 0;
  const wk = hist.filter(h => Date.parse(h.endedAt) >= weekAgo);
  const jobs = {
    running: js.running, current: js.current ? { name: js.current.name, startedAt: js.current.startedAt } : null, queue: js.queue || [],
    week: { runs: wk.length, minutes: Math.round(wk.reduce((a, h) => a + mins(h), 0)), failed: wk.filter(h => h.exit !== 0).length },
    history: hist.slice(-8).reverse().map(h => ({ name: h.name, startedAt: h.startedAt, endedAt: h.endedAt, minutes: Math.round(mins(h) * 10) / 10, exit: h.exit, report: h.report || null })),
    tokens: null,   // a headless run prints only its report: what it used isn't recorded anywhere
  };

  const head = gitHead();
  return {
    at: new Date().toISOString(),
    tutor: {
      phase: status.phase || 'offline', launcher: !!status.launcher, health: status.health || null, context: status.context || null,
      agent: A.name, meter: !!A.usage,
      session: sess && live ? { startedAt: sess.startedAt, kind: sess.kind, topic: sess.topic, turns: sessionTurns(sess), usage,
        guideChangedAt: (g => g && g > sess.startedAt ? g : null)(guideChanged()) } : null,
      limits: { handoffTokens: T.HANDOFF_TOKENS, handoffMessages: T.HANDOFF_MESSAGES, warnAt: WARN_AT, nowAt: NOW_AT },
    },
    sessions: { since: recs[0]?.startedAt || null, list: sessions },
    days: dayRows, latency, delivery: deliveryOut, jobs,
    server: { pid: process.pid, startedAt, uptimeS: Math.round(process.uptime()), node: process.version, port: S.PORT, home: S.shown ? S.shown(S.ROOT) : S.ROOT,
      head, startHead, stale: !!(head && startHead && head.hash !== startHead.hash), pendingRestart, clients, topics: topics.length },
  };
}

module.exports = { replyWaits, waitSummary, recentJournal, tutorHealth, sessionWaits, sessionTurns, guideChanged, noteSession, readSessions, logEvents, delivery, system, WARN_AT, NOW_AT };
