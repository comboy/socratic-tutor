// Learn view: the conversation thread + the input box (answer / ask), which can hide in a corner.
// With two threads open (an experiment against reply latency, journal.js), a bar on top switches
// between them and sending in one takes the learner to the other when its reply is waiting.
import { h, $, $$, store, skillById, levelOf, lvClass, fmtDate, fmtTime, shortId } from './util.js';
import { renderInto, rich, linkTerms } from './rich.js';
import { questionText, plain } from './md.js';
import { icon } from './icons.js';
import { app, send } from './app.js';
import { openDock, togglePin, isPinned, renderDock } from './panels.js';
import { trackOf } from './journal.js';

const PAGE = 60;
let thread, composer, trackBar, shownFrom = 0, quote = null, sizes = null, drawnLegend = '';

// ---------------------------------------------------------------- two threads
// null when only one thread is open; else 'a' or 'b', the one on screen (remembered per topic)
function curTrack() {
  if (!app.d?.tracks?.open) return null;
  const t = store.get('track:' + app.topic.slug, 'a');
  return t === 'b' ? 'b' : 'a';
}
const otherTrack = t => (t === 'b' ? 'a' : 'b');
function curPending() { const t = curTrack(); return t ? app.d.pendingBy[t] : app.d.pending; }
// the lesson exchange of a thread: the learner's messages and the tutor's replies, no app talk
const lessonEntry = e => !e._meta && !e.imported && (e.role === 'user' ? ['answer', 'ask', 'action', 'start'].includes(e.kind) : e.role === 'tutor' && e.kind === 'message');
function lastLesson(t) {
  const J = app.topic.journal;
  for (let i = J.length - 1; i >= 0; i--) if (lessonEntry(J[i]) && (!t || trackOf(J[i]) === t)) return J[i];
  return null;
}
// the tutor message the learner hasn't seen in a thread they're not looking at (stored per topic)
const seenKey = t => `seen:${app.topic.slug}:${t}`;
function markSeen() { const t = curTrack(), l = t && lastLesson(t); if (l && l.role === 'tutor') store.set(seenKey(t), l.id); }
function trackState(t) {
  const l = lastLesson(t);
  if (!l) return { key: 'empty', text: 'nothing yet' };
  if (l.role === 'user') return { key: 'writing', text: 'writing…' };
  if (t !== curTrack() && store.get(seenKey(t), '') !== l.id) return { key: 'ready', text: 'ready' };
  return app.d.pendingBy?.[t] ? { key: 'turn', text: 'your turn' } : { key: 'idle', text: 'read' };
}
function drawTrackBar(note) {
  if (!trackBar) return;
  const tr = app.d.tracks, cur = curTrack();
  trackBar.hidden = !tr.open;
  if (!tr.open) { trackBar.replaceChildren(); return; }
  const tab = t => {
    const st = trackState(t);
    return h('button', { class: `track-tab st-${st.key}` + (t === cur ? ' on' : ''), title: (tr.titles[t] || '') + ` · ${st.text}  (t switches)`, onclick: () => switchTrack(t) },
      h('span', { class: 'track-letter', text: t.toUpperCase() }), h('span', { class: 'track-title', text: tr.titles[t] || (t === 'a' ? 'Main thread' : 'Second thread') }),
      h('span', { class: 'track-st' }, st.key === 'writing' ? h('span', { class: 'dots' }, h('i'), h('i'), h('i')) : null, st.text));
  };
  trackBar.replaceChildren(
    h('span', { class: 'track-label', title: 'An experiment against waiting: while you read and answer one thread, the tutor writes the reply in the other. Sending in one takes you to the other when its reply is ready.' },
      icon('threads'), h('span', { class: 'track-label-t', text: 'Two threads' }), h('span', { class: 'exp-tag', text: 'experiment' })),
    h('div', { class: 'track-tabs' }, tab('a'), tab('b')),
    note ? h('span', { class: 'track-note', role: 'status', text: note }) : null,
    h('button', { class: 'btn btn-tiny', title: 'Ask the tutor to fold the second thread back into the main one', onclick: () => quickAction('two threads: off (fold the second thread back into the main one)') }, 'One thread'));
}
let noteTimer = 0;
// opts.toReply: show the reply waiting there (the first tutor message after the learner's last
// message in that thread), otherwise its open question, otherwise the end
export function switchTrack(t, { toReply = false, note = '' } = {}) {
  if (!app.d.tracks.open || !thread) return;
  store.set('track:' + app.topic.slug, t);
  drawThread();
  drawComposer();
  clearTimeout(noteTimer);
  if (note) noteTimer = setTimeout(() => drawTrackBar(), 6000);
  const J = app.topic.journal.filter(e => lessonEntry(e) && trackOf(e) === t);
  let i = J.length; while (i > 0 && J[i - 1].role === 'tutor') i--;
  const target = (toReply && J[i]) || curPending() || null;
  requestAnimationFrame(() => (target ? scrollToStart(target.id, false) : scrollBottom()));
  markSeen();
  drawTrackBar(note);
}

export function render(center) {
  thread = h('div', { class: 'thread', id: 'thread' });
  composer = h('div', { class: 'composer', id: 'composer' });
  trackBar = h('div', { class: 'tracks-bar', id: 'tracksBar' });
  if (store.get('composerH', 0) && !store.get('composerHidden', false)) requestAnimationFrame(() => setComposerH(store.get('composerH', 0)));
  center.replaceChildren(h('div', { class: 'learn' }, trackBar, h('div', { class: 'thread-scroll', id: 'threadScroll' }, thread), composer));
  anchor = null;
  // a link to a message in the other thread opens that thread
  const target0 = app.args[0] === 'm' && app.d.byId.get(app.args[1]);
  if (target0 && curTrack() && trackOf(target0) !== curTrack()) store.set('track:' + app.topic.slug, trackOf(target0));
  drawTrackBar();
  drawThread();
  drawComposer();
  markSeen();
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

const shown = e => ['message', 'answer', 'ask', 'action', 'start', 'meta', 'level', 'session'].includes(e.kind);
// with two threads open, the conversation shows the current one (app talk and dividers in both)
const visible = e => {
  if (!shown(e)) return false;
  const t = curTrack();
  if (!t || e.kind === 'meta' || e._meta || trackOf(e) === t) return true;
  return e.kind === 'session' && (t === 'a' || e.ts >= app.d.tracks.since);   // b began when the threads opened
};
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
  if (!J.length) thread.append(h('div', { class: 'empty' }, 'Nothing here yet. Write below to start: the tutor replies here.'));
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
// App talk (e._meta: "About the app", --meta replies, entries the tutor tagged) is dimmed and folded
// to one line in the conversation. Open: the ones that arrived while the page was open, or opened by hand.
const openMeta = new Set();
export function messageNode(e, { compact = false, pinnable = false } = {}) {
  const tutor = e.role === 'tutor';
  const folded = e._meta && !compact && !openMeta.has(e.id);
  const art = h('article', { class: `msg ${tutor ? 'msg-tutor' : 'msg-user'} kind-${e.kind} hl-scope` + (e.imported ? ' imported' : '') + (e._meta ? ' msg-meta' : '') + (folded ? ' folded' : ''),
    id: compact ? null : 'm-' + e.id, 'data-id': e.id });
  const fold = () => toggleMeta(e, art);
  const head = h('header', { class: 'msg-head' });
  head.append(h('span', { class: 'who' }, tutor ? icon('bulb') : null, tutor ? 'Tutor' : 'You'));
  if (e._meta) head.append(h('span', { class: 'kind-tag meta-tag', title: 'About the app, not the lesson: kept out of the wiki, the session pages and the stats' }, icon('feedback'), 'About the app'));
  else if (!tutor && KIND[e.kind]) head.append(h('span', { class: 'kind-tag' }, icon(KIND[e.kind][1]), KIND[e.kind][0]));
  if (e.kind === 'action') head.append(h('span', { class: 'action-text', text: e.text, title: e.text }));
  else if (folded) head.append(h('button', { class: 'meta-preview', title: 'Show the whole message', text: plain(e.text || '', 240), onclick: fold }));
  if (e.imported) head.append(h('span', { class: 'imported-tag', title: 'Imported from a terminal session', text: 'terminal' }));
  if (e.track === 'b' && (compact || !curTrack())) head.append(h('span', { class: 'track-chip', title: 'From the second thread', text: 'thread B' }));
  const g = app.d.grades.get(e.id);
  if (g) head.append(h('span', { class: `badge verdict-${g.verdict}`, title: g.note || '', text: VERDICT[g.verdict] || g.verdict }));
  for (const sid of e._meta ? [] : e._skills || []) {   // app talk belongs to no skill
    const s = skillById(app.topic.meta, sid);
    head.append(h('button', { class: 'chip chip-skill ' + lvClass(s ? levelOf(s.node) : 0), text: sid, title: s ? `${s.name} (open skill)` : '', onclick: () => openDock('skill', sid) }));
  }
  if (!folded || e.kind === 'action') head.append(h('span', { class: 'spacer' }));
  head.append(h('time', { title: e.ts, text: compact ? shortId(e.id) : fmtTime(e.ts) }));
  if (!compact) head.append(h('button', { class: 'msg-id', title: 'Open this message in the side panel', text: '#' + e.id.split('.')[1], onclick: () => openDock('msg', e.id) }));
  if (e._meta && !compact) head.append(h('button', { class: 'icon-btn meta-fold' + (folded ? '' : ' open'), title: folded ? 'Show the whole message' : 'Fold it away', onclick: fold }, icon('chev')));
  if (tutor && !folded && (!compact || pinnable)) {
    const pinned = isPinned(e.id);
    head.append(h('span', { class: 'head-actions' },
      h('button', { class: 'icon-btn' + (pinned ? ' on' : ''), title: pinned ? 'Unpin from the side panel' : 'Pin to the side panel (keep it visible while answering)',
        onclick: ev => { togglePin(e.id); ev.currentTarget.classList.toggle('on'); renderDock(); } }, icon('pin')),
      h('button', { class: 'icon-btn', title: 'Ask about this message', onclick: () => { quote = { id: e.id, text: plain(e.text, 300) }; prefillAsk(store.get(draftKey('ask'), '')); } }, icon('ask'))));
  }
  art.append(head);
  if (folded) return art;
  if (e.quote && !tutor) {
    const q = app.d.byId.get(e.quote);
    if (q) art.append(h('button', { class: 'quote-ref', onclick: () => openDock('msg', q.id) }, icon('link'), 'About ', h('b', { text: shortId(q.id) })));
  }
  if (e.kind !== 'action') {
    const body = h('div', { class: 'md msg-body' });
    art.append(body);
    renderInto(body, e.text || '', { scope: false });
  }
  if (tutor && e.question && !compact && curPending()?.id === e.id) art.classList.add('pending-q');
  return art;
}
function toggleMeta(e, art) {
  if (openMeta.has(e.id)) openMeta.delete(e.id); else openMeta.add(e.id);
  const n = messageNode(e, art.id ? {} : { compact: true });
  art.replaceWith(n);
  // folding a long message whose top is above the window: keep its (now one-line) header in sight
  const sc = $('#threadScroll');
  if (!sc || !thread?.contains(n)) return;
  const above = n.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  if (above < 0) sc.scrollTop += above - 8;
  takeAnchor();
}

function drawTyping() {
  thread.querySelector('.typing')?.remove();
  const s = app.status, t = curTrack(), J = t ? app.topic.journal.filter(e => trackOf(e) === t) : app.topic.journal;
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
  // two threads: while this one is being written, the other may have its reply ready
  if (node && t && waiting && s.phase !== 'handoff' && ['ready', 'turn'].includes(trackState(otherTrack(t)).key))
    node.append(h('button', { class: 'btn btn-small btn-primary', onclick: () => switchTrack(otherTrack(t), { toReply: true }) },
      `Thread ${otherTrack(t).toUpperCase()} is ready`, icon('chev')));
  if (node) thread.append(node);
}

export function onEntries(fresh) {
  if (!thread) return;
  // two threads opened or closed: everything changes shape
  if (fresh.some(e => e.kind === 'tracks')) { drawTrackBar(); drawThread(); drawComposer(); scrollBottom(); markSeen(); return; }
  const sc = $('#threadScroll');
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  const J = app.topic.journal.filter(visible);
  thread.querySelector('.empty')?.remove();
  for (const e of fresh) {
    if (e.kind === 'grade') { redrawEntry(e.target); continue; }
    if (e.kind === 'tag') { retag(e.ids || []); continue; }
    if (!visible(e)) continue;
    if (e._meta) openMeta.add(e.id);   // app talk arriving now is shown open; folded on a later visit
    const i = J.findIndex(x => x.id === e.id);
    appendEntry(e, i > 0 ? J[i - 1].ts.slice(0, 10) : null);
  }
  const pend = curPending();
  $$('.pending-q', thread).forEach(n => { if (n.dataset.id !== pend?.id) n.classList.remove('pending-q'); });
  if (pend) thread.querySelector(`[id="m-${CSS.escape(pend.id)}"]`)?.classList.add('pending-q');
  drawTyping();
  drawComposer(true);
  keepAnchor();
  if (curTrack()) { if (fresh.some(e => visible(e) && e.role === 'tutor') && nearBottom) markSeen(); drawTrackBar(); }
  // Only two things move the conversation: a new tutor reply (shown from its beginning, where
  // reading starts, not the bottom of the thread) and the learner's own message. Anything else
  // (a grade, a level change, a tag, a session divider) appears in place and the view stays put.
  const reply = fresh.find(e => e.role === 'tutor' && e.kind === 'message' && visible(e));
  const mine = fresh.some(e => e.role === 'user' && visible(e));
  if (reply && (nearBottom || mine)) scrollToStart(reply.id, true);
  else if (mine) scrollBottom(true);
  else if (reply) showNewPill(reply.id);
}
function redrawEntry(id) {
  const n = thread.querySelector(`[id="m-${CSS.escape(id)}"]`), e = app.d.byId.get(id);
  if (n && e) n.replaceWith(messageNode(e));
}
// the tutor tagged (or untagged) entries as app talk: dim and fold them, except one the learner is
// looking at right now (it folds on a later visit)
function retag(ids) {
  const sc = $('#threadScroll'), r = sc.getBoundingClientRect();
  for (const id of ids) {
    const n = thread.querySelector(`[id="m-${CSS.escape(id)}"]`);
    if (!n) continue;
    const b = n.getBoundingClientRect();
    if (b.bottom > r.top && b.top < r.bottom) openMeta.add(id); else openMeta.delete(id);
    redrawEntry(id);
  }
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
  const e = app.d.byId.get(id);
  if (e && curTrack() && shown(e) && !visible(e)) { store.set('track:' + app.topic.slug, trackOf(e)); drawTrackBar(); drawThread(); drawComposer(); }
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
  null,
  ['Progress', 'show progress', 'progress', 'Ask the tutor for a progress summary'],
  ['Pause', 'pause: wrap up the session, update progress notes', 'pause', 'End the session; the tutor saves its notes'],
];
const TWO_ON = 'two threads: on (open a second, closely related thread, so I can read and answer one while you write the other; docs/method.md "Two threads")';

// One box, two modes: Answer (closes the open question; the tutor grades it) and Ask (a side
// question; the question stays open). Each mode, and each thread, keeps its own draft. The colour
// says which mode it is (answer blue, ask violet). The box can hide in the corner (Esc, or the
// chevron) so the conversation gets the whole height; a, q or the corner buttons bring it back.
let mode = store.get('composerMode', 'answer'), seenPend;
function setMode(m) { mode = m; store.set('composerMode', m); }
const draftKey = (m, t = curTrack()) => `draft:${m}:${app.topic.slug}${t === 'b' ? ':b' : ''}`;
export function openComposer(m, focus = true) {
  if (m) setMode(m);
  store.set('composerHidden', false);
  if (app.view !== 'learn') { location.hash = `#/${app.topic.slug}/learn`; }
  else drawComposer();
  if (store.get('composerH', 0)) setComposerH(store.get('composerH', 0));
  if (focus) setTimeout(() => $('#composer textarea')?.focus(), 30);
}
function hideComposer() {
  store.set('composerHidden', true);
  setComposerH(0, false);
  drawComposer();
  document.activeElement?.blur?.();
}
function drawComposer(keepFocus) {
  if (!composer) return;
  const act = document.activeElement, active = act?.id;
  const caret = act && composer.contains(act) && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd, act.scrollTop] : null;
  const pend = curPending(), t = curTrack();
  // a new question arrived: back to answering, unless a side question is half-written
  if (pend?.id !== seenPend) {
    if (seenPend !== undefined && pend && mode === 'ask' && !quote && !store.get(draftKey('ask'), '').trim()) setMode('answer');
    seenPend = pend?.id;
  }
  if (quote) setMode('ask');
  const hidden = store.get('composerHidden', false);
  composer.classList.toggle('collapsed', hidden);
  if (hidden) { composer.replaceChildren(h('div', { class: 'composer-corner' }, welcomeBack(), cornerButtons(pend))); return; }

  const qtext = pend ? questionText(pend.text) : null;
  const key = draftKey(mode);
  const ta = h('textarea', { id: mode === 'ask' ? 'askBox' : 'answerBox', class: 'input', rows: 3,
    placeholder: mode === 'ask' ? 'Ask anything: why…, what was…, show me… (or select text in a message to ask about it)'
      : pend ? 'Type your answer. Thinking out loud is fine.' : 'No open question right now. You can still reply to the tutor here.' });
  ta.value = store.get(key, '');
  const fit = () => {
    if (composer.classList.contains('sized')) { ta.style.height = ''; return; }
    ta.style.height = 'auto'; ta.style.height = Math.min(300, Math.max(64, ta.scrollHeight + 2)) + 'px';
  };
  ta.addEventListener('input', () => { store.set(key, ta.value); fit(); });
  requestAnimationFrame(fit);
  const sendIt = async () => {
    let text = ta.value.trim();
    if (mode === 'answer') { if (text) await doSend('answer', text, pend ? { replyTo: pend.id } : {}, ta, key); return; }
    if (!text && !quote) return;
    const extra = {};
    if (quote) { text = quote.text.split('\n').map(l => '> ' + l).join('\n') + '\n\n' + (text || 'Can you explain this part?'); extra.quote = quote.id; }
    const ok = await doSend('ask', text, extra, ta, key);
    if (ok) { quote = null; drawComposer(); }
  };
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); sendIt(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); hideComposer(); }
  });
  const qCollapsed = store.get('qcollapsed', false);
  const modeBtn = (m, label, ic, title) => h('button', { class: `mode-${m}` + (mode === m ? ' on' : ''), title, onclick: () => { if (mode !== m) { setMode(m); drawComposer(); $('#composer textarea')?.focus(); } } }, icon(ic), label);
  const box = h('div', { class: `box box-${mode}` },
    h('div', { class: 'box-h' },
      h('div', { class: 'seg mode-seg' },
        modeBtn('answer', pend ? 'Answer' : 'Reply', 'send', 'Answer the open question: it closes it and the tutor grades it  (a)'),
        modeBtn('ask', 'Ask', 'ask', 'A side question or "tell me more": the open question stays open  (q)')),
      t ? h('span', { class: 'track-chip', title: app.d.tracks.titles[t] || '', text: 'thread ' + t.toUpperCase() }) : null,
      h('span', { class: 'sub', text: mode === 'ask' ? (pend ? 'the question stays open' : '') : pend ? 'closes the question; the tutor grades it' : '' }),
      h('span', { class: 'spacer' }),
      pend ? h('button', { class: 'btn btn-tiny goq', title: 'Jump to the question in the conversation', onclick: () => reveal(pend.id) }, 'Go to question') : null,
      pend ? h('button', { class: 'btn btn-tiny hideq', text: qCollapsed ? 'Show question' : 'Hide question', title: 'Show/hide the question text here', onclick: () => { store.set('qcollapsed', !qCollapsed); drawComposer(); } }) : null,
      h('button', { class: 'icon-btn hide-composer', id: 'hideComposer', title: 'Hide the input in the corner, for reading  (Esc · a / q bring it back)', onclick: hideComposer }, icon('chevd'))),
    pend && !qCollapsed ? h('div', { class: 'box-q' }, rich(qtext || plain(pend.text, 400), 'hl-scope')) : null,
    mode === 'ask' && quote ? h('div', { class: 'quote-chip' }, h('span', { class: 'muted small', text: `About ${shortId(quote.id)}:` }), h('span', { class: 'quote-text', text: '“' + plain(quote.text, 140) + '”' }),
      h('button', { class: 'icon-btn', title: 'Remove quote', onclick: () => { quote = null; drawComposer(); } }, icon('close'))) : null,
    ta,
    h('div', { class: 'box-f' },
      h('div', { class: 'quick' }, ...QUICK.map(q => q ? h('button', { class: 'btn btn-small', title: q[3], onclick: () => quickAction(q[1]) }, icon(q[2]), h('span', { class: 'lbl', text: q[0] })) : h('span', { class: 'sep' })),
        t ? null : h('button', { class: 'btn btn-small btn-exp', id: 'twoThreadsBtn', onclick: () => quickAction(TWO_ON),
          title: 'Experiment: the tutor opens a second, closely related thread. When you answer in one, you are taken to the other, where its reply is usually ready, so you don’t wait while the tutor writes.' }, icon('threads'), h('span', { class: 'lbl', text: 'Two threads' }))),
      mode === 'ask'
        ? h('button', { class: 'btn btn-ask send-btn', onclick: sendIt, title: 'Send the side question  ⌘↵' }, 'Ask ', h('kbd', { text: '⌘↵' }))
        : h('button', { class: 'btn btn-primary send-btn', onclick: sendIt, title: pend ? 'Closes the question; the tutor grades it  ⌘↵' : 'Send  ⌘↵' }, pend ? 'Send answer ' : 'Send ', h('kbd', { text: '⌘↵' }))));
  composer.replaceChildren(grip(), h('div', { class: 'composer-inner' }, welcomeBack(), box));
  if (keepFocus && active) {
    const n = document.getElementById(active);
    n?.focus();
    if (n && caret && 'setSelectionRange' in n) { n.setSelectionRange(caret[0], caret[1]); n.scrollTop = caret[2]; }
  }
}
// the hidden input: two buttons in the corner, saying whether a question waits or a draft is kept
function cornerButtons(pend) {
  const hasDraft = m => !!store.get(draftKey(m), '').trim();
  const b = (m, label, ic, title, extra) => h('button', { class: `btn corner-btn corner-${m}`, title, onclick: () => openComposer(m) }, icon(ic), label, extra);
  return h('div', { class: 'corner-btns' },
    b('answer', pend ? 'Answer' : 'Reply', 'compose', (pend ? 'A question is waiting. ' : '') + 'Show the input  (a)',
      pend ? h('span', { class: 'corner-dot', title: 'A question is waiting' }) : hasDraft('answer') ? h('span', { class: 'corner-draft', text: 'draft' }) : null),
    b('ask', 'Ask', 'ask', 'Ask a side question  (q)', hasDraft('ask') ? h('span', { class: 'corner-draft', text: 'draft' }) : null));
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
function setComposerH(px, fit = true) {
  const max = Math.max(200, ($('.learn')?.clientHeight || innerHeight) - 140);
  if (!px) { composer.classList.remove('sized'); composer.style.height = ''; }
  else { composer.classList.add('sized'); composer.style.height = Math.min(max, Math.max(190, px)) + 'px'; }
  if (fit) refit();
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
async function doSend(kind, text, extra, box, key) {
  // Clear first: the server echoes the entry over SSE before send() resolves, and that
  // redraws the composer from the saved draft. Restore the draft only if sending fails.
  const draft = box.value, t = curTrack();
  store.set(key, ''); box.value = '';
  try { await send(kind, text, { ...extra, ...(t ? { track: t } : {}) }); }
  catch (e) {
    store.set(key, draft);
    const cur = document.getElementById(box.id); if (cur) cur.value = draft;
    alert('Could not send: ' + e.message);
    return false;
  }
  afterSend(t);
  return true;
}
// Two threads: the tutor now writes this thread's reply. If the other thread has something to
// read (a reply that came while the learner was here, or its open question), go there.
function afterSend(t) {
  if (!t || !app.d.tracks.open) return;
  const o = otherTrack(t), st = trackState(o);
  if (st.key === 'ready' || st.key === 'turn')
    switchTrack(o, { toReply: true, note: `Sent in ${t.toUpperCase()}: the tutor writes that reply while you read ${o.toUpperCase()}.` });
}
export async function quickAction(text) {
  const t = curTrack(), pend = curPending();
  try { await send('action', text, { ...(pend ? { replyTo: pend.id } : {}), ...(t ? { track: t } : {}) }); }
  catch (e) { alert('Could not send: ' + e.message); }
  if (app.view !== 'learn') location.hash = `#/${app.topic.slug}/learn`;
}
export function prefillAsk(text) {
  store.set(draftKey('ask'), text);
  openComposer('ask');
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
    onclick: () => { quote = { id: msg.dataset.id, text: txt }; selBtn.remove(); selBtn = null; sel.removeAllRanges(); prefillAsk(store.get(draftKey('ask'), '')); } }, icon('ask'), 'Ask about this');
  selBtn.style.left = Math.min(window.innerWidth - 150, r.left + r.width / 2 - 60) + 'px';
  selBtn.style.top = Math.max(8, r.top - 36) + 'px';
  document.body.append(selBtn);
}, 10));
