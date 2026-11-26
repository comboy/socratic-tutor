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

const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
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
      if (alive(pid)) out.push({ pid, session: S.readText(file, '').trim(), since: mtime(file) });
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

// ---------- the learner's instructions: which version this session has seen ----------
// resume shows them (in the profile); if the learner edits them in the UI during the session,
// `wait` prints the new version once, with the next message.
const SEEN_FILE = path.join(S.STATE, 'instructions-seen.json');
const instrHash = () => require('crypto').createHash('sha1').update(S.readInstructions()).digest('hex').slice(0, 12);
function markInstructionsSeen(sessionId) {
  if (!sessionId) return;
  S.ensureDir(S.STATE);
  S.writeJSON(SEEN_FILE, { session: sessionId, hash: instrHash() });
}
// -> the new text if this session saw an older version, else null
function instructionsChanged(sessionId) {
  if (!sessionId) return null;
  let seen = null; try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch {}
  if (seen?.session === sessionId) {
    if (seen.hash === instrHash()) return null;
  } else {
    // no record for this session (it never ran resume, or it predates this): it has seen the
    // profile as it was when it started, so it's news only if the profile changed since
    const sess = readSession();
    let mtime = 0; try { mtime = fs.statSync(S.profilePath()).mtimeMs; } catch {}
    const started = sess?.id === sessionId ? Date.parse(sess.startedAt) : Infinity;
    if (!(mtime > started)) { markInstructionsSeen(sessionId); return null; }
  }
  markInstructionsSeen(sessionId);
  return S.readInstructions();
}

// ---------- context size (Claude Code only; null for other agents) ----------
function contextTokens(id) { return require('./agent').agent().contextTokens(id); }

// ---------- messages the old tutor never answered ----------
// Learner messages a tutor picked up (they're out of the inbox) but never answered, because it was
// replaced, stopped or crashed: put them back in the queue (recent ones only). Answered means a
// later tutor message names it (replyTo; a grade names it as target) or, for a lesson message, a
// later lesson message in its thread. An action (a button) counts as handled by any later tutor
// message or thread change: its reply may go anywhere.
function unanswered(J, since) {
  const out = [];
  for (let i = 0; i < J.length; i++) {
    const u = J[i];
    if (u.role !== 'user' || u.imported || Date.parse(u.ts) <= since || isFreshTutorAction(u)) continue;
    if (!['answer', 'ask', 'action', 'start', 'meta'].includes(u.kind)) continue;
    let done = false;
    for (let k = i + 1; k < J.length && !done; k++) {
      const e = J[k];
      if (e.role !== 'tutor') continue;
      if (e.kind === 'grade' && e.target === u.id) done = true;
      else if (e.kind === 'tracks' && u.kind === 'action') done = true;
      else if (e.kind === 'message') done = e.replyTo === u.id || (!e.meta && (u.kind === 'action' || S.trackOf(e) === S.trackOf(u)));
    }
    if (!done) out.push(u);
  }
  return out;
}
function requeueUnanswered(topic, maxAgeMs = 6 * 3600e3) {
  if (!topic || !S.listTopics().includes(topic)) return [];
  const queued = new Set(S.inboxEntries().map(e => `${e.topic}/${e.id}`));
  const lost = unanswered(S.readJournal(topic), Date.now() - maxAgeMs).filter(e => !queued.has(`${topic}/${e.id}`));
  lost.forEach(S.enqueue);
  return lost;
}
const FRESH_TUTOR = 'fresh tutor';
const isFreshTutorAction = e => e.kind === 'action' && String(e.text).startsWith(FRESH_TUTOR);

module.exports = {
  SESSION_FILE, HANDOFF_FILE, HANDOFF_TOKENS, HANDOFF_MESSAGES, FRESH_TUTOR, alive,
  readSession, writeSession, launcherAlive, readHandoff, requestHandoff, clearHandoff,
  listeners, registerListener, killListeners, markInstructionsSeen, instructionsChanged, contextTokens, requeueUnanswered, isFreshTutorAction,
};
