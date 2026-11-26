// Which CLI agent is the tutor (interactive, in the terminal) and runs background jobs (headless).
//
// Default: Claude Code. Another agent can be configured in <data>/config.json:
//
//   { "agent": "claude" }                                   (default)
//   { "agent": { "cmd": "codex", "interactive": ["{prompt}"], "headless": ["exec", "{prompt}"] } }
//
// A generic agent has no session ids and no context meter, so handoffs happen by message count
// (config "handoffMessages", default 80) instead of by tokens. Everything the tutor needs is in
// AGENTS.md and docs/, so any agent that can run shell commands can tutor.
// LEARN_CLAUDE overrides the command (tests use test/fake-tutor.mjs, which speaks Claude's flags).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./store');

// Permissions. The tutor runs in a terminal nobody watches (the learner is in the browser) and jobs
// run headless, so a permission prompt would stall either one. Both run in Claude Code's "auto"
// mode by default: it allows ordinary work (any tool, e.g. building a visualization) and blocks
// risky actions, without asking. Config: "tutorPermissionMode" / "jobPermissionMode" pick another
// mode, "tutorTools" / "jobTools" add an --allowedTools list, "tutorPermissions": "ask" leaves
// the tutor to Claude Code's own settings.
function perms(mode, tools) {
  return [...(mode ? ['--permission-mode', mode] : []), ...(tools?.length ? ['--allowedTools', ...tools] : [])];
}

const claude = {
  name: 'claude',
  cmd: () => process.env.LEARN_CLAUDE || 'claude',
  sessions: true,
  // kind: fresh | resume | handoff. Without MCP servers: the tutor never uses them, and their tool
  // lists cost context in every session (config "agentMcp": true keeps them).
  interactive({ kind, id, resumeId, prompt }) {
    const lean = S.config().agentMcp ? [] : ['--strict-mcp-config'];
    const sess = kind === 'resume' ? (resumeId ? ['--resume', resumeId] : ['--continue']) : ['--session-id', id];
    const c = S.config();
    const p = c.tutorPermissions === 'ask' ? [] : perms(c.tutorPermissionMode || 'auto', c.tutorTools);
    // "--" ends the options: --allowedTools takes any number of values and would swallow the prompt.
    return [...sess, ...lean, ...p, '--', prompt];
  },
  headless({ prompt }) {
    const c = S.config();
    return ['-p', prompt, ...perms(c.jobPermissionMode || 'auto', c.jobTools),
      ...(c.agentMcp ? [] : ['--strict-mcp-config'])];
  },
  // CLAUDECODE / CLAUDE_CODE_ENTRYPOINT: set inside a Claude Code session. Inherited (bin/learn run
  // from an agent's shell, as docs/setup.md suggests), they make the tutor's `claude` refuse to
  // start as a "nested session"; the tutor is a session of its own, in its own terminal or headless.
  env: () => ({ ENABLE_CLAUDEAI_MCP_SERVERS: S.config().agentMcp ? undefined : 'false', CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined }),
  contextTokens,
  lastActivity,
};

function generic(spec) {
  const fill = (arr, prompt) => (arr || ['{prompt}']).map(a => a.replace('{prompt}', prompt));
  return {
    name: spec.name || spec.cmd,
    cmd: () => spec.cmd,
    sessions: false,
    interactive: ({ prompt }) => fill(spec.interactive, prompt),
    headless: ({ prompt }) => fill(spec.headless || spec.interactive, prompt),
    env: () => spec.env || {},
    contextTokens: () => null,
  };
}

function agent() {
  const a = S.config().agent;
  if (!a || a === 'claude') return claude;
  if (typeof a === 'object' && a.cmd) return a.cmd === 'claude' && !a.interactive ? claude : generic(a);
  throw new Error(`config.json: unknown agent ${JSON.stringify(a)} (use "claude" or {"cmd": …, "interactive": […], "headless": […]})`);
}
function agentEnv(extra = {}) {
  const env = { ...process.env, ...agent().env(), ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];   // undefined: not passed on
  return env;
}

// ---------- context size from the Claude Code transcript ----------
// (~/.claude/projects/*/<session id>.jsonl): the last assistant turn's input + cache + output tokens.
const transcriptCache = new Map();
function claudeHome() { return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'); }
function findTranscript(id) {
  if (!id) return null;
  const hit = transcriptCache.get(id);
  if (hit && fs.existsSync(hit)) return hit;
  const projects = path.join(claudeHome(), 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projects); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(projects, d, id + '.jsonl');
    if (fs.existsSync(f)) { transcriptCache.set(id, f); return f; }
  }
  return null;
}
// -> { tokens, model } or null when unknown (no transcript yet, or not a real claude)
function contextTokens(id) {
  const f = findTranscript(id);
  if (!f) return null;
  let fd;
  try {
    fd = fs.openSync(f, 'r');
    const size = fs.fstatSync(fd).size, n = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      let d; try { d = JSON.parse(lines[i]); } catch { continue; }
      if (d.type !== 'assistant' || d.isSidechain || !d.message?.usage) continue;
      const u = d.message.usage;
      const tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
      return { tokens, model: d.message.model || null };
    }
  } catch {} finally { if (fd != null) fs.closeSync(fd); }
  return null;
}

// When the session last wrote to its transcript, or one of its subagents to theirs (ms; null when
// there's no transcript). A working agent writes every tool call and result; one whose turn has
// ended, or that sits at a prompt, writes nothing. A single command that runs for minutes in the
// foreground looks the same as idle, so whoever reads this should allow for that.
function lastActivity(id) {
  const f = findTranscript(id);
  if (!f) return null;
  let t = 0;
  try { t = fs.statSync(f).mtimeMs; } catch { return null; }
  const sub = path.join(f.replace(/\.jsonl$/, ''), 'subagents');
  try { for (const n of fs.readdirSync(sub)) if (n.endsWith('.jsonl')) { try { t = Math.max(t, fs.statSync(path.join(sub, n)).mtimeMs); } catch {} } } catch {}
  return t;
}

// What a session has used so far, summed over its transcript (and its subagents' transcripts):
// { turns, input, cacheWrite, cacheRead, output, subagents: { n, turns, input, … } }, or null when
// there's no transcript. One API call is written as several lines (one per content block) carrying
// the same usage, so calls are counted once, by message id. Every call re-reads the whole context
// (mostly from the cache), so cacheRead is by far the largest number and grows with the square of
// the session's length; output is what the model actually wrote. Read incrementally and cached:
// the System page asks every few seconds, a transcript grows to many MB. A first read of a long
// session with subagents takes a second or more, and the server answers the learner's messages on
// the same thread: so each call reads for at most `budgetMs` and says `partial` until it has
// caught up (the next call carries on where this one stopped).
const usageCache = new Map();   // file -> { off, rest, dec, ids, sum }
const zero = () => ({ turns: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
function scanUsage(file, until = Infinity) {
  let size; try { size = fs.statSync(file).size; } catch { return null; }
  let c = usageCache.get(file);
  if (!c || size < c.off) c = { off: 0, rest: '', dec: new (require('string_decoder').StringDecoder)('utf8'), ids: new Map(), sum: zero() };
  if (size > c.off) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(Math.min(4 << 20, size - c.off));
      while (c.off < size && Date.now() < until) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - c.off), c.off);
        if (!n) break;
        c.off += n;
        const lines = (c.rest + c.dec.write(buf.subarray(0, n))).split('\n');
        c.rest = lines.pop();
        for (const line of lines) {
          if (!line.includes('"usage"')) continue;
          let d; try { d = JSON.parse(line); } catch { continue; }
          const u = d.type === 'assistant' && d.message?.usage;
          if (!u) continue;
          const now = { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
          const id = d.message.id || d.uuid || `${c.off}:${c.ids.size}`, was = c.ids.get(id);
          if (!was) c.sum.turns++;
          for (const k of Object.keys(now)) c.sum[k] += now[k] - (was ? was[k] : 0);
          c.ids.set(id, now);
        }
      }
    } catch {} finally { if (fd != null) fs.closeSync(fd); }
  }
  usageCache.delete(file); usageCache.set(file, c);
  if (usageCache.size > 60) usageCache.delete(usageCache.keys().next().value);
  return { ...c.sum, partial: c.off < size };
}
function usage(id, budgetMs = 120) {
  const f = findTranscript(id), until = Date.now() + budgetMs;
  const main = f && scanUsage(f, until);
  if (!main) return null;
  const sub = { n: 0, ...zero() };
  const dir = path.join(f.replace(/\.jsonl$/, ''), 'subagents');
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith('.jsonl')) continue;
      const u = scanUsage(path.join(dir, n), until);
      if (!u) continue;
      sub.n++;
      if (u.partial) main.partial = true;
      for (const k of Object.keys(zero())) sub[k] += u[k];
    }
  } catch {}
  return { ...main, subagents: sub };
}
claude.usage = usage;

module.exports = { agent, agentEnv, contextTokens, lastActivity };
