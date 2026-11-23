// Background jobs that run while the learner is away ("I'm going away" in the UI, or `bin/learn away`).
//
// Each job is a headless agent run (app/agent.js) with the prompt in docs/jobs/<name>.md plus a
// short context header. Jobs run one after another in a detached runner process, so they survive
// the server restarting itself. State: state/jobs.json. Output: state/jobs/<stamp>-<name>.log, and
// the agent's final message becomes a report in reports/<stamp>-<name>.md, which the UI shows.
//
// The button doesn't ask which jobs: the learner only signals that they're away. A first, short
// agent run (docs/jobs/plan.md, given snapshot() of what's waiting) decides which jobs are worth
// running and why, and briefs each one; the runner then runs them in that order.
//
//   bin/learn away                     plan first, then the planned jobs (config "awayJobs" overrides)
//   bin/learn away builder wiki        these jobs, in this order, no planning
//   bin/learn away --snapshot          what the planner is shown
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

// name -> { title, desc } from the first lines of docs/jobs/<name>.md ("# Title" + first paragraph).
// The planner is not a job you pick; it's how the others get picked.
const PLANNER = 'plan';
function available() {
  let files = [];
  try { files = fs.readdirSync(JOBS_DIR).filter(f => /^[a-z][a-z0-9-]*\.md$/.test(f) && f !== PLANNER + '.md'); } catch {}
  const order = ['builder', 'reviewer', 'wiki', 'janitor', 'task'];
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
// glossary terms of the focus skill (and its children) that have no term page yet
function focusTermsWithoutPage(slug) {
  const meta = S.loadTopicMeta(slug), G = S.readGlossary(slug), TP = S.readTermPages(slug);
  const near = new Set(); if (meta.focus) { const f = S.findSkill(meta, meta.focus); if (f) S.walkSkills([f], x => near.add(String(x.id))); }
  return G.filter(g => !S.pageForTerm(g, TP) && g.skills.some(x => near.has(String(x)))).map(g => g.term);
}
function counts() {
  const out = { feedback: S.openFeedback().length, sessionsSinceReview: 0 };
  const last = readState().history.filter(h => h.name === 'reviewer' && h.exit === 0).pop();
  const since = last ? last.endedAt : '';
  out.focusTermsWithoutPage = 0;
  for (const slug of S.listTopics()) {
    out.sessionsSinceReview += S.readJournal(slug).filter(e => e.kind === 'session' && !e.handoff && e.ts > since).length;
    try { out.focusTermsWithoutPage += focusTermsWithoutPage(slug).length; } catch {}
  }
  return out;
}

// What's waiting, for the planner (and `bin/learn away --snapshot`): cheap facts it would otherwise
// spend its run collecting. It can look further itself.
function snapshot() {
  const st = readState(), now = Date.now();
  const ago = t => { if (!t) return 'never'; const h = (now - Date.parse(t)) / 36e5; return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
  const lastRun = n => st.history.filter(h => h.name === n && h.exit === 0).pop();
  const out = [`Now: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`];
  const fb = S.openFeedback();
  out.push('', `## Feedback queue: ${fb.length} open item${fb.length === 1 ? '' : 's'} (${path.relative(S.CODE, S.FEEDBACK)})`);
  for (const f of fb) out.push('- ' + f.replace(/^- \[ \] /, '').replace(/\s+/g, ' ').slice(0, 220) + (f.length > 230 ? '…' : ''));
  out.push('', '## Jobs: last successful run');
  for (const j of available()) { const r = lastRun(j.name); out.push(`- ${j.name}: ${r ? `${ago(r.endedAt)} (reports/${r.report})` : 'never'}`); }
  const failed = st.history.filter(h => h.exit !== 0).slice(-3);
  if (failed.length) out.push(`- recent failures: ${failed.map(h => `${h.name} (${h.exit}, ${ago(h.endedAt)})`).join(', ')}`);
  const lastRev = lastRun('reviewer')?.endedAt || '', lastWiki = lastRun('wiki')?.endedAt || '';
  let check = null; try { check = require('./check'); } catch {}
  for (const slug of S.listTopics()) {
    let meta; try { meta = S.loadTopicMeta(slug); } catch { continue; }
    const J = S.readJournal(slug), last = J.at(-1);
    const sess = J.filter(e => e.kind === 'session' && !e.handoff);
    const learnerMsgs = since => J.filter(e => e.role === 'user' && e.ts > since).length;
    out.push('', `## Topic ${slug}: ${meta.title || slug}`, `- last activity ${ago(last?.ts)}; focus ${meta.focus || '-'}; ${J.length} journal entries`,
      `- since the last review: ${sess.filter(e => e.ts > lastRev).length} session(s), ${learnerMsgs(lastRev)} learner message(s)`,
      `- since the last wiki run: ${learnerMsgs(lastWiki)} learner message(s)`);
    try {
      const G = S.readGlossary(slug), TP = S.readTermPages(slug), todo = focusTermsWithoutPage(slug);
      out.push(`- term pages: ${G.filter(g => S.pageForTerm(g, TP)).length} of ${G.length} terms${todo.length ? `; focus terms without one: ${todo.slice(0, 12).join(', ')}${todo.length > 12 ? ` (+${todo.length - 12})` : ''}` : ''}`);
      out.push(`- wiki pages: ${S.readPages(slug).length}`);
    } catch {}
    try { const n = S.readNotes(slug).items.filter(x => x.status === 'open'); out.push(`- open notes: ${n.length} (${S.NOTE_KINDS.map(k => `${n.filter(x => x.kind === k).length} ${k}`).join(', ')})`); } catch {}
    try { const sr = check?.staleNoteRefs(slug) || []; if (sr.length) out.push(`- progress.md names closed notes: ${sr.map(r => r.id).join(', ')} (stale "Resume here")`); } catch {}
  }
  try {
    const lastJ = lastRun('janitor')?.endedAt;
    const n = execFileSync('git', ['rev-list', '--count', ...(lastJ ? [`--since=${lastJ}`] : []), 'HEAD'], { cwd: S.CODE, encoding: 'utf8' }).trim();
    out.push('', `## Code: ${n} commit(s) since the last janitor run`);
  } catch {}
  const reps = reports(6);
  if (reps.length) out.push('', '## Latest reports (read the relevant ones: they say what was skipped or left open)', ...reps.map(r => `- reports/${r.file}: ${r.title}`));
  return out.join('\n');
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
  return { running: live, current: live ? st.current : null, queue: live ? st.queue : [], plan: live ? st.plan || null : null, history: st.history.slice(-12).reverse(),
    available: available(), counts: counts(), reports: reports(), agent: agent().name };
}

function stamp(d = new Date()) { const z = n => String(n).padStart(2, '0'); return `${S.localDate(d)}-${z(d.getHours())}${z(d.getMinutes())}`; }

function promptFor(name, reportFile, step = {}) {
  const body = S.readText(path.join(JOBS_DIR, name + '.md'), null);
  if (body == null) throw new Error(`no job ${name} (docs/jobs/${name}.md)`);
  const rel = p => path.relative(S.CODE, p) || '.';
  const brief = step.why || step.brief ? `\n## Why this run\n\nThe planner (an agent that looked at what was waiting before any job started) chose this job.${step.why ? `\nWhy: ${step.why}` : ''}${step.brief ? `\nBrief: ${step.brief}` : ''}\nIt only saw a snapshot; you'll see more, so use your judgement.\n` : '';
  const extra = name === PLANNER ? `\n## Snapshot\n\n${snapshot()}\n\n## Jobs you can schedule\n\n${available().map(j => `- ${j.name}: ${j.desc}`).join('\n')}\n` : '';
  return `You are running as a background job ("${name}") for the learning workspace in ${S.CODE}. The learner said they're away (the "I'm going away" button or \`bin/learn away\`): they aren't using the app for a while, and they want you to make the decisions and manage things on your own while they focus on learning. Nobody will answer questions during this run, so decide; what truly needs them goes in your final message, with your recommendation.
- Code (shareable, no personal data): ${S.CODE}. Commit code changes there with git, in small commits, so each one can be read and reverted on its own. It's meant to be shared with others who learn their own topics, so personal data (topics, names, notes) never goes there, not even in commit messages.
- Learner data (personal, its own git repo): ${rel(S.ROOT)}/. Commit with \`bin/learn commit "…" -- <the files you changed>\`: naming your files keeps another agent's half-written ones out of your commit.
- They're away, so the server restarting itself after code changes is fine. A tutor process may still be alive, idle in \`bin/learn wait\`: ${rel(S.STATE)}/ is its live queue and session state, so leave it and other processes alone, don't post to the learner (they'd find a lesson message from a job), and run the UI only through \`bin/learn test\` / \`bin/learn demo\` (throwaway copies on other ports).
- AGENTS.md has the layout of the repo and the docs for each role.
- Your final message is saved verbatim as the report the learner reads when they're back (${rel(reportFile)}). Start it with a "# " title line, then keep it short and concrete: what you did (with commit hashes or file names), what you skipped and why, anything that needs their decision.
${brief}
${body}${extra}`;
}

// The planner's final message ends with a ```json block: { "plan": [{ "job", "why", "brief" }] }.
// -> [{ job, why, brief }] of known jobs (at most 6), or null if there's no readable plan.
function parsePlan(text) {
  const blocks = [...String(text || '').matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  let j; try { j = JSON.parse(blocks.at(-1)[1]); } catch { return null; }
  const list = Array.isArray(j) ? j : j?.plan;
  if (!Array.isArray(list)) return null;
  const known = new Set(available().map(x => x.name));
  return list.filter(x => x && known.has(x.job)).slice(0, 6).map(x => ({ job: x.job, why: String(x.why || '').slice(0, 400), brief: String(x.brief || '').slice(0, 2000) }));
}
// No usable plan (the planner failed or wrote none): the obvious work, so going away still does something.
function fallbackPlan() {
  const c = counts(), out = [];
  if (c.feedback) out.push({ job: 'builder', why: `${c.feedback} open feedback item(s) (planner gave no plan)`, brief: '' });
  if (c.sessionsSinceReview) out.push({ job: 'reviewer', why: `${c.sessionsSinceReview} session(s) since the last review (planner gave no plan)`, brief: '' });
  return out;
}

// ---------------------------------------------------------------- runner (detached process)
async function runAll(names) {
  const st = readState();
  st.runner = { pid: process.pid, startedAt: new Date().toISOString() };
  let steps = names.map(job => ({ job }));
  st.queue = steps.map(x => x.job); st.plan = null;
  writeState(st);
  const headBefore = gitHead();
  while (steps.length) {
    const step = steps.shift(), name = step.job;
    const s = readState(); s.queue = steps.map(x => x.job);
    const startedAt = new Date().toISOString(), id = `${stamp()}-${name}`;
    const reportFile = path.join(S.REPORTS, id + '.md'), logFile = path.join(LOGS, id + '.log');
    s.current = { name, startedAt, log: path.relative(S.ROOT, logFile), ...(step.why ? { why: step.why } : {}) };
    writeState(s);
    S.ensureDir(LOGS); S.ensureDir(S.REPORTS);
    let exit = 1, out = '';
    try {
      const A = agent();
      const log = fs.openSync(logFile, 'a');
      const child = spawn(A.cmd(), A.headless({ prompt: promptFor(name, reportFile, step) }), { cwd: S.CODE, env: agentEnv({ LEARN_JOB: name }), stdio: ['ignore', 'pipe', log] });
      child.stdout.on('data', d => { out += d; fs.appendFileSync(logFile, d); });
      exit = await new Promise(res => { child.on('exit', c => res(c ?? 1)); child.on('error', e => { fs.appendFileSync(logFile, String(e)); res(1); }); });
    } catch (e) { out = `# ${name}: could not start\n\n${e.message}`; }
    const text = out.trim() || `# ${name}: no output\n\nThe job exited with code ${exit}. Log: ${path.relative(S.ROOT, logFile)}`;
    fs.writeFileSync(reportFile, /^# /.test(text) ? text + '\n' : `# ${name}\n\n${text}\n`);
    const s2 = readState();
    if (name === PLANNER) {
      const plan = (exit === 0 && parsePlan(out)) || fallbackPlan();
      steps.push(...plan);
      s2.plan = { at: new Date().toISOString(), report: path.basename(reportFile), steps: plan.map(({ job, why }) => ({ job, why })) };
      s2.queue = steps.map(x => x.job);
    }
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
  // no names: plan first (the learner only said they're away; the planner decides what's worth doing)
  names = (names && names.length ? names : S.config().awayJobs || [PLANNER]).filter(Boolean);
  for (const n of names) if (!known.has(n) && n !== PLANNER) throw new Error(`unknown job ${n} (have: ${[...known].join(', ')})`);
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
  if (argv.includes('--snapshot')) { console.log(snapshot()); return; }
  if (argv.includes('--list')) {
    const s = status();
    for (const j of s.available) console.log(`${j.name.padEnd(10)} ${j.title}: ${j.desc.slice(0, 120)}`);
    console.log(`\n${s.running ? `running: ${s.current?.name || 'starting'}${s.queue.length ? ', then ' + s.queue.join(', ') : ''}` : 'nothing running'} · agent ${s.agent} · ${s.counts.feedback} open feedback item(s)`);
    for (const h of s.history.slice(0, 5)) console.log(`  ${h.endedAt.slice(0, 16).replace('T', ' ')} ${h.name} exit ${h.exit}${h.report ? ' → reports/' + h.report : ''}`);
    return;
  }
  const s = start(argv.filter(a => !a.startsWith('-')));
  console.log(`started: ${s.queue.join(', ')}${s.queue.join() === PLANNER ? ' (decides which jobs to run, then runs them)' : ''} (reports go to ${path.relative(S.CODE, S.REPORTS)}/)`);
}

module.exports = { available, status, start, stop, reports, readReport, cli, runAll, snapshot, parsePlan };
