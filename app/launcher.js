// `bin/learn [topic]`: start the web server, open the browser, and supervise the tutor agent.
//
// The launcher runs the agent (Claude Code by default, see app/agent.js) in this terminal and keeps
// a record of the session in state/session.json. When a handoff is requested (state/handoff.json:
// by the tutor itself when its context gets large or the learner switches topic, or by the
// learner's "Fresh tutor" button), it stops that session and starts a new one with a handoff
// prompt. The new tutor rebuilds its picture with `bin/learn resume`, so the learner just sees
// "switching tutor" for a few seconds.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const S = require('./store');
const T = require('./session');
const { agent, agentEnv } = require('./agent');
const { api, serverUp, openBrowser } = require('./client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BIN = path.join(S.CODE, 'bin', 'learn');
// Paths in prompts: relative to the tutor's cwd (the code checkout) where possible.
const rel = p => { const r = path.relative(S.CODE, p); return r.startsWith('..') ? p : r; };
const bin = rel(BIN);

function prompts(kind, topic, url, prevTokens) {
  const read = `Read docs/protocol.md (the loop, short) and docs/method.md (how to teach).`;
  const quiet = `Keep terminal output minimal: everything the learner should read goes through \`${bin} post\`.`;
  if (kind === 'resume') return `The learning web UI was restarted (${url}). Re-read docs/protocol.md if you need to, then re-arm the listener: run \`${bin} wait\` in the background, and continue the tutoring loop.`;
  if (kind === 'handoff' && topic) return `Web tutoring mode, HANDOFF. You replace a previous tutor session for this learner that was ended to free up context${prevTokens ? ` (it had used ~${Math.round(prevTokens / 1000)}k tokens)` : ''} or to switch topic. The learner is in the browser at ${url} and should notice as little as possible.
${read} ${quiet}
Topic: ${topic}. Run \`${bin} resume ${topic}\`: it prints the notes the previous tutor just saved, the skill tree, the pending question with its rubric, open notes and the last messages. Use \`${bin} grep\`/\`show\` for anything older.
Do NOT greet, recap or post anything now. Messages the old tutor didn't answer are already queued for you. Just start \`${bin} wait\` in the background and continue the loop when it returns.`;
  // fresh start: idle until the learner sends something. The browser decides which topic (and
  // whether they want a recap: the "welcome back" bar sends an action); the tutor loads a topic
  // only when a message for it arrives.
  return `Web tutoring mode, started by bin/learn. The learner is in the browser at ${url}${S.listTopics().length ? '' : '; there are no topics yet, they create one there'}.
${read} ${quiet}
Start \`${bin} wait\` in the background now and post nothing until the learner writes. When a message arrives, \`wait\` says which topic it is for: run \`${bin} resume <topic>\` first (once per topic), then reply. A START message means a new topic: follow docs/bootstrap.md.`;
}

async function ensureServer() {
  if (await serverUp()) return false;
  S.ensureDir(S.STATE);
  const log = fs.openSync(path.join(S.STATE, 'server.log'), 'a');
  const server = spawn(process.execPath, [BIN, 'serve'], { detached: true, stdio: ['ignore', log, log], env: process.env });
  server.unref();
  for (let i = 0; i < 50 && !(await serverUp()); i++) await sleep(100);
  if (!(await serverUp())) throw new Error('server failed to start, see state/server.log');
  return true;
}

// Resolves with { exit: code } when the agent exits on its own, or { handoff } when one is requested.
function runOnce(cmd, args, env) {
  const child = spawn(cmd, args, { stdio: 'inherit', cwd: S.CODE, env });
  const done = new Promise(resolve => {
    let timer = null, watcher = null;
    const finish = v => { clearInterval(timer); try { watcher?.close(); } catch {} resolve(v); };
    const check = () => { const h = T.readHandoff(); if (h) finish({ handoff: h, child }); };
    try { watcher = fs.watch(S.STATE, (_e, f) => { if (f === 'handoff.json') setTimeout(check, 50); }); } catch {}
    timer = setInterval(check, 1000);
    // a tutor may exit right after asking for a handoff: that's still a handoff
    child.on('exit', code => { const h = T.readHandoff(); finish(h ? { handoff: h } : { exit: code ?? 0 }); });
    child.on('error', e => finish({ error: e }));
  });
  return { child, done };
}

async function stop(child) {
  if (child.exitCode != null) return;
  const exited = new Promise(r => child.once('exit', r));
  child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) return;
  child.kill('SIGKILL');
  await exited;
}

async function start({ topic: openTopic, resume, open = true, claudeArgs = [] }) {
  S.ensureHome();
  const startedServer = await ensureServer();
  const url = `http://localhost:${S.PORT}/${openTopic ? '#/' + openTopic : ''}`;
  // the tutor starts idle and adopts a topic when a message arrives (`-c` keeps the old session's)
  let topic = resume ? (T.readSession()?.topic || null) : null;
  console.log(`learn: ${url}${open && !openBrowser(url) ? '  (open it in your browser)' : ''}`);
  process.on('SIGINT', () => {});            // Ctrl+C belongs to the agent
  let current = null;
  const shutdown = async (code, signal) => {
    T.clearHandoff();
    if (signal && current) await stop(current);        // we were killed: take the tutor down with us
    T.killListeners();
    // the server may have restarted itself (after a code change), so ask it rather than kill a pid
    if (startedServer) await api('POST', '/api/shutdown').catch(() => {});
    process.exit(code);
  };
  process.on('SIGTERM', () => shutdown(143, true));
  process.on('SIGHUP', () => shutdown(129, true));
  // started by another process that must outlive us (bin/learn demo): stop when it's gone
  const parent = Number(process.env.LEARN_PARENT_PID) || 0;
  if (parent) setInterval(() => { try { process.kill(parent, 0); } catch { shutdown(129, true); } }, 2000).unref();

  const A = agent();
  T.clearHandoff();
  const prev = T.readSession();
  let kind = resume && A.sessions ? 'resume' : 'fresh', prevTokens = null;
  for (;;) {
    const id = kind === 'resume' && prev?.id ? prev.id : randomUUID();
    const args = [...A.interactive({ kind, id, resumeId: prev?.id, prompt: prompts(kind, topic, url, prevTokens) }), ...claudeArgs];
    // move the prompt (last arg of interactive()) after any extra args
    if (claudeArgs.length) args.push(args.splice(args.length - claudeArgs.length - 1, 1)[0]);
    if (topic) S.appendJournal(topic, [{ role: 'system', kind: 'session', text: kind === 'handoff' ? 'Fresh tutor took over' : 'Session started', ...(kind === 'handoff' ? { handoff: true } : {}) }]);
    const startedAt = Date.now();
    const run = runOnce(A.cmd(), args, agentEnv({ LEARN_SESSION: id }));
    current = run.child;
    T.writeSession({ id, launcherPid: process.pid, claudePid: run.child.pid, agent: A.name, topic, kind, startedAt: new Date().toISOString(), prevTokens });
    const r = await run.done;
    if (r.error) {
      console.error(`learn: could not start ${A.cmd()}: ${r.error.message}` + (r.error.code === 'ENOENT'
        ? `\n${A.cmd()} isn't on your PATH. Install it (Claude Code: https://claude.com/claude-code), or set "agent" in ${path.join(S.ROOT, 'config.json')} to another CLI agent (docs/formats.md, "config.json").` : ''));
      return shutdown(1);
    }
    if (!r.handoff) {
      // gone within seconds with an error: it never got going, so say what usually causes that
      if (r.exit && Date.now() - startedAt < 30000) console.error(`\nlearn: the agent (${A.cmd()}) stopped right after starting (exit ${r.exit}). Its message is above.
Common causes: not logged in (run \`${A.cmd()}\` once), or the permission mode isn't available on this account
(set "tutorPermissionMode": "acceptEdits" in ${path.join(S.ROOT, 'config.json')}; docs/formats.md, "config.json").
\`bin/learn doctor\` checks the rest, or open a coding agent here and ask it to read docs/setup.md.`);
      return shutdown(r.exit);
    }

    // ---- handoff: let the tutor's last tool call return, stop it, start a fresh one
    const h = r.handoff;
    prevTokens = T.contextTokens(id)?.tokens || null;
    if (!h.force) await sleep(1500);
    await stop(run.child);
    T.killListeners();
    if (h.topic && S.listTopics().includes(h.topic)) topic = h.topic;
    const lost = T.requeueUnanswered(topic);
    T.clearHandoff();
    process.stdout.write(`\n\x1b[2m── learn: fresh tutor session (${h.reason || 'handoff'}${prevTokens ? `, previous context ~${Math.round(prevTokens / 1000)}k tokens` : ''}${lost.length ? `, ${lost.length} message(s) requeued` : ''}) ──\x1b[0m\n\n`);
    kind = 'handoff';
  }
}

module.exports = { start, prompts };
