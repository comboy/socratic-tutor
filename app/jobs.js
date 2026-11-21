// Background jobs that run while the learner is away ("I'm away" in the UI, or `bin/learn away`).
//
// Each job is a headless agent run (app/agent.js) with the prompt in docs/jobs/<name>.md plus a
// short context header. Jobs run one after another in a detached runner process, so they survive
// the server restarting itself. State: state/jobs.json. Output: state/jobs/<stamp>-<name>.log, and
// the agent's final message becomes a report in reports/<stamp>-<name>.md, which the UI shows.
//
//   bin/learn away                     default jobs (config "awayJobs", else builder + reviewer)
//   bin/learn away builder wiki        these jobs, in this order
//   bin/learn away --list | --stop
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const S = require('./store');
const T = require('./session');
const { agent, agentEnv } = require('./agent');

const JOBS_DIR = path.join(S.CODE, 'docs', 'jobs');
const STATE_FILE = path.join(S.STATE, 'jobs.json');
const LOGS = path.join(S.STATE, 'jobs');
const BIN = path.join(S.CODE, 'bin', 'learn');

// name -> { title, desc } from the first lines of docs/jobs/<name>.md ("# Title" + first paragraph)
function available() {
  let files = [];
  try { files = fs.readdirSync(JOBS_DIR).filter(f => /^[a-z][a-z0-9-]*\.md$/.test(f)); } catch {}
  const order = ['builder', 'reviewer', 'wiki', 'janitor'];
  return files.map(f => {
    const text = S.readText(path.join(JOBS_DIR, f), '');
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.slice(0, -3);
    const desc = (text.replace(/^#.*$/m, '').split(/\n\s*\n/).map(s => s.trim()).find(Boolean) || '').replace(/\s+/g, ' ');
    return { name: f.slice(0, -3), title, desc };
  }).sort((a, b) => ((order.indexOf(a.name) + 1) || 99) - ((order.indexOf(b.name) + 1) || 99) || a.name.localeCompare(b.name));
}

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { runner: null, current: null, queue: [], history: [] }; } }
function writeState(st) { S.ensureDir(S.STATE); S.writeJSON(STATE_FILE, st); }
function running(st = readState()) { return !!st.runner && T.alive(st.runner.pid); }

// Things each job may want to know about (shown next to the checkboxes in the UI).
function counts() {
  const out = { feedback: S.openFeedback().length, sessionsSinceReview: 0 };
  const last = readState().history.filter(h => h.name === 'reviewer' && h.exit === 0).pop();
  const since = last ? last.endedAt : '';
  for (const slug of S.listTopics()) out.sessionsSinceReview += S.readJournal(slug).filter(e => e.kind === 'session' && !e.handoff && e.ts > since).length;
  return out;
}

function reports(n = 20) {
  let files = [];
  try { files = fs.readdirSync(S.REPORTS).filter(f => f.endsWith('.md')).sort().reverse().slice(0, n); } catch {}
  return files.map(f => {
    const text = S.readText(path.join(S.REPORTS, f), '');
    return { file: f, name: (f.match(/^\d{4}-\d{2}-\d{2}-\d{4}-(.+)\.md$/) || [])[1] || f, at: fs.statSync(path.join(S.REPORTS, f)).mtime.toISOString(), title: (text.match(/^#\s+(.+)$/m) || [])[1] || f };
  });
}
function readReport(file) {
  if (!/^[\w.-]+\.md$/.test(file)) throw new Error('bad report name');
  return S.readText(path.join(S.REPORTS, file), null);
}

function status() {
  const st = readState();
  const live = running(st);
  return { running: live, current: live ? st.current : null, queue: live ? st.queue : [], history: st.history.slice(-12).reverse(),
    available: available(), counts: counts(), reports: reports(), agent: agent().name };
}

function stamp(d = new Date()) { const z = n => String(n).padStart(2, '0'); return `${S.localDate(d)}-${z(d.getHours())}${z(d.getMinutes())}`; }

function promptFor(name, reportFile) {
  const body = S.readText(path.join(JOBS_DIR, name + '.md'), null);
  if (body == null) throw new Error(`no job ${name} (docs/jobs/${name}.md)`);
  const rel = p => path.relative(S.CODE, p) || '.';
  return `You are running as a background job ("${name}") for the learning workspace in ${S.CODE}, while the learner is away from the keyboard. Nobody is watching: never ask questions or wait for input; make sensible decisions and list open questions in your final message.
- Code (shareable, no personal data): ${S.CODE}. Commit code changes there with git, in small commits.
- Learner data (personal, its own git repo): ${rel(S.ROOT)}/. Commit data changes with \`bin/learn commit "…"\`. Never copy personal data into the code repo.
- A live tutor session may be running: never touch ${rel(S.STATE)}/, never post to the learner, never stop processes, and run the UI only through \`bin/learn test\` / \`bin/learn demo\` (they use throwaway copies and other ports).
- Read AGENTS.md first for the layout of the repo.
- Your final message is saved verbatim as the report the learner reads when they're back (${rel(reportFile)}). Start it with a "# " title line, then keep it short and concrete: what you did (with commit hashes or file names), what you skipped and why, anything that needs their decision.

${body}`;
}

// ---------------------------------------------------------------- runner (detached process)
async function runAll(names) {
  const st = readState();
  st.runner = { pid: process.pid, startedAt: new Date().toISOString() };
  st.queue = [...names];
  writeState(st);
  const headBefore = gitHead();
  for (const name of names) {
    const s = readState(); s.queue = s.queue.filter(n => n !== name);
    const startedAt = new Date().toISOString(), id = `${stamp()}-${name}`;
    const reportFile = path.join(S.REPORTS, id + '.md'), logFile = path.join(LOGS, id + '.log');
    s.current = { name, startedAt, log: path.relative(S.ROOT, logFile) };
    writeState(s);
    S.ensureDir(LOGS); S.ensureDir(S.REPORTS);
    let exit = 1, out = '';
    try {
      const A = agent();
      const log = fs.openSync(logFile, 'a');
      const child = spawn(A.cmd(), A.headless({ prompt: promptFor(name, reportFile) }), { cwd: S.CODE, env: agentEnv({ LEARN_JOB: name }), stdio: ['ignore', 'pipe', log] });
      child.stdout.on('data', d => { out += d; fs.appendFileSync(logFile, d); });
      exit = await new Promise(res => { child.on('exit', c => res(c ?? 1)); child.on('error', e => { fs.appendFileSync(logFile, String(e)); res(1); }); });
    } catch (e) { out = `# ${name}: could not start\n\n${e.message}`; }
    const text = out.trim() || `# ${name}: no output\n\nThe job exited with code ${exit}. Log: ${path.relative(S.ROOT, logFile)}`;
    fs.writeFileSync(reportFile, /^# /.test(text) ? text + '\n' : `# ${name}\n\n${text}\n`);
    const s2 = readState();
    s2.history.push({ name, startedAt, endedAt: new Date().toISOString(), exit, report: path.basename(reportFile) });
    s2.history = s2.history.slice(-50);
    s2.current = null;
    writeState(s2);
  }
  const s3 = readState(); s3.runner = null; s3.queue = []; writeState(s3);
  // code changed (builder/janitor commits)? let the server reload itself
  if (gitHead() !== headBefore) await require('./client').api('POST', '/api/restart', { reason: 'code changed by background jobs' }).catch(() => {});
}
function gitHead() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: S.CODE, encoding: 'utf8' }).trim(); } catch { return null; } }

// Start the runner detached. Returns the status.
function start(names) {
  if (running()) throw new Error('jobs are already running');
  const known = new Set(available().map(j => j.name));
  names = (names && names.length ? names : S.config().awayJobs || ['builder', 'reviewer']).filter(Boolean);
  for (const n of names) if (!known.has(n)) throw new Error(`unknown job ${n} (have: ${[...known].join(', ')})`);
  S.ensureDir(LOGS);
  const out = fs.openSync(path.join(LOGS, 'runner.log'), 'a');
  const child = spawn(process.execPath, [BIN, 'away', '--run', names.join(',')], { detached: true, stdio: ['ignore', out, out], env: process.env, cwd: S.CODE });
  child.unref();
  const st = readState(); st.runner = { pid: child.pid, startedAt: new Date().toISOString() }; st.queue = names; st.current = null; writeState(st);
  return status();
}
function stop() {
  const st = readState();
  if (!running(st)) return status();
  try { process.kill(-st.runner.pid, 'SIGTERM'); } catch { try { process.kill(st.runner.pid, 'SIGTERM'); } catch {} }
  if (st.current) st.history.push({ name: st.current.name, startedAt: st.current.startedAt, endedAt: new Date().toISOString(), exit: 'stopped' });
  st.runner = null; st.current = null; st.queue = [];
  writeState(st);
  return status();
}

function cli(argv) {
  const i = argv.indexOf('--run');
  if (i >= 0) return runAll(argv[i + 1].split(','));
  if (argv.includes('--stop')) { stop(); console.log('stopped'); return; }
  if (argv.includes('--list')) {
    const s = status();
    for (const j of s.available) console.log(`${j.name.padEnd(10)} ${j.title}: ${j.desc.slice(0, 120)}`);
    console.log(`\n${s.running ? `running: ${s.current?.name || 'starting'}${s.queue.length ? ', then ' + s.queue.join(', ') : ''}` : 'nothing running'} · agent ${s.agent} · ${s.counts.feedback} open feedback item(s)`);
    for (const h of s.history.slice(0, 5)) console.log(`  ${h.endedAt.slice(0, 16).replace('T', ' ')} ${h.name} exit ${h.exit}${h.report ? ' → reports/' + h.report : ''}`);
    return;
  }
  const s = start(argv.filter(a => !a.startsWith('-')));
  console.log(`started: ${s.queue.join(', ')} (reports go to ${path.relative(S.CODE, S.REPORTS)}/)`);
}

module.exports = { available, status, start, stop, reports, readReport, cli, runAll };
