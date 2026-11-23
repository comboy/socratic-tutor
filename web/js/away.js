// "I'm away" (toolbar): one button that tells the agents the learner is stepping away. A planner agent
// looks at what's waiting and decides which background jobs to run (build the feedback queue, review
// sessions, write wiki pages, tidy the code, an open task) and why; the popover shows that plan as it
// runs, and the reports afterwards. Nothing to choose: the agents manage themselves, so the learner doesn't.
// Server side: app/jobs.js, docs/jobs/*.md (plan.md is the planner).
import { h, $, store, fmtTime, fmtDate } from './util.js';
import { icon } from './icons.js';
import { app, getJSON } from './app.js';
import { openDock } from './panels.js';

let pop = null, st = null, note = '';
// what's waiting, shown before going away (the planner sees more: app/jobs.js snapshot())
const WAITING = [
  [c => c.feedback, n => `open feedback item${n > 1 ? 's' : ''}`],
  [c => c.sessionsSinceReview, n => `session${n > 1 ? 's' : ''} since the last review`],
  [c => c.focusTermsWithoutPage, n => `focus term${n > 1 ? 's' : ''} without a wiki page`],
];
const seen = () => store.get('reportsSeen', '');
const unseen = () => (st?.reports || []).filter(r => r.file > seen());

export async function onJobs() {
  try { st = await getJSON('/api/jobs'); } catch { st = null; }
  renderAwayBtn();
  if (pop) fill();
}
export function renderAwayBtn() {
  const b = $('#awayBtn');
  if (!b) return;
  b.classList.toggle('running', !!st?.running);
  b.querySelector('.badge-n')?.remove();
  const n = unseen().length;
  if (st?.running) b.title = `Background job running: ${st.current?.name || 'starting'}${st.queue?.length ? ', then ' + st.queue.join(', ') : ''}`;
  else b.title = n ? `${n} new report${n > 1 ? 's' : ''} from background jobs` : "I'm going away: agents decide what's worth doing meanwhile (your feedback, reviews, wiki pages…)";
  if (n && !st?.running) b.append(h('span', { class: 'badge-n', text: String(n) }));
}

function close() { pop?.remove(); pop = null; $('#awayBtn')?.classList.remove('on'); document.removeEventListener('mousedown', outside, true); }
function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('#awayBtn')) close(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) close(); });

export async function toggleAway() {
  if (pop) { close(); return; }
  pop = h('div', { class: 'popover away-pop' });
  document.body.append(pop);
  const r = $('#awayBtn').getBoundingClientRect();
  pop.style.top = r.bottom + 6 + 'px';
  pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  $('#awayBtn').classList.add('on');
  document.addEventListener('mousedown', outside, true);
  note = '';
  fill();
  await onJobs();
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

function fill() {
  if (!pop) return;
  const head = h('div', { class: 'pop-h' }, icon('away'), h('b', { text: st?.running ? 'Working while you’re away' : 'While you’re away' }), h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Close  Esc', onclick: close }, icon('close')));
  if (!st) { pop.replaceChildren(head, h('div', { class: 'pop-b' }, h('p', { class: 'pop-hint', text: 'Loading…' }))); return; }
  const body = h('div', { class: 'pop-b' });
  let foot = null;
  const title = name => st.available.find(j => j.name === name)?.title || (name === 'plan' ? 'Planning' : name);
  if (st.running) {
    const cur = st.current;
    const planning = !st.plan;
    if (planning) body.append(h('div', { class: 'away-run' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
      h('div', {}, h('b', { text: cur ? (cur.name === 'plan' ? 'Deciding what’s worth doing' : title(cur.name)) : 'Starting…' }),
        h('div', { class: 'pop-hint', text: (cur ? `since ${fmtTime(cur.startedAt)}` : '') + (cur?.why ? ` · ${cur.why}` : '') }))));
    if (st.plan) {
      const steps = st.plan.steps || [];
      const left = st.queue.length + (cur && cur.name !== 'plan' ? 1 : 0), done = steps.length - left;
      body.append(h('div', { class: 'pop-label' }, h('span', { text: 'Plan' }), h('span', { class: 'spacer' }),
        st.plan.report ? h('button', { class: 'linkish small', text: 'why', title: 'The planner’s report', onclick: () => { close(); openDock('report', st.plan.report); } }) : null),
        steps.length ? h('div', { class: 'away-plan' }, ...steps.map((x, i) => h('div', { class: 'away-step ' + (i < done ? 'done' : i === done && cur ? 'now' : 'next') },
          h('span', { class: 'away-step-st' }, i < done ? icon('check') : i === done && cur ? h('span', { class: 'dots' }, h('i'), h('i'), h('i')) : String(i + 1)),
          h('div', { class: 'away-step-b' }, h('b', { text: title(x.job) }), i === done && cur ? h('span', { class: 'away-since', text: `since ${fmtTime(cur.startedAt)}` }) : null,
            x.why ? h('div', { class: 'pop-hint', text: x.why }) : null))))
          : h('p', { class: 'pop-hint', text: 'Nothing worth a run right now.' }));
    } else if (cur?.name === 'plan') body.append(h('p', { class: 'pop-hint', text: 'An agent is looking at what’s waiting and deciding which jobs to run.' }));
    body.append(h('p', { class: 'pop-hint', text: 'You can keep learning meanwhile. New features appear after a reload, which happens by itself when you’re idle.' }));
    foot = h('div', { class: 'pop-f' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small btn-quiet', onclick: async () => { try { st = await post('/api/jobs/stop'); } catch (e) { note = e.message; } fill(); renderAwayBtn(); } }, 'Stop'));
  } else {
    const waiting = WAITING.map(([n, label]) => [n(st.counts) || 0, label]).filter(([n]) => n);
    const go = h('button', { class: 'btn btn-primary btn-small', id: 'awayGo', onclick: async () => {
      go.disabled = true;
      try { st = await post('/api/away', {}); note = ''; }
      catch (e) { note = 'Could not start: ' + e.message; }
      fill(); renderAwayBtn();
    } }, icon('away'), 'I’m going away');
    body.append(h('p', { class: 'pop-desc' }, 'Step away and the agents (', h('code', { text: st.agent }), ') take it from here: one looks at what’s waiting and decides what’s worth doing, then they do it, one job after another, and leave a report here.'),
      h('div', { class: 'pop-sec away-waiting' }, h('div', { class: 'pop-label', text: 'Waiting' }),
        waiting.length ? h('div', {}, ...waiting.map(([n, label]) => h('div', { class: 'away-wait' }, h('span', { class: 'away-count', text: String(n) }), h('span', { text: label(n) }))))
          : h('div', { class: 'pop-hint', text: 'Nothing obvious; they may still tidy up or find something.' })),
      h('p', { class: 'pop-hint', text: 'Code changes are tested and committed; your data is committed to its own repo. Restarts are fine while you’re away.' }));
    foot = h('div', { class: 'pop-f' }, h('span', { class: 'pop-hint', text: 'Uses your agent’s quota.' }), h('span', { class: 'spacer' }), go);
  }
  if (note) body.append(h('div', { class: 'pop-note pop-warn', text: note }));
  const reps = st.reports || [];
  if (reps.length) {
    const s0 = seen();
    body.append(h('div', { class: 'pop-label away-rep-h' }, h('span', { text: 'Reports' }), h('span', { class: 'spacer' }),
      unseen().length ? h('button', { class: 'linkish small', text: 'Mark all read', onclick: () => { store.set('reportsSeen', reps[0].file); fill(); renderAwayBtn(); } }) : null),
      h('div', { class: 'away-reps' }, ...reps.slice(0, 8).map(r => h('button', { class: 'away-rep' + (r.file > s0 ? ' new' : ''), onclick: () => {
        if (r.file > seen()) store.set('reportsSeen', r.file);
        close(); renderAwayBtn(); openDock('report', r.file);
      } }, r.file > s0 ? h('span', { class: 'badge badge-best', text: 'new' }) : h('span', { class: 'muted small', text: fmtDate(r.at) }), h('span', { class: 'away-rep-t', text: r.title, title: r.title })))));
  }
  const hist = (st.history || []).filter(x => x.exit !== 0).slice(0, 3);
  if (hist.length) body.append(h('div', { class: 'pop-hint' }, ...hist.map(x => h('div', { text: `${x.name}: ${x.exit === 'stopped' ? 'stopped' : 'exit ' + x.exit} at ${fmtTime(x.endedAt)}` }))));
  pop.replaceChildren(head, body, foot || '');
}
