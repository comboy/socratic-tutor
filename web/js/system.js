// The System page (the toolbar's speech-bubble button): everything about the tool rather than the
// topic, in one place, as four tabs.
//  - How to teach me, Change the app: the two writing tabs (tell.js), as they were when this was
//    the "Tell" page. The button opens the tab used last, so the feedback box is where it was.
//  - Settings: the few choices that are the learner's taste (term suggestions, theme). Kept in this
//    browser, like the drafts and the panel sizes.
//  - Status: what the machinery is doing and has done (GET /api/system, app/sysstats.js):
//    the tutor session and its status light, tokens, reply times, delivery, sessions, background
//    jobs, the server. Only what is measured; what isn't says so.
import { h, $, store, fmtTime, fmtDate } from './util.js';
import { icon } from './icons.js';
import { app, go, getJSON, THEMES, getTheme, setTheme } from './app.js';
import { instructionsTab, appTab, leaveTab, onLearner as tellLearner } from './tell.js';
import { completeOn, setCompleteOn } from './complete.js';
import { healthOf, handoff, LIGHT } from './tutor.js';

export const routeAlways = true;
const TABS = [['instructions', 'How to teach me', 'hole'], ['app', 'Change the app', 'feedback'], ['settings', 'Settings', 'sliders'], ['status', 'Status', 'pulse']];
const TIPS = { instructions: 'Your instructions to every tutor', app: 'Something awkward, missing or broken: tell the builder (or the tutor, now)', settings: 'Term suggestions, theme', status: 'The tutor session and its light, tokens used, reply times, delivery, background jobs, the server' };
const FILL = { instructions: instructionsTab, app: appTab, settings: settingsTab, status: statusTab };
let tab = null, timer = null;

export function render(center, _app, args) {
  tab = FILL[args[0]] ? args[0] : 'instructions';
  store.set('tellTab', tab);
  const body = h('div', { class: 'view-body' });
  center.replaceChildren(h('div', { class: 'view tell system' },
    h('div', { class: 'view-bar tabbed' }, h('div', { class: 'tabs' }, ...TABS.map(([id, label, ic]) =>
      h('button', { class: 'tab' + (tab === id ? ' on' : ''), id: 'tellTab-' + id, title: TIPS[id], onclick: () => go('system', id) }, icon(ic), label)))),
    body));
  leaveTab();
  clearInterval(timer); timer = null; statusEl = null;
  FILL[tab](body);
}
export function onLearner() { tellLearner(); }
// the tutor's status changed (a reply, a handoff): the light and the context follow at once, the numbers after a fetch
export function onStatus() { if (statusEl) { if (data) drawStatus(); soon(); } }
export function onTheme() { if (tab === 'settings' && $('.sys-page')) settingsTab($('.view.system .view-body')); }

const page = (...kids) => h('div', { class: 'tell-page sys-page' }, ...kids);
const panel = (title, note, ...kids) => h('section', { class: 'sys-panel' },
  h('div', { class: 'sys-h' }, h('b', { text: title }), note ? h('span', { class: 'sys-note' }, note) : null), ...kids);

// ---------------------------------------------------------------- settings
function setting(title, desc, control) {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title', text: title }), h('div', { class: 'set-desc' }, ...[].concat(desc))), control);
}
function choice(id, options, current, pick) {
  return h('div', { class: 'seg set-seg', id, role: 'group' }, ...options.map(([v, label]) =>
    h('button', { class: v === current ? 'on' : '', 'data-v': String(v), 'aria-pressed': String(v === current), onclick: () => pick(v) }, label)));
}
function settingsTab(body) {
  const redraw = () => settingsTab(body);
  const k = t => h('kbd', { text: t });
  body.replaceChildren(page(
    panel('Writing', null,
      setting('Suggest glossary terms while I type',
        ['In the answer and ask box: when the word you are typing begins a term of this topic’s glossary, a small list opens at the word, each term with a line of its definition. ',
          k('Tab'), ' puts the term in; ', k('Esc'), ' closes the list; ', k('↑'), k('↓'), ' choose when there are several. Enter still starts a new line and everything else types as always. ',
          h('br'), 'Forgot how the word begins? ', k('Ctrl+Space'), ' or the “Find term” button under the box searches the glossary by what the term means. That works with this switched off too.'],
        choice('setComplete', [[true, 'On'], [false, 'Off']], completeOn(), v => { setCompleteOn(v); redraw(); }))),
    panel('Look', null,
      setting('Theme', ['“Auto” follows your system’s light or dark setting. The toolbar’s sun/moon button switches the same thing.'],
        choice('setTheme', THEMES.map(t => [t, t[0].toUpperCase() + t.slice(1)]), getTheme(), v => { setTheme(v); redraw(); }))),
    h('p', { class: 'sys-foot' }, 'These are kept in this browser, like your drafts and panel sizes. How the tutors work with you is on the ',
      h('button', { class: 'linkish', onclick: () => go('system', 'instructions') }, 'How to teach me'), ' tab; two threads are switched in the conversation, where they are used.')));
}

// ---------------------------------------------------------------- status & usage
let statusEl = null, data = null, loading = false, later = null, failed = '';
const tok = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
const secs = s => s == null ? '—' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
const ms = v => v == null ? '—' : v < 1000 ? `${Math.round(v)} ms` : secs(v / 1000);
const dur = from => secs((Date.now() - Date.parse(from)) / 1000);
const when = ts => { const d = new Date(ts), today = new Date().toDateString() === d.toDateString(); return (today ? '' : fmtDate(localDay(d)) + ' ') + fmtTime(ts); };
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const n0 = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const kv = (label, value, title) => h('div', { class: 'kv', title: title || null }, h('span', { class: 'kv-k', text: label }), h('span', { class: 'kv-v' }, ...[].concat(value)));
const NOT = () => h('span', { class: 'not-measured', title: 'Nothing records this, so there is no number to show', text: 'not measured' });
function table(heads, rows, cls = '') {
  return h('div', { class: 'sys-scroll' }, h('table', { class: 'sys-table ' + cls }, h('thead', {}, h('tr', {}, ...heads.map(([t, c, tip]) => h('th', { class: c || '', title: tip || null, text: t })))),
    h('tbody', {}, ...rows.map(r => h('tr', { class: r.cls || '' }, ...r.cells.map((c, i) => h('td', { class: heads[i][1] || '' }, ...[].concat(c ?? '—'))))))));
}

function statusTab(body) {
  statusEl = page(h('div', { class: 'sys-loading muted', text: 'Reading…' }));
  body.replaceChildren(statusEl);
  data = null; failed = '';
  load();
  timer = setInterval(() => { if (!document.hidden && statusEl?.isConnected) load(); }, 15000);
}
// fetch again once the status has settled (it changes several times around one reply)
function soon() { clearTimeout(later); later = setTimeout(load, 1200); }
async function load() {
  if (loading || !statusEl?.isConnected) return;
  loading = true;
  try { data = await getJSON('/api/system' + (app.topic ? '?topic=' + encodeURIComponent(app.topic.slug) : '')); failed = ''; }
  catch (e) { failed = /not found/.test(e.message) ? 'The server that is running is older than this page and has no numbers to give yet. It restarts into the new code by itself (when background jobs are running, as soon as they finish).' : 'Could not read the numbers: ' + e.message; }
  loading = false;
  if (statusEl?.isConnected) drawStatus();
}
function drawStatus() {
  const sc = statusEl.closest('.view-body'), top = sc?.scrollTop || 0;
  if (!data) { statusEl.replaceChildren(h('div', { class: 'pop-warn', id: 'sysFailed', text: failed || 'No data.' })); return; }
  const d = data;
  statusEl.replaceChildren(...[
    failed ? h('div', { class: 'pop-warn', text: failed }) : null,
    h('div', { class: 'sys-top' }, h('span', { class: 'muted small', id: 'sysAsOf', text: `As of ${new Date(d.at).toLocaleTimeString()} · refreshes by itself` }), h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small', id: 'sysRefresh', onclick: load }, icon('auto'), 'Refresh')),
    tutorPanel(d), h('div', { class: 'sys-grid' }, deliveryPanel(d), repliesPanel(d)), daysPanel(d), sessionsPanel(d), jobsPanel(d), serverPanel(d)].filter(Boolean));
  if (sc) sc.scrollTop = top;
}

// the light, as the toolbar shows it, with every reason written out
function lightBox() {
  const s = app.status, hl = healthOf(s);
  const phase = s.offline ? 'Server not reachable' : ({ listening: 'Ready', thinking: 'Writing a reply', handoff: 'Switching to a fresh tutor', starting: 'Starting', offline: 'Offline' })[s.phase] || s.phase;
  const L = LIGHT[hl.level];
  return h('div', { class: 'sys-light light-' + hl.level, id: 'sysLight', 'data-level': hl.level },
    h('span', { class: 'lamp' }), h('div', { class: 'sys-light-t' },
      h('b', { text: `${phase} · ${L.head}` }),
      ...(hl.reasons.length ? hl.reasons.map(r => h('div', { class: 'sys-reason', text: r.text }))
        : [h('div', { class: 'sys-reason muted', text: s.launcher ? 'Nothing suggests restarting the tutor.' : 'No tutor started by bin/learn is running, so there is nothing to restart from here.' })])),
    s.launcher && hl.level !== 'ok' ? h('button', { class: 'btn btn-primary', id: 'sysFresh', disabled: s.phase === 'handoff', title: 'The tutor saves its notes, then a new session continues where it left off', onclick: () => handoff(false) }, icon('auto'), 'Fresh tutor') : null);
}
function tutorPanel(d) {
  const t = d.tutor, s = t.session, lim = t.limits, u = s?.usage;
  const c = app.status.offline ? t.context : app.status.context || null;   // live, like the light above it
  const f = c ? c.tokens / c.limit : null;
  const meterEl = c ? h('span', { class: 'sys-meter ' + (f < lim.warnAt ? 'ok' : f < lim.nowAt ? 'mid' : 'high'), title: `Yellow from ${Math.round(lim.warnAt * 100)}%, red from ${Math.round(lim.nowAt * 100)}%; at 100% a fresh tutor takes over by itself after the next reply` },
    h('i', { style: { width: Math.min(100, f * 100) + '%' } }), h('span', { class: 'tick', style: { left: lim.warnAt * 100 + '%' } }), h('span', { class: 'tick', style: { left: lim.nowAt * 100 + '%' } })) : null;
  const rows = [];
  if (s) {
    rows.push(kv('Context', c ? [meterEl, h('span', { id: 'sysContext', text: `${tok(c.tokens)} of ${tok(c.limit)} (${Math.round(f * 100)}%)` })] : t.meter ? 'shown after the tutor’s first reply' : [NOT(), ` (the agent “${t.agent}” has no context meter; it hands off after ${lim.handoffMessages} messages)`],
      'How much of its working memory the tutor session has filled. The whole conversation so far is re-read with every reply.'));
    rows.push(kv('Session', `started ${when(s.startedAt)} (${dur(s.startedAt)} ago)${s.kind === 'handoff' ? ', took over from an earlier session' : s.kind === 'resume' ? ', resumed' : ''}${s.topic ? ` · topic ${s.topic}` : ' · no topic yet'}`));
    rows.push(kv('Messages posted', `${s.turns} in this session`));
    rows.push(kv('Tokens, this session', u ? [h('span', { id: 'sysTokens', text: `${tok(u.output + u.subagents.output)} written` }),
      h('span', { class: 'muted', text: ` (${tok(u.output)} by the tutor${u.subagents.n ? `, ${tok(u.subagents.output)} by ${n0(u.subagents.n, 'helper agent')}` : ''}) · ${tok(u.input + u.cacheWrite + u.subagents.input + u.subagents.cacheWrite)} new input · ${tok(u.cacheRead + u.subagents.cacheRead)} re-read from cache${u.partial ? ' · still counting…' : ''}` })]
      : t.meter ? 'none yet' : NOT(),
      'Summed over the session’s transcript. “Re-read from cache” is the conversation being read again with every step: by far the largest number, and the cheapest kind of token.'));
    if (c?.model) rows.push(kv('Model', `${c.model} · agent ${t.agent}`));
    if (s.guideChangedAt) rows.push(kv('Teaching guide', `changed ${when(s.guideChangedAt)}, after this session started: it still follows the older text. A fresh tutor reads the new one.`));
  }
  return panel('Tutor', `switches by itself at ${tok(lim.handoffTokens)} tokens of context`, lightBox(), rows.length ? h('div', { class: 'kvs' }, ...rows) : null);
}
function deliveryPanel(d) {
  const x = d.delivery, t = x.today, w = x.week, now = x.now;
  const bad = now.stalled > 0, lost = t.sent - t.picked - now.queued;
  const head = !t.sent ? 'No messages sent today yet.'
    : `Today: ${n0(t.sent, 'message')} sent, ${t.picked === t.sent ? 'all' : t.picked} picked up by the tutor${t.again ? `; ${t.again} had to be handed over a second time` : ', none had to be delivered again'}.`;
  const row = (label, f, tip) => ({ cells: [h('span', { title: tip || null, text: label }), f(t), f(w)] });
  return panel('Delivery', x.since ? `from the server’s log, kept since ${when(x.since)}` : 'no server log yet',
    h('div', { class: 'sys-verdict ' + (bad || lost > 0 ? 'bad' : t.again || t.watchdog ? 'warn' : 'good'), id: 'sysDelivery' }, h('span', { class: 'lamp' }), head),
    table([['', ''], ['Today', 'num'], ['7 days', 'num']], [
      row('Messages sent', p => p.sent),
      row('Picked up by the tutor', p => p.sent ? `${p.picked} of ${p.sent}` : '—'),
      row('Time until picked up', p => p.pickMedianMs == null ? '—' : `${ms(p.pickMedianMs)} · longest ${ms(p.pickMaxMs)}`, 'From the server saving your message to the tutor taking it. Long when the tutor was still writing another reply.'),
      row('Handed over a second time', p => p.again, `A message the tutor was given and left without a reply is given to it again after ${x.redeliverSeconds} s, or to the fresh tutor after a restart. Each one would have been lost without that.`),
      row('Sent twice by the browser, saved once', p => p.retries, 'The browser repeats a send whose answer it didn’t get (the server was restarting); the server recognises the repeat.'),
      row('Tutor replaced because it went quiet', p => p.watchdog, x.watchdogSeconds ? `With a message waiting and no sign of work for ${x.watchdogSeconds} s, the tutor is replaced by itself.` : 'Switched off in config.json (watchdogSeconds: 0).'),
      row('Server restarts into new code', p => p.restarts),
    ]),
    h('div', { class: 'sys-now' + (bad ? ' bad' : '') }, h('b', { text: 'Right now: ' }),
      `${now.queued} waiting to be picked up · ${now.unanswered} with the tutor, not answered yet · ${now.stalled} without a reply for too long`));
}
function repliesPanel(d) {
  const l = d.latency;
  if (!l) return panel('Reply times', null, h('div', { class: 'empty-row', text: 'Open a topic to see its reply times.' }));
  const row = (label, s) => ({ cells: [label, s.n, s.n ? secs(s.median) : '—', s.n ? secs(s.p75) : '—'] });
  return panel('Reply times', `topic ${l.topic}`,
    table([['', ''], ['Replies', 'num'], ['Median wait', 'num', 'Half of the replies came faster than this'], ['3 of 4 within', 'num']], [row('Today', l.today), row('7 days', l.week)]),
    h('p', { class: 'sys-p muted' }, 'From your message to the tutor’s next lesson message in the same thread.',
      l.hidden ? ` With two threads, ${l.hidden} of the week’s ${l.week.n} waits were hidden: the other thread had something to read meanwhile.` : ''));
}
function daysPanel(d) {
  if (!d.days.length) return null;
  return panel('Recent days', 'the last 7 days with activity, all topics',
    table([['Day', ''], ['You', 'num', 'Messages you sent (answers, questions, buttons)'], ['Tutor', 'num', 'Lesson messages the tutor posted'], ['Graded', 'num', 'Answers the tutor graded'], ['Sessions', 'num', 'Tutor sessions started'],
      ['Handoffs', 'num', 'Times a fresh tutor took over from one whose context was full (or that you replaced)'], ['Median wait', 'num', 'Half of the replies came faster than this'], ['3 of 4 within', 'num']],
      d.days.map(x => ({ cells: [fmtDate(x.d, { weekday: 'short', month: 'short', day: 'numeric' }), x.sent, x.replies, x.grades, x.sessions, x.handoffs, x.waitN ? secs(x.waitMedian) : '—', x.waitN ? secs(x.waitP75) : '—'] })), 'wide'));
}
function sessionsPanel(d) {
  const L = d.sessions.list;
  return panel('Tutor sessions', d.sessions.since ? `recorded since ${when(d.sessions.since)}` : null,
    L.length ? table([['Started', ''], ['How', ''], ['Topic', ''], ['Lasted', 'num'], ['Context at the end', 'num', 'The size the session’s context had when it was last seen: what a handoff freed'], ['Tokens written', 'num', 'By the tutor and its helper agents']],
      L.map(r => ({ cls: r.current ? 'cur' : '', cells: [when(r.startedAt) + (r.current ? ' · now' : ''), r.kind === 'handoff' ? 'took over' : r.kind === 'resume' ? 'resumed' : 'fresh start', r.topic || '—',
        secs((Date.parse(r.seenAt) - Date.parse(r.startedAt)) / 1000), r.tokens == null ? '—' : tok(r.tokens), r.output == null ? '—' : tok(r.output)] })), 'wide')
      : h('div', { class: 'empty-row', text: 'Nothing recorded yet. The server notes each tutor session from now on (earlier ones were not recorded).' }));
}
function jobsPanel(d) {
  const j = d.jobs;
  return panel('Background jobs', `7 days: ${n0(j.week.runs, 'run')}, ${secs(j.week.minutes * 60)} of work${j.week.failed ? `, ${j.week.failed} failed` : ''}`,
    j.running ? h('div', { class: 'sys-now' }, h('b', { text: 'Running now: ' }), `${j.current?.name || 'starting'}${j.current ? ` (for ${dur(j.current.startedAt)})` : ''}${j.queue.length ? `, then ${j.queue.join(', ')}` : ''}`) : null,
    j.history.length ? table([['Ended', ''], ['Job', ''], ['Took', 'num'], ['Result', ''], ['Tokens', 'num']],
      j.history.map(x => ({ cells: [x.endedAt ? when(x.endedAt) : '—', x.name, secs(x.minutes * 60), x.exit === 0 ? 'done' : h('span', { class: 'sys-bad', text: x.exit === 'stopped' ? 'stopped' : `failed (${x.exit})` }), NOT()] })), 'wide')
      : h('div', { class: 'empty-row', text: 'No background job has run yet (the coffee-cup button starts them).' }));
}
function serverPanel(d) {
  const s = d.server, hd = s.startHead || s.head;
  return panel('Server', null, h('div', { class: 'kvs' },
    kv('Version', hd ? [h('code', { text: hd.hash }), ` ${hd.subject} (${when(hd.date)})`] : NOT()),
    s.stale || s.pendingRestart ? kv('Newer code', s.pendingRestart ? `waiting (${s.pendingRestart}): the server restarts into it when the background jobs finish`
      : [`the checkout is at `, h('code', { text: s.head.hash }), ` (${s.head.subject}); this server loads server changes by itself, changes to the pages reach the browser at once`]) : null,
    kv('Running', `since ${when(s.startedAt)} (${secs(s.uptimeS)}) · ${n0(d.delivery.today.restarts, 'restart')} today`),
    kv('Open in', `${n0(s.clients, 'browser connection')} · port ${s.port}`, 'One connection per browser: its tabs share it'),
    kv('Data', [h('code', { text: s.home }), ` · ${n0(s.topics, 'topic')} · Node ${s.node} · pid ${s.pid}`])));
}
