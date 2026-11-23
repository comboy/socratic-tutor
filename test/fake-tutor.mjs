#!/usr/bin/env node
// Stands in for `claude` (LEARN_CLAUDE=test/fake-tutor.mjs) in tests and `bin/learn demo`.
// It follows the real protocol (bin/learn wait / post / handoff), so the launcher, server and UI
// are exercised end to end. Behaviour:
//   - starts idle and posts nothing until the learner writes (like the real tutor)
//   - every learner message gets an "Echo" reply with a new question; answers get graded;
//     a META message (About the app) gets an "Echo (meta)" reply posted with --meta, no question
//   - a message containing STALL-ONCE is left unanswered the first time (simulates a stuck tutor)
//   - writes a fake Claude transcript with growing token usage, so the context meter and the
//     automatic handoff can be tested (CLAUDE_CONFIG_DIR must point somewhere disposable)
//   - when `wait` prints a HANDOFF block: replies if needed, then runs `bin/learn handoff`;
//     on a TOPIC SWITCH block it hands off to the new topic without replying
//   - `-p <prompt>` (a background job): prints a fake report and exits (the planner: a plan with one wiki run)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// headless job run (bin/learn away): `-p <prompt> …`. Print a report and exit.
if (process.argv[2] === '-p') {
  const name = (process.argv[3].match(/background job \("([\w-]+)"\)/) || [])[1] || '?';
  // linger: FAKE_JOB_SECONDS, or state/fake-job-seconds in the data home (tests set it mid-run)
  let secs = Number(process.env.FAKE_JOB_SECONDS || 0);
  try { secs = Number(fs.readFileSync(path.join(process.env.LEARN_HOME, 'state', 'fake-job-seconds'), 'utf8')) || secs; } catch {}
  if (process.env.LEARN_HOME) try { fs.writeFileSync(path.join(process.env.LEARN_HOME, 'state', `fake-job-${name}.txt`), process.argv[3]); } catch {}
  // the planner: plans one wiki run (FAKE_PLAN: a JSON plan list instead)
  const plan = name === 'plan' ? '\n\n```json\n' + JSON.stringify({ plan: JSON.parse(process.env.FAKE_PLAN || '[{"job":"wiki","why":"fake: terms without pages","brief":"FAKE-BRIEF write the focus terms"}]') }) + '\n```' : '';
  setTimeout(() => { console.log(`# Fake ${name} report\n\nThe fake agent ran the ${name} job and changed nothing.${plan}`); process.exit(0); }, secs * 1000);
} else {
const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../bin/learn');
const HOME = process.env.LEARN_HOME;
const SESSION = process.env.LEARN_SESSION;
const prompt = process.argv[process.argv.length - 1] || '';
const isHandoff = /HANDOFF/.test(prompt);
const STEP = Number(process.env.FAKE_TOKENS_PER_TURN || 30000);
const log = (o) => { if (HOME) fs.appendFileSync(path.join(HOME, 'state', 'fake-claude.log'), JSON.stringify({ pid: process.pid, session: SESSION, at: new Date().toISOString(), ...o }) + '\n'); };
log({ args: process.argv.slice(2), handoff: isHandoff });

// ---- fake transcript (only where tests asked for a disposable CLAUDE_CONFIG_DIR)
let tokens = 20000;
const tdir = process.env.CLAUDE_CONFIG_DIR && SESSION ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'fake') : null;
function turn() {
  if (!tdir) return;
  tokens += STEP;
  fs.mkdirSync(tdir, { recursive: true });
  fs.appendFileSync(path.join(tdir, SESSION + '.jsonl'), JSON.stringify({ type: 'assistant', sessionId: SESSION,
    message: { model: 'fake-tutor', usage: { input_tokens: 5, cache_read_input_tokens: tokens - 105, cache_creation_input_tokens: 0, output_tokens: 100 } } }) + '\n');
}

const hang = () => new Promise(() => setInterval(() => {}, 1 << 30));   // a bare pending promise lets node exit
const run = (args, input) => execFileSync(process.execPath, [BIN, ...args], { input, env: process.env, encoding: 'utf8' });
const post = (text, extra = []) => { turn(); return run(['post', ...extra], text); };

let waiter = null;
const quit = () => { try { waiter?.kill('SIGTERM'); } catch {} process.exit(0); };
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
process.on('SIGHUP', quit);

function wait() {
  return new Promise(resolve => {
    let out = '';
    waiter = spawn(process.execPath, [BIN, 'wait'], { env: process.env });
    waiter.stdout.on('data', d => { out += d; });
    waiter.on('exit', () => { waiter = null; resolve(out); });
  });
}
function parse(out) {
  const msgs = [];
  const re = /^── (\w+)  id=(\S+)  topic=(\S+)(.*?) ──\n([\s\S]*?)(?=^── |\(reply:|$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(out))) msgs.push({ kind: m[1].toLowerCase(), id: m[2], topic: m[3], extra: m[4].trim(), text: m[5].trim() });
  return msgs.filter(x => x.kind !== 'handoff');
}
const stalled = () => { try { return new Set(fs.readFileSync(path.join(HOME, 'state', 'fake-stalled'), 'utf8').split('\n')); } catch { return new Set(); } };

async function main() {
  for (;;) {
    const out = await wait();
    if (/replaced by a newer one/.test(out)) { log({ event: 'stale-wait' }); await hang(); }
    const msgs = parse(out);
    const handoff = /── HANDOFF ──/.test(out);
    const sw = out.match(/── TOPIC SWITCH ──.*?handoff --topic (\S+)/s);
    if (sw) { log({ event: 'topic-switch', to: sw[1] }); run(['handoff', '--topic', sw[1], '--reason', 'topic switch']); await hang(); }
    for (const m of msgs) {
      if (m.kind === 'action' && m.text.startsWith('fresh tutor')) continue;
      if (/STALL-ONCE/.test(m.text) && !stalled().has(m.id)) {
        fs.appendFileSync(path.join(HOME, 'state', 'fake-stalled'), m.id + '\n');
        log({ event: 'stalling', id: m.id });
        await hang();                                   // stuck until killed
      }
      if (m.kind === 'meta') { post(`Echo (meta): ${m.text.slice(0, 300)}`, ['--topic', m.topic, '--meta']); log({ event: 'replied', id: m.id, meta: true, head: m.extra }); continue; }
      const grade = m.kind === 'answer' ? ['--grade', 'correct', '--note', 'fake tutor grades everything correct'] : [];
      post(`Echo (${m.kind}): ${m.text.slice(0, 300)}\n\n:::question\nFake follow-up question after ${m.id}?\n:::`, ['--topic', m.topic, ...grade]);
      log({ event: 'replied', id: m.id });
    }
    if (handoff) { log({ event: 'handoff' }); run(['handoff', '--reason', 'fake tutor handoff']); await hang(); }
  }
}
main().catch(e => { log({ error: e.message }); console.error(e); process.exit(1); });
}
