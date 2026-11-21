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
  env: () => ({ ENABLE_CLAUDEAI_MCP_SERVERS: S.config().agentMcp ? undefined : 'false' }),
  contextTokens,
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
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
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

module.exports = { agent, agentEnv, contextTokens };
