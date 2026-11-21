// Tutor session bookkeeping, shared by the launcher, the server and `bin/learn wait`.
//
//   state/session.json   the current tutor session, written by the launcher:
//                        { id, launcherPid, claudePid, topic, kind: fresh|resume|handoff, startedAt, prevTokens }
//   state/handoff.json   a request to replace the tutor with a fresh session:
//                        { at, reason, topic, force }   (written by `bin/learn handoff` or the UI)
//   state/listeners/<pid>  one file per running `bin/learn wait`, containing its session id
//
// Context size comes from the agent adapter (app/agent.js): Claude Code's transcript, or nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./store');

const SESSION_FILE = path.join(S.STATE, 'session.json');
const HANDOFF_FILE = path.join(S.STATE, 'handoff.json');
const LISTENERS = path.join(S.STATE, 'listeners');
// Hand off before the context gets long enough to slow the tutor down or trigger auto-compaction.
// Agents without a context meter hand off after this many tutor messages in one session instead.
const HANDOFF_TOKENS = Number(process.env.LEARN_HANDOFF_TOKENS || S.config().handoffTokens || 400000);
const HANDOFF_MESSAGES = Number(process.env.LEARN_HANDOFF_MESSAGES || S.config().handoffMessages || 80);

const alive = pid => { try { return !!pid && process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; } };

function readSession() { try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return null; } }
function writeSession(s) { S.ensureDir(S.STATE); S.writeJSON(SESSION_FILE, s); }
function launcherAlive(s = readSession()) { return !!s && alive(s.launcherPid); }

function readHandoff() { try { return JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8')); } catch { return null; } }
function requestHandoff(req) { S.ensureDir(S.STATE); S.writeJSON(HANDOFF_FILE, { at: new Date().toISOString(), ...req }); }
function clearHandoff() { try { fs.unlinkSync(HANDOFF_FILE); } catch {} }

// ---------- listeners ----------
function listeners() {
  const out = [];
  try {
    for (const f of fs.readdirSync(LISTENERS)) {
      const pid = Number(f), file = path.join(LISTENERS, f);
      if (alive(pid)) out.push({ pid, session: S.readText(file, '').trim() });
      else try { fs.unlinkSync(file); } catch {}
    }
  } catch {}
  return out;
}
function registerListener(sessionId) {
  S.ensureDir(LISTENERS);
  const me = path.join(LISTENERS, String(process.pid));
  fs.writeFileSync(me, sessionId || '');
  return () => { try { fs.unlinkSync(me); } catch {} };
}
function killListeners() {
  for (const l of listeners()) { try { process.kill(l.pid, 'SIGTERM'); } catch {} }
}

// ---------- context size (Claude Code only; null for other agents) ----------
function contextTokens(id) { return require('./agent').agent().contextTokens(id); }

// ---------- messages the old tutor never answered ----------
// Learner entries after the tutor's last message that are no longer in the inbox: picked up
// by a tutor that was then replaced before it replied. Put them back (recent ones only).
function requeueUnanswered(topic, maxAgeMs = 6 * 3600e3) {
  if (!topic || !S.listTopics().includes(topic)) return [];
  const J = S.readJournal(topic);
  let i = J.length;
  while (i > 0 && !(J[i - 1].role === 'tutor' && J[i - 1].kind === 'message')) i--;
  const queued = new Set(S.inboxIds()), since = Date.now() - maxAgeMs;
  const lost = J.slice(i).filter(e => e.role === 'user' && !e.imported && !queued.has(e.id)
    && Date.parse(e.ts) > since && !isFreshTutorAction(e));
  lost.forEach(S.enqueue);
  return lost;
}
const FRESH_TUTOR = 'fresh tutor';
const isFreshTutorAction = e => e.kind === 'action' && String(e.text).startsWith(FRESH_TUTOR);

module.exports = {
  SESSION_FILE, HANDOFF_FILE, HANDOFF_TOKENS, HANDOFF_MESSAGES, FRESH_TUTOR, alive,
  readSession, writeSession, launcherAlive, readHandoff, requestHandoff, clearHandoff,
  listeners, registerListener, killListeners, contextTokens, requeueUnanswered, isFreshTutorAction,
};
