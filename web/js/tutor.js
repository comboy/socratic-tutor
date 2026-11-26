// Tutor status pill (toolbar) and its popover: state, context ("memory") meter, Fresh tutor.
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
function ctxLevel(c) { const f = c.tokens / c.limit; return f < 0.6 ? 'ok' : f < 0.9 ? 'mid' : 'high'; }

let prevPhase = null;
export function renderStatus() {
  const s = app.status, el = $('#status');
  if (prevPhase === 'handoff' && s.phase !== 'handoff') note = '';
  prevPhase = s.phase;
  const [cls, text] = phaseInfo(s);
  const c = s.context;
  el.className = 'status ' + cls + (pop ? ' open' : '');
  el.title = 'Tutor status and memory (click)';
  el.replaceChildren(h('span', { class: 'dot' }), h('span', { text }),
    c && !s.offline ? h('span', { class: 'ctx-mini ' + ctxLevel(c), title: `Context ${k(c.tokens)} of ${k(c.limit)}` }, h('i', { style: { width: Math.min(100, c.tokens / c.limit * 100) + '%' } })) : '');
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
  pop.replaceChildren(
    h('div', { class: 'pop-h ' + cls }, h('span', { class: 'dot' }), h('b', { text }), h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Close', onclick: closePopover }, icon('close'))),
    h('div', { class: 'pop-b' }, h('p', { class: 'pop-desc', text: desc }),
      s.launcher ? h('div', { class: 'pop-sec' },
        h('div', { class: 'pop-label' }, h('span', { text: 'Tutor memory (context)' }), h('span', { class: 'spacer' }),
          h('span', { class: 'mono small', text: c ? `${k(c.tokens)} / ${k(c.limit)}` : '—' })),
        h('div', { class: 'meter ctx-meter ' + (c ? ctxLevel(c) : '') }, h('i', { style: { width: c ? Math.min(100, c.tokens / c.limit * 100) + '%' : '0' } })),
        h('div', { class: 'pop-hint', text: c
          ? `At ${k(c.limit)} the tutor saves its notes and a fresh session takes over by itself. Everything you learned stays in the topic files, so nothing is lost.`
          : 'Shown once the tutor has replied at least once in this session.' }))
        : h('div', { class: 'pop-warn' }, 'This tutor wasn’t started by ', h('code', { text: 'bin/learn' }), ', so it can’t be switched from here. Run ', h('code', { text: 'bin/learn' }), ' in a terminal.'),
      s.kind === 'handoff' && !busy ? h('div', { class: 'pop-hint', text: 'This session took over from an earlier one with fresh context.' }) : null,
      app.topic ? h('div', { class: 'pop-hint' }, h('a', { href: `#/${app.topic.slug}/wiki/you`, id: 'instrLink', onclick: () => closePopover() }, 'Your instructions to every tutor'),
        ': how they should work with you; they override everything the tutors work out themselves.') : null,
      note ? h('div', { class: 'pop-note', text: note }) : null),
    s.launcher ? h('div', { class: 'pop-f' },
      h('button', { class: 'btn', disabled: busy, title: 'The tutor saves its notes, then a new session continues where it left off', onclick: () => handoff(false) }, icon('auto'), 'Fresh tutor'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small btn-quiet', disabled: busy, title: 'For a stuck tutor: restart immediately without waiting for notes. Unanswered messages are sent again.',
        onclick: () => { if (confirm('Restart the tutor right now, without letting it save notes first?')) handoff(true); } }, 'Restart now')) : '');
}
