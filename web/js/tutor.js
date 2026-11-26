// Tutor status pill (toolbar) and its popover: state, context ("memory") meter, Fresh tutor.
// The pill is also a light: green while nothing suggests a restart, yellow when a fresh tutor would
// be sensible at the next break, red when it should be restarted now (the reasons and the numbers
// behind them: app/sysstats.js tutorHealth). It only informs: the handoff at the threshold and the
// watchdog still act by themselves. The colour is never alone: the pill says it in words, the
// tooltip and the popover give the reason ("Context 310k of 400k").
import { h, $ } from './util.js';
import { icon } from './icons.js';
import { app } from './app.js';

const PHASES = {
  listening: ['on', 'Tutor ready', 'The tutor is listening for your next message.'],
  thinking: ['think', 'Tutor is thinking', 'Your message was picked up; a reply is being written.'],
  handoff: ['swap', 'Switching tutor…', 'A fresh tutor session is taking over (the old one saved its notes). Messages you send now are queued for it.'],
  starting: ['think', 'Tutor starting…', 'The tutor session is starting up and reading its notes.'],
  offline: ['off', 'Tutor offline', 'No tutor is listening. Messages are queued until one is.'],
};
const k = n => Math.round(n / 1000) + 'k';

function phaseInfo(s) {
  if (s.offline) return ['off', 'Server down', 'Lost connection to the bin/learn server.'];
  if (!s.phase) s.phase = s.thinking ? 'thinking' : s.listening ? 'listening' : 'offline';   // server from before phases
  const [cls, text, desc] = PHASES[s.phase] || PHASES.offline;
  return [cls, s.phase === 'listening' && s.queued ? `${s.queued} queued` : s.phase === 'offline' && s.queued ? `Tutor offline · ${s.queued} queued` : text, desc];
}
const WARN_AT = 0.7, NOW_AT = 0.9;   // as in app/sysstats.js
function ctxLevel(c) { const f = c.tokens / c.limit; return f < WARN_AT ? 'ok' : f < NOW_AT ? 'mid' : 'high'; }
export const LIGHT = {
  ok: { tag: '', short: '', head: 'no restart needed' },
  warn: { tag: 'fresh tutor soon', short: '↻ soon', head: 'a fresh tutor would be sensible' },
  now: { tag: 'restart now', short: '↻ now', head: 'restart the tutor now' },
};
const OK = { level: 'ok', reasons: [] };
// -> { level: ok | warn | now, reasons: [{ level, short, text }] }. From the server (status.health); a
// server from before the light sends only the context size, which gives the same two thresholds.
export function healthOf(s) {
  if (!s || s.offline || !s.launcher) return OK;
  if (s.health) return s.health;
  const c = s.context, f = c ? c.tokens / c.limit : 0;
  if (f < WARN_AT) return OK;
  const level = f < NOW_AT ? 'warn' : 'now';
  return { level, reasons: [{ level, short: `context ${Math.round(f * 100)}%`, text: `Context ${k(c.tokens)} of ${k(c.limit)} (${Math.round(f * 100)}%): ${level === 'now' ? 'close to the automatic switch to a fresh tutor.' : 'a fresh tutor at your next break would be sensible.'}` }] };
}

let prevPhase = null;
export function renderStatus() {
  const s = app.status, el = $('#status');
  if (prevPhase === 'handoff' && s.phase !== 'handoff') note = '';
  prevPhase = s.phase;
  const [cls, text] = phaseInfo(s);
  const c = s.context;
  // the light shows while the tutor is ready (while it writes, the pill says so; the meter keeps its colour)
  const hl = healthOf(s), lit = hl.level !== 'ok' && s.phase === 'listening';
  el.className = 'status ' + cls + (lit ? ' light-' + hl.level : '') + (pop ? ' open' : '');
  el.dataset.light = ['listening', 'thinking'].includes(s.phase) && !s.offline ? hl.level : '';
  el.title = hl.level !== 'ok' && !s.offline ? `${LIGHT[hl.level].head[0].toUpperCase() + LIGHT[hl.level].head.slice(1)}. ${hl.reasons.map(r => r.text).join(' ')} (click)`
    : 'Tutor status and memory (click)' + (c && !s.offline ? ` · context ${k(c.tokens)} of ${k(c.limit)}` : '');
  el.replaceChildren(h('span', { class: 'dot' }), h('span', { text }),
    lit ? h('span', { class: 'light-tag' }, h('span', { class: 'long', text: LIGHT[hl.level].tag }), h('span', { class: 'short', text: LIGHT[hl.level].short })) : '',
    c && !s.offline ? h('span', { class: 'ctx-mini ' + ctxLevel(c) }, h('i', { style: { width: Math.min(100, c.tokens / c.limit * 100) + '%' } })) : '');
  if (pop) fillPopover();
}

let pop = null;
function closePopover() { pop?.remove(); pop = null; renderStatus(); document.removeEventListener('mousedown', outside, true); }
function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('#status')) closePopover(); }
export function togglePopover() {
  if (pop) { closePopover(); return; }
  pop = h('div', { class: 'popover tutor-pop' });
  document.body.append(pop);
  const r = $('#status').getBoundingClientRect();
  pop.style.top = r.bottom + 6 + 'px';
  pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  document.addEventListener('mousedown', outside, true);
  renderStatus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) closePopover(); });

export async function handoff(force) {
  try {
    const r = await fetch('/api/handoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: app.topic?.slug, force }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    note = j.mode === 'now' ? 'Restarting the tutor now.' : 'Asked the tutor to save its notes and hand off. Takes about a minute.';
  } catch (e) { note = 'Could not switch: ' + e.message; if (!pop) alert(note); }
  if (pop) fillPopover();
}
let note = '';

function fillPopover() {
  const s = app.status, c = s.context;
  const [cls, text, desc] = phaseInfo(s);
  const busy = s.phase === 'handoff';
  const hl = ['listening', 'thinking', 'offline'].includes(s.phase) ? healthOf(s) : OK;
  // what the restart is for decides which button is the main one: a tutor that doesn't answer can't save notes first
  const stuck = hl.reasons.some(r => r.level === 'now' && !/^context/.test(r.short));
  pop.replaceChildren(
    h('div', { class: 'pop-h ' + cls + (hl.level !== 'ok' && s.phase === 'listening' ? ' light-' + hl.level : '') }, h('span', { class: 'dot' }), h('b', { text }), h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Close', onclick: closePopover }, icon('close'))),
    h('div', { class: 'pop-b' }, h('p', { class: 'pop-desc', text: desc }),
      hl.level !== 'ok' ? h('div', { class: 'pop-light light-' + hl.level, id: 'popLight' }, h('b', {}, h('span', { class: 'lamp' }), LIGHT[hl.level].head[0].toUpperCase() + LIGHT[hl.level].head.slice(1)),
        ...hl.reasons.map(r => h('div', { text: r.text }))) : null,
      s.launcher ? h('div', { class: 'pop-sec' },
        h('div', { class: 'pop-label' }, h('span', { text: 'Tutor memory (context)' }), h('span', { class: 'spacer' }),
          h('span', { class: 'mono small', text: c ? `${k(c.tokens)} / ${k(c.limit)}` : '—' })),
        h('div', { class: 'meter ctx-meter ' + (c ? ctxLevel(c) : '') }, h('i', { style: { width: c ? Math.min(100, c.tokens / c.limit * 100) + '%' : '0' } })),
        h('div', { class: 'pop-hint', text: c
          ? `At ${k(c.limit)} the tutor saves its notes and a fresh session takes over by itself. The light turns yellow from ${Math.round(WARN_AT * 100)}% and red from ${Math.round(NOW_AT * 100)}%, so you can pick the moment. Everything you learned stays in the topic files, so nothing is lost.`
          : 'Shown once the tutor has replied at least once in this session.' }))
        : h('div', { class: 'pop-warn' }, 'This tutor wasn’t started by ', h('code', { text: 'bin/learn' }), ', so it can’t be switched from here. Run ', h('code', { text: 'bin/learn' }), ' in a terminal.'),
      s.kind === 'handoff' && !busy ? h('div', { class: 'pop-hint', text: 'This session took over from an earlier one with fresh context.' }) : null,
      app.topic ? h('div', { class: 'pop-hint' }, h('a', { href: `#/${app.topic.slug}/system/instructions`, id: 'instrLink', onclick: () => closePopover() }, 'Your instructions to every tutor'),
        ': how they should work with you; they override everything the tutors work out themselves. ',
        h('a', { href: `#/${app.topic.slug}/system/status`, id: 'sysLink', onclick: () => closePopover() }, 'System status'), ': tokens used, reply times, delivery.') : null,
      note ? h('div', { class: 'pop-note', text: note }) : null),
    s.launcher ? h('div', { class: 'pop-f' },
      h('button', { class: 'btn' + (hl.level !== 'ok' && !stuck ? ' btn-primary' : ''), disabled: busy, title: 'The tutor saves its notes, then a new session continues where it left off', onclick: () => handoff(false) }, icon('auto'), 'Fresh tutor'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small' + (stuck ? ' btn-primary' : ' btn-quiet'), disabled: busy, title: 'For a stuck tutor: restart immediately without waiting for notes. Unanswered messages are sent again.',
        onclick: () => { if (confirm('Restart the tutor right now, without letting it save notes first?')) handoff(true); } }, 'Restart now')) : '');
}
