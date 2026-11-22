// Learn view: the conversation thread + the two input boxes.
import { h, $, $$, store, skillById, levelOf, lvClass, fmtDate, fmtTime, shortId } from './util.js';
import { renderInto, rich, linkTerms } from './rich.js';
import { questionText, plain } from './md.js';
import { icon } from './icons.js';
import { app, send } from './app.js';
import { openDock, togglePin, isPinned, renderDock } from './panels.js';

const PAGE = 60;
let thread, composer, shownFrom = 0, quote = null, sizes = null, drawnLegend = '';

export function render(center) {
  thread = h('div', { class: 'thread', id: 'thread' });
  composer = h('div', { class: 'composer', id: 'composer' });
  if (store.get('composerH', 0)) requestAnimationFrame(() => setComposerH(store.get('composerH', 0)));
  center.replaceChildren(h('div', { class: 'learn' }, h('div', { class: 'thread-scroll', id: 'threadScroll' }, thread), composer));
  anchor = null;
  drawThread();
  drawComposer();
  const target = app.args[0] === 'm' && app.args[1];
  requestAnimationFrame(() => (target ? reveal(target) : scrollBottom()));
  $('#threadScroll').addEventListener('scroll', onScroll);
  // whatever changes size in the thread (an entry, a redraw, an image or diagram finishing its
  // layout), what the learner is reading stays where it is
  sizes?.disconnect();
  sizes = new ResizeObserver(keepAnchor);
  sizes.observe(thread);
}
export function update(args) { if (args[0] === 'm' && args[1]) reveal(args[1]); }

const visible = e => ['message', 'answer', 'ask', 'action', 'start', 'level', 'session'].includes(e.kind);
// keep: redraw the same stretch of the conversation (earlier messages the learner opened stay), in place
function drawThread(keep = false) {
  const J = app.topic.journal.filter(visible);
  shownFrom = keep ? Math.min(shownFrom, Math.max(0, J.length - PAGE)) : Math.max(0, J.length - PAGE);
  drawnLegend = JSON.stringify(app.topic.meta.legend || []);
  thread.replaceChildren();
  if (shownFrom > 0) thread.append(h('div', { class: 'earlier' },
    h('button', { class: 'btn', onclick: showEarlier }, icon('up'), `Show ${Math.min(PAGE, shownFrom)} earlier messages`),
    h('button', { class: 'btn', onclick: () => { location.hash = `#/${app.topic.slug}/wiki/sessions`; } }, icon('sessions'), 'Browse all sessions')));
  let prevDate = shownFrom > 0 ? J[shownFrom - 1].ts.slice(0, 10) : null;
  for (const e of J.slice(shownFrom)) prevDate = appendEntry(e, prevDate);
  if (!J.length) thread.append(h('div', { class: 'empty' }, 'Nothing here yet. When the tutor session starts, its first message appears here.'));
  drawTyping();
  if (keep) keepAnchor();
}
function showEarlier() {
  const J = app.topic.journal.filter(visible);
  const from = Math.max(0, shownFrom - PAGE);
  const sc = $('#threadScroll'), before = sc.scrollHeight;
  const holder = thread, frag = h('div');
  thread = frag;
  let prev = from > 0 ? J[from - 1].ts.slice(0, 10) : null;
  for (const e of J.slice(from, shownFrom)) prev = appendEntry(e, prev);
  thread = holder;
  const bar = thread.querySelector('.earlier');
  bar.after(...frag.children);
  shownFrom = from;
  if (from === 0) bar.remove(); else bar.firstChild.lastChild.textContent = `Show ${Math.min(PAGE, from)} earlier messages`;
  sc.scrollTop += sc.scrollHeight - before;
}
function appendEntry(e, prevDate) {
  const day = e.ts.slice(0, 10);
  if (e.kind === 'session') {
    const when = e.handoff ? fmtTime(e.ts) : fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' });
    thread.append(h('div', { class: 'divider session' + (e.handoff ? ' handoff' : ''), title: e.handoff ? 'The previous tutor session saved its notes and a new one with fresh context took over' : '' },
      h('span', { text: `${e.text || 'Session'} · ${when}` })));
    return day;
  }
  if (day !== prevDate) thread.append(h('div', { class: 'divider' }, h('span', { text: fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' }) })));
  if (e.kind === 'level') {
    const s = skillById(app.topic.meta, e.skill);
    thread.append(h('div', { class: 'sysline', id: 'm-' + e.id },
      h('span', { class: 'lvchange ' + (e.to > e.from ? 'up' : 'down') }, icon(e.to > e.from ? 'up' : 'down')),
      h('button', { class: 'linkish', text: `${e.skill} ${s?.name || ''}`, onclick: () => openDock('skill', e.skill) }),
      h('span', { class: 'lv ' + lvClass(e.from), text: e.from }), '→', h('span', { class: 'lv ' + lvClass(e.to), text: e.to }),
      e.reason ? h('span', { class: 'muted', text: e.reason }) : null));
    return day;
  }
  thread.append(messageNode(e));
  return day;
}

const KIND = { answer: ['Answer', 'send'], ask: ['Question', 'ask'], action: ['Button', 'chev'], start: ['New topic', 'plus'] };
const VERDICT = { correct: '✓ Correct', partial: '◐ Partly right', wrong: '✗ Not quite', skipped: '↷ Skipped' };
export function messageNode(e, { compact = false, pinnable = false } = {}) {
  const tutor = e.role === 'tutor';
  const art = h('article', { class: `msg ${tutor ? 'msg-tutor' : 'msg-user'} kind-${e.kind} hl-scope` + (e.imported ? ' imported' : ''), id: compact ? null : 'm-' + e.id, 'data-id': e.id });
  const head = h('header', { class: 'msg-head' });
  head.append(h('span', { class: 'who' }, tutor ? icon('bulb') : null, tutor ? 'Tutor' : 'You'));
  if (!tutor && KIND[e.kind]) head.append(h('span', { class: 'kind-tag' }, icon(KIND[e.kind][1]), KIND[e.kind][0]));
  if (e.kind === 'action') head.append(h('span', { class: 'action-text', text: e.text, title: e.text }));
  if (e.imported) head.append(h('span', { class: 'imported-tag', title: 'Imported from a terminal session', text: 'terminal' }));
  const g = app.d.grades.get(e.id);
  if (g) head.append(h('span', { class: `badge verdict-${g.verdict}`, title: g.note || '', text: VERDICT[g.verdict] || g.verdict }));
  for (const sid of e._skills || []) {
    const s = skillById(app.topic.meta, sid);
    head.append(h('button', { class: 'chip chip-skill ' + lvClass(s ? levelOf(s.node) : 0), text: sid, title: s ? `${s.name} (open skill)` : '', onclick: () => openDock('skill', sid) }));
  }
  head.append(h('span', { class: 'spacer' }), h('time', { title: e.ts, text: compact ? shortId(e.id) : fmtTime(e.ts) }));
  if (!compact) head.append(h('button', { class: 'msg-id', title: 'Open this message in the side panel', text: '#' + e.id.split('.')[1], onclick: () => openDock('msg', e.id) }));
  if (tutor && (!compact || pinnable)) {
    const pinned = isPinned(e.id);
    head.append(h('span', { class: 'head-actions' },
      h('button', { class: 'icon-btn' + (pinned ? ' on' : ''), title: pinned ? 'Unpin from the side panel' : 'Pin to the side panel (keep it visible while answering)',
        onclick: ev => { togglePin(e.id); ev.currentTarget.classList.toggle('on'); renderDock(); } }, icon('pin')),
      h('button', { class: 'icon-btn', title: 'Ask about this message', onclick: () => { quote = { id: e.id, text: plain(e.text, 300) }; prefillAsk(store.get('draft:ask:' + app.topic.slug, '')); } }, icon('ask'))));
  }
  art.append(head);
  if (e.quote && !tutor) {
    const q = app.d.byId.get(e.quote);
    if (q) art.append(h('button', { class: 'quote-ref', onclick: () => openDock('msg', q.id) }, icon('link'), 'About ', h('b', { text: shortId(q.id) })));
  }
  if (e.kind !== 'action') {
    const body = h('div', { class: 'md msg-body' });
    art.append(body);
    renderInto(body, e.text || '', { scope: false });
  }
  if (tutor && e.question && !compact && app.d.pending?.id === e.id) art.classList.add('pending-q');
  return art;
}

function drawTyping() {
  thread.querySelector('.typing')?.remove();
  const s = app.status, J = app.topic.journal;
  const lastUser = [...J].reverse().find(e => e.role === 'user' && !e.imported);
  const lastTutor = [...J].reverse().find(e => e.role === 'tutor' && e.kind === 'message');
  const waiting = lastUser && !(lastTutor && lastTutor.ts > lastUser.ts);
  const dots = () => h('span', { class: 'dots' }, h('i'), h('i'), h('i'));
  let node = null;
  if (s.phase === 'handoff') node = h('div', { class: 'typing swap' }, dots(),
    'Switching to a fresh tutor session. The previous one saved its notes; the new one continues from them.' + (waiting ? ' Your message is queued for it.' : ''));
  else if (!waiting) node = null;
  else if (lastUser.kind === 'start' && !lastTutor && s.launcher) node = h('div', { class: 'typing' }, dots(),
    s.phase === 'thinking' ? 'The tutor is reading your goal. First a question or two to see where you stand; the skill tree and map fill in meanwhile.' : 'A tutor session for this topic is starting…');
  else if (s.phase === 'thinking') node = h('div', { class: 'typing' }, dots(), 'The tutor is thinking…');
  else if (s.phase === 'starting') node = h('div', { class: 'typing' }, dots(), 'The tutor is starting up; your message will be picked up in a moment…');
  else if (s.phase === 'listening') node = h('div', { class: 'typing' }, dots(), 'Delivering…');
  else if (s.launcher) node = h('div', { class: 'typing offline' }, h('b', { text: 'Queued. ' }), 'The tutor isn’t listening right now. If this lasts more than a minute, open the tutor status (top right) and press ', h('b', { text: 'Restart now' }), '.');
  else node = h('div', { class: 'typing offline' }, h('b', { text: 'Queued. ' }), 'No tutor is running. Start one in a terminal with ', h('code', { text: 'bin/learn' }), '; your message will be delivered then.');
  if (node) thread.append(node);
}

export function onEntries(fresh) {
  if (!thread) return;
  const sc = $('#threadScroll');
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  const J = app.topic.journal.filter(visible);
  thread.querySelector('.empty')?.remove();
  for (const e of fresh) {
    if (e.kind === 'grade') { redrawEntry(e.target); continue; }
    if (!visible(e)) continue;
    const i = J.findIndex(x => x.id === e.id);
    appendEntry(e, i > 0 ? J[i - 1].ts.slice(0, 10) : null);
  }
  $$('.pending-q', thread).forEach(n => { if (n.dataset.id !== app.d.pending?.id) n.classList.remove('pending-q'); });
  if (app.d.pending) thread.querySelector(`[id="m-${CSS.escape(app.d.pending.id)}"]`)?.classList.add('pending-q');
  drawTyping();
  drawComposer(true);
  keepAnchor();
  // Only two things move the conversation: a new tutor reply (shown from its beginning, where
  // reading starts, not the bottom of the thread) and the learner's own message. Anything else
  // (a grade, a level change, a session divider) appears in place and the view stays put.
  const reply = fresh.find(e => e.role === 'tutor' && e.kind === 'message');
  const mine = fresh.some(e => e.role === 'user');
  if (reply && (nearBottom || mine)) scrollToStart(reply.id, true);
  else if (mine) scrollBottom(true);
  else if (reply) showNewPill(reply.id);
}
function redrawEntry(id) {
  const n = thread.querySelector(`[id="m-${CSS.escape(id)}"]`), e = app.d.byId.get(id);
  if (n && e) n.replaceWith(messageNode(e));
}
export function onStatus() { if (thread) drawTyping(); }
// Topic files changed (the tutor's bookkeeping): update what the conversation shows of them, in
// place. A full redraw would restart diagrams and reload images under the reader, so only the
// rare changes that need one get it (and it keeps the place).
export function onTopic(part) {
  if (!thread) return;
  if (!part || part === 'tags.json' || part === 'media' || JSON.stringify(app.topic.meta.legend || []) !== drawnLegend) drawThread(true);
  else if (part === 'glossary.md') { for (const b of thread.querySelectorAll('.msg-body')) linkTerms(b); return; }
  else if (part === 'topic.json') refreshSkills();
  else return;   // notes, progress, log, pages, map…: nothing in the conversation shows them
  drawComposer(true);
}
function refreshSkills() {
  for (const b of thread.querySelectorAll('.msg-head .chip-skill')) {
    const s = skillById(app.topic.meta, b.textContent);
    b.className = 'chip chip-skill ' + lvClass(s ? levelOf(s.node) : 0);
  }
}

// ---------------------------------------------------------------- keeping the reader's place
// What the learner is reading never moves unless they scroll, or a new reply / their own message
// is shown. After every scroll we remember the entry at the top edge (and inside a long message,
// the paragraph at the top edge) with its offset; when the thread changes size we put it back.
// This is the one rule in every browser: native scroll anchoring is off (.thread-scroll).
let anchor = null, steerUntil = 0;
function takeAnchor() {
  const sc = $('#threadScroll');
  anchor = null;
  if (!sc || !thread) return;
  const top = sc.getBoundingClientRect().top, kids = [...thread.children];
  let lo = 0, hi = kids.length - 1, i = kids.length;   // the first entry reaching below the top edge
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (kids[mid].getBoundingClientRect().bottom > top) { i = mid; hi = mid - 1; } else lo = mid + 1; }
  const n = kids.slice(i).find(k => k.id);
  if (!n) return;
  const r = n.getBoundingClientRect();
  anchor = { id: n.id, off: r.top - top, at: sc.scrollTop };
  if (r.top < top) {
    const inner = [...n.querySelectorAll(':scope > .msg-body > *')].find(k => k.getBoundingClientRect().bottom > top);
    if (inner) Object.assign(anchor, { el: inner, elOff: inner.getBoundingClientRect().top - top });
  }
}
function keepAnchor() {
  const sc = $('#threadScroll');
  if (!sc || !thread) return;
  // no anchor yet, a deliberate scroll still running, or scrolled since (event not handled yet): re-take
  if (!anchor || Date.now() < steerUntil || Math.abs(sc.scrollTop - anchor.at) > 1) return takeAnchor();
  const inner = anchor.el?.isConnected ? anchor.el : null, n = inner || document.getElementById(anchor.id);
  if (!n) return takeAnchor();
  const d = n.getBoundingClientRect().top - sc.getBoundingClientRect().top - (inner ? anchor.elOff : anchor.off);
  if (Math.abs(d) >= 1) sc.scrollTop += d;
  takeAnchor();
}
// a deliberate (smooth) scroll: don't hold the old place while it runs
function steer(ms = 1000) { steerUntil = Date.now() + ms; }

function scrollBottom(smooth) {
  const sc = $('#threadScroll');
  if (sc) { if (smooth) steer(); sc.scrollTo({ top: sc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); if (!smooth) takeAnchor(); }
  hideNewPill();
}
function onScroll() { const sc = $('#threadScroll'); takeAnchor(); if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80) hideNewPill(); }
function scrollToStart(id, smooth) {
  const sc = $('#threadScroll'), n = thread?.querySelector(`[id="m-${CSS.escape(id)}"]`);
  if (!sc || !n) return scrollBottom(smooth);
  const top = sc.scrollTop + n.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
  if (smooth) steer();
  sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' }); hideNewPill();
  if (!smooth) takeAnchor();
}
function showNewPill(id) {
  if ($('.newpill')) return;
  $('.learn').style.setProperty('--composer-h', composer.offsetHeight + 'px');
  $('.learn').append(h('button', { class: 'newpill btn btn-primary', onclick: () => (id ? scrollToStart(id, true) : scrollBottom(true)) }, icon('down'), 'New message'));
}
function hideNewPill() { $('.newpill')?.remove(); }

export function reveal(id) {
  if (app.view !== 'learn') { location.hash = `#/${app.topic.slug}/learn/m/${id}`; return; }
  let n = thread.querySelector(`[id="m-${CSS.escape(id)}"]`);
  while (!n && shownFrom > 0) { showEarlier(); n = thread.querySelector(`[id="m-${CSS.escape(id)}"]`); }
  if (!n) return;
  steer(1200);
  n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
}

// ---------------------------------------------------------------- composer
const QUICK = [
  ['Just tell me', 'just tell me', 'bulb', 'Skip the Socratic part for this question and explain the answer'],
  ['Example', 'example', 'example', 'Show a concrete small example'],
  ["I'm lost", "I'm lost: re-explain differently, smaller steps, concrete shapes", 'lost', 'Re-explain from a different angle, in smaller steps'],
  ['Skip', 'skip', 'skip', 'Skip this question for now'],
  ['Easier', 'easier', 'down', 'Make questions easier'],
  ['Harder', 'harder', 'up', 'Make questions harder'],
  ['Progress', 'show progress', 'progress', 'Ask the tutor for a progress summary'],
  ['Pause', 'pause: wrap up the session, update progress notes', 'pause', 'End the session; the tutor saves its notes'],
];
function drawComposer(keepFocus) {
  if (!composer) return;
  const act = document.activeElement, active = act?.id;
  const caret = act && composer.contains(act) && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd, act.scrollTop] : null;
  const slug = app.topic.slug, pend = app.d.pending;
  const qtext = pend ? questionText(pend.text) : null;
  const ta = (id, ph, key) => {
    const t = h('textarea', { id, class: 'input', placeholder: ph, rows: 3 });
    t.value = store.get(key, '');
    const fit = () => {
      if (composer.classList.contains('sized')) { t.style.height = ''; return; }
      t.style.height = 'auto'; t.style.height = Math.min(300, Math.max(64, t.scrollHeight + 2)) + 'px';
    };
    t.addEventListener('input', () => { store.set(key, t.value); fit(); });
    requestAnimationFrame(fit);
    return t;
  };
  const aBox = ta('answerBox', pend ? 'Type your answer. Thinking out loud is fine.' : 'No open question right now. You can still reply to the tutor here.', 'draft:answer:' + slug);
  const qBox = ta('askBox', 'Ask anything: why…, what was…, show me…', 'draft:ask:' + slug);
  const sendA = async () => { const text = aBox.value.trim(); if (text) await doSend('answer', text, pend ? { replyTo: pend.id } : {}, aBox, 'draft:answer:'); };
  const sendQ = async () => {
    let text = qBox.value.trim(); if (!text && !quote) return;
    const extra = {};
    if (quote) { text = quote.text.split('\n').map(l => '> ' + l).join('\n') + '\n\n' + (text || 'Can you explain this part?'); extra.quote = quote.id; }
    await doSend('ask', text, extra, qBox, 'draft:ask:');
    quote = null; drawComposer();
  };
  const keys = fn => ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); fn(); } };
  aBox.addEventListener('keydown', keys(sendA));
  qBox.addEventListener('keydown', keys(sendQ));
  const qCollapsed = store.get('qcollapsed', false);

  const answer = h('div', { class: 'box box-answer' },
    h('div', { class: 'box-h' }, icon('send'), pend ? 'Answer the question' : 'Reply', h('span', { class: 'spacer' }),
      pend ? h('button', { class: 'btn btn-tiny', title: 'Jump to the question in the conversation', onclick: () => reveal(pend.id) }, 'Go to question') : null,
      pend ? h('button', { class: 'btn btn-tiny', text: qCollapsed ? 'Show' : 'Hide', title: 'Show/hide the question text here', onclick: () => { store.set('qcollapsed', !qCollapsed); drawComposer(); } }) : null),
    pend && !qCollapsed ? h('div', { class: 'box-q' }, rich(qtext || plain(pend.text, 400), 'hl-scope')) : null,
    aBox,
    h('div', { class: 'box-f' }, h('span', { class: 'hint', text: 'Closes the question. The tutor grades it.' }),
      h('button', { class: 'btn btn-primary', onclick: sendA }, 'Send answer ', h('kbd', { text: '⌘↵' }))));
  const ask = h('div', { class: 'box box-ask' },
    h('div', { class: 'box-h' }, icon('ask'), 'Ask / learn more', h('span', { class: 'sub', text: 'the question stays open' })),
    quote ? h('div', { class: 'quote-chip' }, h('span', { class: 'muted small', text: `About ${shortId(quote.id)}:` }), h('span', { class: 'quote-text', text: '“' + plain(quote.text, 140) + '”' }),
      h('button', { class: 'icon-btn', title: 'Remove quote', onclick: () => { quote = null; drawComposer(); } }, icon('close'))) : null,
    qBox,
    h('div', { class: 'box-f' }, h('span', { class: 'hint', text: 'Tip: select text in any message to ask about it.' }),
      h('button', { class: 'btn btn-ask', onclick: sendQ }, 'Ask ', h('kbd', { text: '⌘↵' }))));
  composer.replaceChildren(grip(), h('div', { class: 'composer-inner' },
    welcomeBack(),
    h('div', { class: 'boxes' }, answer, ask),
    h('div', { class: 'quick' }, ...QUICK.flatMap(([label, text, ic, title], i) => [i === 6 ? h('span', { class: 'sep' }) : null,
      h('button', { class: 'btn btn-small', title, onclick: () => quickAction(text) }, icon(ic), label)]))));
  if (keepFocus && active) {
    const n = document.getElementById(active);
    n?.focus();
    if (n && caret && 'setSelectionRange' in n) { n.setSelectionRange(caret[0], caret[1]); n.scrollTop = caret[2]; }
  }
}
// "Welcome back": after a gap, the learner decides whether they want a recap (the tutor doesn't post
// one unasked). Hidden after a short gap, once used or dismissed, or while a reply is pending.
function welcomeBack() {
  const J = app.topic.journal;
  const last = [...J].reverse().find(e => e.kind !== 'session' && !e.imported) || [...J].reverse().find(e => e.kind !== 'session');
  if (!last) return null;
  const gap = Date.now() - Date.parse(last.ts);
  const key = 'welcomeBack:' + app.topic.slug;
  if (gap < 8 * 3600e3 || store.get(key, '') === last.id) return null;
  const days = Math.round(gap / 86400e3);
  const ago = gap < 36 * 3600e3 ? `${Math.round(gap / 3600e3)} hours` : `${days} days`;
  const focus = app.topic.meta.focus && skillById(app.topic.meta, app.topic.meta.focus);
  const week = gap >= 7 * 86400e3;
  const dismiss = () => { store.set(key, last.id); drawComposer(); };
  const ask = text => { store.set(key, last.id); quickAction(text); };
  return h('div', { class: 'welcome-back' },
    icon('learn'),
    h('div', { class: 'wb-text' }, h('b', { text: 'Welcome back. ' }), `Your last session here was ${ago} ago${focus ? `; you were on ${focus.id} ${focus.name}` : ''}.`),
    h('button', { class: 'btn btn-small btn-primary', title: 'The tutor recaps where you were, linking the earlier explanations, then asks one review question',
      onclick: () => ask(`welcome back (${ago} away): recap where we were, linking the earlier messages, then one spaced-review question${week ? '; check that the building blocks of the current focus still hold' : ''}`) }, icon('notes'), week ? 'Recap + check the basics' : 'Recap + review question'),
    h('button', { class: 'btn btn-small', title: 'No recap: carry on where you left off', onclick: dismiss }, 'Just continue'));
}
// Drag the composer's top edge to make it taller; double-click returns to automatic size.
function setComposerH(px) {
  const max = Math.max(200, ($('.learn')?.clientHeight || innerHeight) - 140);
  if (!px) { composer.classList.remove('sized'); composer.style.height = ''; }
  else { composer.classList.add('sized'); composer.style.height = Math.min(max, Math.max(190, px)) + 'px'; }
  refit();
}
function grip() {
  const g = h('div', { class: 'composer-grip', title: 'Drag to resize · double-click for automatic size' });
  g.addEventListener('pointerdown', ev => {
    ev.preventDefault(); g.setPointerCapture(ev.pointerId);
    const y0 = ev.clientY, h0 = composer.offsetHeight;
    document.body.classList.add('resizing-v');
    const move = e => setComposerH(h0 + (y0 - e.clientY));
    const up = () => {
      g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-v');
      store.set('composerH', composer.offsetHeight); refit();
    };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
  });
  g.addEventListener('dblclick', () => { store.set('composerH', 0); setComposerH(0); refit(); });
  return g;
}
function refit() { for (const t of composer.querySelectorAll('textarea')) t.dispatchEvent(new Event('input')); }
async function doSend(kind, text, extra, box, draftPrefix) {
  // Clear first: the server echoes the entry over SSE before send() resolves, and that
  // redraws the composer from the saved draft. Restore the draft only if sending fails.
  const key = draftPrefix + app.topic.slug, draft = box.value;
  store.set(key, ''); box.value = '';
  try { await send(kind, text, extra); }
  catch (e) {
    store.set(key, draft);
    const cur = document.getElementById(box.id); if (cur) cur.value = draft;
    alert('Could not send: ' + e.message);
  }
}
export async function quickAction(text) {
  try { await send('action', text, app.d.pending ? { replyTo: app.d.pending.id } : {}); }
  catch (e) { alert('Could not send: ' + e.message); }
  if (app.view !== 'learn') location.hash = `#/${app.topic.slug}/learn`;
}
export function prefillAsk(text) {
  store.set('draft:ask:' + app.topic.slug, text);
  if (app.view !== 'learn') location.hash = `#/${app.topic.slug}/learn`;
  else drawComposer();
  setTimeout(() => { const q = $('#askBox'); if (q) { q.value = text; q.focus(); } }, 50);
}

// select text in any message -> "Ask about this"
let selBtn = null;
document.addEventListener('mouseup', () => setTimeout(() => {
  const sel = window.getSelection();
  const txt = sel && String(sel).trim();
  selBtn?.remove(); selBtn = null;
  if (!txt || txt.length < 3) return;
  const msg = sel.anchorNode?.parentElement?.closest('.msg');
  if (!msg) return;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  selBtn = h('button', { class: 'btn btn-ask btn-small selask', onmousedown: ev => ev.preventDefault(),
    onclick: () => { quote = { id: msg.dataset.id, text: txt }; selBtn.remove(); selBtn = null; sel.removeAllRanges(); prefillAsk(store.get('draft:ask:' + app.topic.slug, '')); } }, icon('ask'), 'Ask about this');
  selBtn.style.left = Math.min(window.innerWidth - 150, r.left + r.width / 2 - 60) + 'px';
  selBtn.style.top = Math.max(8, r.top - 36) + 'px';
  document.body.append(selBtn);
}, 10));
