// What this machine needs to run the tutor, checked before `bin/learn` starts and by `bin/learn
// doctor`. The point is a clear "here's what's missing and how to get it", instead of a stack trace
// or an agent that dies silently in the terminal. When something's missing, the way out that
// always works is to hand it to a coding agent: docs/setup.md is written for that.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const S = require('./store');

const run = (cmd, args, timeout = 15000) => spawnSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
const missing = r => r.error && r.error.code === 'ENOENT';

// -> [{ name, ok, detail, fix?, optional? }]
async function checks({ tests = false } = {}) {
  const out = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({ name: 'Node 22+', ok: major >= 22, detail: `node ${process.versions.node}`, fix: 'install Node 22 or newer (https://nodejs.org, or `brew install node`)' });

  const git = run('git', ['--version']);
  out.push({ name: 'git', ok: !git.error && git.status === 0, detail: (git.stdout || '').trim() || 'not found',
    fix: 'install git (macOS: `xcode-select --install`); your learning data is versioned with it' });

  // the agent: skipped for the fake tutor (tests, demo)
  if (!process.env.LEARN_CLAUDE) {
    let A;
    try { A = require('./agent').agent(); } catch (e) { out.push({ name: 'agent config', ok: false, detail: e.message, fix: 'fix "agent" in data/config.json (docs/formats.md, "config.json")' }); }
    if (A) {
      const cmd = A.cmd(), isClaude = A.name === 'claude';
      const v = run(cmd, ['--version']);
      const found = !missing(v);
      out.push({ name: isClaude ? 'Claude Code' : `agent (${cmd})`, ok: found, detail: found ? ((v.stdout || '').trim().split('\n')[0] || cmd) : `\`${cmd}\` not found on PATH`,
        fix: isClaude ? 'install Claude Code (https://claude.com/claude-code), or set "agent" in data/config.json to another CLI agent' : `install ${cmd}, or change "agent" in data/config.json` });
      if (found && isClaude && !process.env.ANTHROPIC_API_KEY) {
        const a = run(cmd, ['auth', 'status']);
        let st = null; try { st = JSON.parse(a.stdout); } catch {}
        // an older Claude Code without `auth status`: can't tell, don't block on it
        if (st && typeof st.loggedIn === 'boolean') out.push({ name: 'Claude Code login', ok: st.loggedIn, detail: st.loggedIn ? `logged in (${st.authMethod || 'ok'})` : 'not logged in',
          fix: 'run `claude` once and log in (or `claude auth login`)' });
      }
    }
  }

  if (tests) {
    let chrome = null;
    try { chrome = (await import(path.join(S.CODE, 'test', 'lib', 'chrome.mjs'))).chromePath(); } catch {}
    out.push({ name: 'Chrome (tests only)', ok: !!chrome, optional: true, detail: chrome || 'not found', fix: 'install Chrome or Chromium, or set CHROME=/path/to/it' });
  }
  return out;
}

const HANDOFF = `Fix the ✗ lines and run bin/learn again, or let an agent sort it out: open Claude Code
(or any coding agent) in ${S.CODE} and say "read docs/setup.md and get this running".`;

function report(list) {
  return list.map(c => `  ${c.ok ? '✓' : c.optional ? '·' : '✗'} ${c.name}: ${c.detail}${c.ok ? '' : `\n      → ${c.fix}`}`).join('\n');
}

// Before starting: prints and returns false when something required is missing.
async function ready() {
  const list = await checks();
  if (list.every(c => c.ok || c.optional)) return true;
  console.error(`learn: not ready to start yet.\n\n${report(list)}\n\n${HANDOFF}`);
  return false;
}

async function cli() {
  const list = await checks({ tests: true });
  console.log(report(list));
  const bad = list.filter(c => !c.ok && !c.optional);
  console.log(bad.length ? `\n${HANDOFF}` : `\nAll set${list.some(c => !c.ok) ? ' (the · line only matters for `bin/learn test`)' : ''}. Run bin/learn.`);
  if (bad.length) process.exitCode = 1;
}

module.exports = { checks, ready, cli };
