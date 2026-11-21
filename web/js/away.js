// "I'm away" (toolbar): start background agents while the learner is away (build the feedback queue,
// review sessions, write wiki pages, tidy the code), see what's running, read their reports.
// Server side: app/jobs.js, docs/jobs/*.md.
import { h, $, store, fmtTime, fmtDate } from './util.js';
import { icon } from './icons.js';
import { app, getJSON } from './app.js';
import { openDock } from './panels.js';

let pop = null, st = null, note = '';
const HINT = {
  builder: c => c.feedback ? `${c.feedback} open feedback item${c.feedback > 1 ? 's' : ''}` : 'feedback queue is empty',
  reviewer: c => c.sessionsSinceReview ? `${c.sessionsSinceReview} session${c.sessionsSinceReview > 1 ? 's' : ''} since the last review` : 'nothing new since the last review',
};
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
  else b.title = n ? `${n} new report${n > 1 ? 's' : ''} from background jobs` : "I'm away: let background agents build your feedback, review sessions, write wiki pages";
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
  if (st.running) {
    const cur = st.current;
    body.append(h('div', { class: 'away-run' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
      h('div', {}, h('b', { text: cur ? (st.available.find(j => j.name === cur.name)?.title || cur.name) : 'Starting…' }),
        h('div', { class: 'pop-hint', text: (cur ? `since ${fmtTime(cur.startedAt)}` : '') + (st.queue.length ? ` · then ${st.queue.join(', ')}` : '') }))),
      h('p', { class: 'pop-hint', text: 'You can keep learning meanwhile. New features appear after a reload, which happens by itself when you’re idle.' }));
    foot = h('div', { class: 'pop-f' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small btn-quiet', onclick: async () => { try { st = await post('/api/jobs/stop'); } catch (e) { note = e.message; } fill(); renderAwayBtn(); } }, 'Stop'));
  } else {
    const chosen = new Set(store.get('awayJobs', ['builder', 'reviewer']));
    const list = h('div', { class: 'away-jobs' });
    for (const j of st.available) {
      const cb = h('input', { type: 'checkbox', checked: chosen.has(j.name), onchange: () => { cb.checked ? chosen.add(j.name) : chosen.delete(j.name); store.set('awayJobs', [...chosen]); go.disabled = !chosen.size; } });
      list.append(h('label', { class: 'away-job' }, cb, h('div', {}, h('b', { text: j.title }), HINT[j.name] ? h('span', { class: 'away-count', text: HINT[j.name](st.counts) }) : null,
        h('div', { class: 'pop-hint', text: j.desc }))));
    }
    const go = h('button', { class: 'btn btn-primary btn-small', disabled: !chosen.size, onclick: async () => {
      go.disabled = true;
      try { st = await post('/api/away', { jobs: st.available.map(j => j.name).filter(n => chosen.has(n)) }); note = ''; }
      catch (e) { note = 'Could not start: ' + e.message; }
      fill(); renderAwayBtn();
    } }, icon('away'), 'Start');
    body.append(h('p', { class: 'pop-hint' }, 'Background agents (', h('code', { text: st.agent }), ', unattended) work through these one after another and leave a report here. Code changes are tested and committed; your data is committed to its own repo.'), list);
    foot = h('div', { class: 'pop-f' }, h('span', { class: 'pop-hint', text: 'Takes a while and uses your agent’s quota.' }), h('span', { class: 'spacer' }), go);
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
