// App shell: data, live updates, routing, toolbar, skills sidebar, theme, resizing, keys.
// Inspector panels: panels.js · search: search.js · tutor status: tutor.js · views: learn/map/wiki/stats.
import { h, $, $$, store, flatSkills, levelOf, overall, meter, levelScale, fmtLevel, LEVEL_NAMES, relDays, derive, daysAgo, lvClass, lvChip } from './util.js';
import { configure } from './rich.js';
import { icon, hydrateIcons } from './icons.js';
import { openDock, renderDock, setDock, hoverCard, group } from './panels.js';
import { openSearch } from './search.js';
import { renderStatus, togglePopover } from './tutor.js';
import { toggleAway, onJobs } from './away.js';
import { renderNewTopic } from './newtopic.js';
import * as learn from './learn.js';
import * as mapView from './map.js';
import * as tree from './tree.js';
import * as wiki from './wiki.js';
import * as stats from './stats.js';
import * as tell from './tell.js';

export const app = {
  topics: [], topic: null, d: null, status: { phase: 'offline', queued: 0 },
  view: 'learn', args: [], dockStack: [], learner: null,
};
const VIEWS = { learn, map: mapView, tree, wiki, stats, tell };
const VIEW_KEYS = { '1': 'learn', '2': 'map', '3': 'tree', '4': 'wiki', '5': 'stats' };

// ---------------------------------------------------------------- data
export async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error((await r.json()).error || r.status); return r.json(); }
// A learner's message must never vanish. Each try has a deadline (a request can otherwise wait
// forever, e.g. for a free connection), network failures are retried for a while (the server
// restarts after code changes), and the client id lets the server recognise a retry of a message
// it already saved, so nothing is posted twice. A refusal from the server (4xx) is final.
export async function send(kind, text, extra = {}) {
  const cid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const j = await postJSON('/api/send', { topic: app.topic.slug, kind, text, ...extra, cid });
  ingest([j]);
  return j;
}
export async function postJSON(url, body, { tries = 5, timeout = 8000 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise(r => setTimeout(r, Math.min(4000, 600 * 2 ** (i - 1))));
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.final = true; throw e; }
      return j;
    } catch (e) {
      if (e.final) throw e;
      last = e;
    } finally { clearTimeout(timer); }
  }
  throw new Error(`the learn server didn't answer (${last?.name === 'AbortError' ? 'no reply in time' : last?.message || 'unreachable'}). Is bin/learn still running in its terminal?`);
}
async function loadTopic(slug, keepJournal = false) {
  const t = await getJSON('/api/topic/' + slug);
  if (keepJournal && app.topic?.slug === slug) t.journal = app.topic.journal;
  app.topic = t;
  app.d = derive(t);
  configure({ terms: t.glossary, media: { slug: t.slug, index: t.media || {} }, legend: Array.isArray(t.meta.legend) ? t.meta.legend : [] });
  document.title = `${t.meta.title} · learn`;
}
function ingest(entries) {
  const known = new Set(app.topic.journal.map(e => e.id));
  const fresh = entries.filter(e => !known.has(e.id));
  if (!fresh.length) return;
  app.topic.journal.push(...fresh);
  app.topic.journal.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  app.d = derive(app.topic);
  if (fresh.some(e => e.role === 'tutor' && e.kind === 'message') && document.hidden) { unread++; document.title = `(${unread}) ${app.topic.meta.title} · learn`; }
  VIEWS[app.view]?.onEntries?.(fresh);
  if (fresh.some(e => e.kind === 'level' || e.kind === 'grade')) renderLeft();
  if (fresh.some(e => e.kind === 'correction')) renderDock();   // a pinned or opened message that was just corrected
}
let unread = 0;
document.addEventListener('visibilitychange', () => { if (!document.hidden && app.topic) { unread = 0; document.title = `${app.topic.meta.title} · learn`; } });

// ---------------------------------------------------------------- live updates
// One event stream per browser, not one per tab. A browser keeps at most 6 connections to a host
// and each open stream holds one, so with enough tabs of the app open (every `bin/learn` used to
// open one) a send waited forever for a free connection: the message never left the page. So the
// tabs elect one (a Web Lock, released when that tab closes) to hold the stream and relay its
// events to the others (BroadcastChannel).
function connect() {
  const bus = typeof BroadcastChannel === 'function' && navigator.locks ? new BroadcastChannel('learn-events') : null;
  if (!bus) { openStream(onEvent); return; }
  bus.onmessage = ev => onEvent(ev.data);
  navigator.locks.request('learn-events', () => new Promise(() => openStream(m => { bus.postMessage(m); onEvent(m); })));
}
function openStream(deliver) {
  const es = new EventSource('/api/events');
  es.onmessage = ev => deliver(JSON.parse(ev.data));
  es.onopen = () => deliver({ type: 'up' });
  es.onerror = () => {
    deliver({ type: 'down' });
    // the browser retries by itself, except after some failures: then start over
    if (es.readyState === EventSource.CLOSED) setTimeout(() => openStream(deliver), 2000);
  };
}
async function onEvent(m) {
  if (m.type === 'status') { app.status = m; renderStatus(); VIEWS[app.view]?.onStatus?.(); }
  else if (m.type === 'entries' && m.topic === app.topic?.slug) ingest(m.entries);
  else if (m.type === 'topic' && m.topic === app.topic?.slug) { await loadTopic(m.topic, true); renderLeft(); VIEWS[app.view]?.onTopic?.(m.part); renderDock(); }
  else if (m.type === 'topics') { app.topics = await getJSON('/api/topics'); renderTopicSel(); }
  else if (m.type === 'learner') { app.learner = null; VIEWS[app.view]?.onLearner?.(); onJobs(); }
  else if (m.type === 'jobs') onJobs();
  else if (m.type === 'reload-ui') uiChanged(m.file);
  else if (m.type === 'down') { app.status = { offline: true }; renderStatus(); VIEWS[app.view]?.onStatus?.(); }
  // (re)connected: fetch what was missed while the stream was down
  else if (m.type === 'up' && app.topic) { const t = await getJSON('/api/topic/' + app.topic.slug).catch(() => null); if (t) ingest(t.journal); }
}

// ---------------------------------------------------------------- routing
export function go(view, ...args) {
  const hash = `#/${app.topic.slug}/${view}${args.length ? '/' + args.map(encodeURIComponent).join('/') : ''}`;
  if (location.hash !== hash) location.hash = hash; else route();
}
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  // #/new?goal=…: the new-topic page (also the first screen when there are no topics)
  if (/^new(\?|$)/.test(hash) || !app.topics.length) {
    app.view = 'new';
    $$('.views button').forEach(b => b.classList.remove('on'));
    document.body.dataset.view = 'new';
    document.body.classList.toggle('no-topics', !app.topics.length);
    renderTopicSel();
    renderNewTopic($('#center'), new URLSearchParams(hash.split('?')[1] || '').get('goal') || '');
    return;
  }
  document.body.classList.remove('no-topics');
  const parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
  let [slug, view = 'learn', ...args] = parts;
  if (!slug || !app.topics.some(t => t.slug === slug)) slug = store.get('topic', null);
  if (!app.topics.some(t => t.slug === slug)) slug = [...app.topics].sort((a, b) => (b.last || '').localeCompare(a.last || ''))[0]?.slug;   // the latest activity
  if (!VIEWS[view]) view = 'learn';
  const switched = app.topic?.slug !== slug;
  if (switched) { await loadTopic(slug); store.set('topic', slug); renderLeft(); renderTopicSel(); app.dockStack = []; renderDock(); }
  const prev = app.view;
  app.view = view; app.args = args;
  $$('.views button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#feedbackBtn')?.classList.toggle('on', view === 'tell');
  document.body.dataset.view = view;
  if (switched || prev !== view || !$('#center').firstChild || VIEWS[view].routeAlways) VIEWS[view].render($('#center'), app, args);
  else VIEWS[view].update?.(args);
  if (prev === 'new') renderTopicSel();
}
export async function refreshTopics() { app.topics = await getJSON('/api/topics'); renderTopicSel(); }
export async function learner() { if (!app.learner) app.learner = await getJSON('/api/learner'); return app.learner; }
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- toolbar
function renderTopicSel() {
  $('#topicSel').replaceChildren(...app.topics.map(t => h('option', { value: t.slug, text: t.title, selected: t.slug === app.topic?.slug && app.view !== 'new' })),
    h('option', { value: '__new', text: '+ New topic…', selected: app.view === 'new' }));
}
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const b = $('#themeBtn');
  b.replaceChildren(icon(t === 'auto' ? 'auto' : t === 'light' ? 'sun' : 'moon'));
  b.title = `Theme: ${t === 'auto' ? 'follows the system' : t} (click to switch)`;
}

// ---------------------------------------------------------------- left: skills sidebar
export function renderLeft() {
  const m = app.topic.meta, el = $('#left');
  const collapsed = store.get('collapsed:' + app.topic.slug, {});
  const ov = overall(m);
  const sel = app.dockStack[app.dockStack.length - 1];
  const tree = h('div', { class: 'tree' });
  for (const s of flatSkills(m.skills)) {
    if (s.parent && collapsed[s.parent]) continue;
    const lv = levelOf(s.node), kids = s.children?.length;
    tree.append(h('div', {
      class: `trow ${s.depth ? 'child' : 'parent'}` + (m.focus === s.id ? ' focus' : '') + (lv === 0 ? ' fog' : '') + (sel?.type === 'skill' && sel.id === s.id ? ' sel' : ''),
      title: `${s.id} ${s.name} · level ${fmtLevel(lv)}/5${m.focus === s.id ? ' · current focus' : ''}`,
      onclick: () => openDock('skill', s.id),
    },
      // Rows give their width to the name (the learner reads this at high zoom, where the old fold
      // button + number + inline bar left the text a few letters): a sub-skill is indented by a few
      // pixels and has no empty fold slot; a chapter's progress is a thin bar under its title.
      s.depth ? null : kids ? h('button', { class: 'tw' + (collapsed[s.id] ? '' : ' open'), title: collapsed[s.id] ? 'Expand' : 'Collapse',
        onclick: e => { e.stopPropagation(); collapsed[s.id] = !collapsed[s.id]; store.set('collapsed:' + app.topic.slug, collapsed); renderLeft(); } }, icon('chev')) : h('span'),
      h('span', { class: 'sid', text: s.id }),
      h('span', { class: 'name', text: s.name }),
      h('span', { class: 'right' }, m.focus === s.id ? h('span', { class: 'focus-tag', text: 'now' }) : null, lvChip(lv)),
      kids && !s.depth ? meter(lv, null, 'under') : null));
    if (s.depth > 1) tree.lastChild.style.paddingLeft = 18 + (s.depth - 1) * 10 + 'px';
  }
  const lastCheck = lastChecks();
  const due = flatSkills(m.skills).filter(s => !s.children?.length && (s.level || 0) >= 2)
    .map(s => ({ s, last: lastCheck.get(s.id) || null })).map(x => ({ ...x, age: x.last ? daysAgo(x.last) : 999 }))
    .filter(x => x.age >= 2).sort((a, b) => b.age - a.age || a.s.level - b.s.level);
  // the tutor's own review notes (notes.json) come first: they say exactly what to re-test
  const today = new Date().toISOString().slice(0, 10);
  const noteDue = (app.topic.notes?.items || []).filter(n => n.kind === 'review' && n.status === 'open' && (!n.due || n.due <= today));
  const noteSkills = new Set(noteDue.map(n => n.skill));
  due.splice(0, due.length, ...noteDue.map(n => ({ note: n, s: (n.skill && flatSkills(m.skills).find(x => x.id === n.skill)) || { id: n.skill || '', name: '', level: 0 } })),
    ...due.filter(x => !noteSkills.has(x.s.id)));
  due.length = Math.min(due.length, 8);
  const anyCollapsed = Object.values(collapsed).some(Boolean);
  el.replaceChildren(
    group('Progress', h('div', { class: 'prog ' + lvClass(ov) },
      h('div', { class: 'prog-title', text: m.title, title: m.title }),
      h('div', { class: 'prog-row' }, h('span', { class: 'prog-big' }, fmtLevel(Math.round(ov * 10) / 10), h('small', { text: ' / 5' })), h('span', { class: 'prog-name', text: LEVEL_NAMES[Math.round(ov)] })),
      meter(ov, m.target, 'big'),
      h('div', { class: 'prog-sub' }, h('span', { text: `Target ${m.target} · ${LEVEL_NAMES[m.target]}` }), h('span', { text: `${Math.round(ov / 5 * 100)}%` })))),
    group(['Skills', h('span', { class: 'count', text: String(flatSkills(m.skills).filter(s => !s.children?.length).length) }), h('span', { class: 'spacer' }),
      h('button', { class: 'linkish small', text: anyCollapsed ? 'Expand all' : 'Collapse all', onclick: () => {
        const next = {}; if (!anyCollapsed) for (const s of m.skills) if (s.children?.length) next[s.id] = true;
        store.set('collapsed:' + app.topic.slug, next); renderLeft();
      } })],
      m.skills?.length ? tree : h('div', { class: 'empty-row', text: 'No skills yet: the tutor maps the topic after your first answers.' }), h('div', { class: 'legend-row' }, levelScale())),
    group(['Due for review', h('span', { class: 'count', text: due.length ? String(due.length) : '' })],
      due.length ? h('div', { class: 'review-list' }, ...due.map(x => h('div', { class: 'rv' + (x.note ? ' rv-note' : '') },
        lvChip(x.s.level),
        h('span', { class: 'rv-name', text: x.note ? x.note.text : `${x.s.id} ${x.s.name}`, title: x.note ? x.note.text : x.s.name, onclick: () => x.s.id && openDock('skill', x.s.id) }),
        h('button', { class: 'btn btn-small', title: 'Ask the tutor for a review question on this', onclick: () => learn.quickAction(x.note
          ? `review ${x.s.id}: re-test me on note ${x.note.id} ("${x.note.text}")` : `review ${x.s.id} (${x.s.name}): give me a spaced-review question`) }, icon('quiz'), 'Quiz me'),
        h('span', { class: 'rv-age', text: x.note ? `tutor’s note · ${x.s.id} ${x.s.name}` : x.last ? `checked ${relDays(x.last)}` : 'not checked in the web UI yet' }))))
        : h('div', { class: 'empty-row', text: 'Nothing due. Skills at level 2+ appear here after a couple of days without a check.' })),
  );
}
export function lastChecks() {
  const out = new Map();
  for (const e of app.topic.journal) if (e.kind === 'grade' && e.skill) out.set(String(e.skill), e.ts);
  return out;
}

// ---------------------------------------------------------------- resizable panes
function initResizers() {
  const root = document.documentElement;
  const w = store.get('widths', {});
  if (w.left) root.style.setProperty('--left-w', w.left + 'px');
  if (w.dock) root.style.setProperty('--dock-w', w.dock + 'px');
  for (const rz of $$('.rz')) {
    rz.addEventListener('mousedown', e => {
      e.preventDefault();
      const which = rz.dataset.rz;
      rz.classList.add('drag'); document.body.classList.add('resizing');
      const move = ev => {
        const v = which === 'left' ? Math.max(220, Math.min(560, ev.clientX)) : Math.max(280, Math.min(760, window.innerWidth - ev.clientX));
        root.style.setProperty(which === 'left' ? '--left-w' : '--dock-w', v + 'px');
        w[which] = v;
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); rz.classList.remove('drag'); document.body.classList.remove('resizing'); store.set('widths', w); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    rz.addEventListener('dblclick', () => { root.style.removeProperty(rz.dataset.rz === 'left' ? '--left-w' : '--dock-w'); delete w[rz.dataset.rz]; store.set('widths', w); });
  }
}
function setLeft(open) { document.body.classList.toggle('left-closed', !open); store.set('leftOpen', open); $('#leftToggle').classList.toggle('on', open); }

// ---------------------------------------------------------------- boot
document.addEventListener('keydown', e => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openSearch(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!app.topic) return;
  if (VIEW_KEYS[e.key]) go(VIEW_KEYS[e.key]);
  else if (e.key === 'a') { learn.openComposer('answer'); e.preventDefault(); }
  else if (e.key === 'q') { learn.openComposer('ask'); e.preventDefault(); }
  else if (e.key === 't' && app.d?.tracks?.open && app.view === 'learn') learn.switchTrack(store.get('track:' + app.topic.slug, 'a') === 'b' ? 'a' : 'b', { toReply: true });
  else if (e.key === ']' || e.key === 'g') { setDock(!document.body.classList.contains('dock-open')); renderDock(); }
  else if (e.key === '[') setLeft(document.body.classList.contains('left-closed'));
});

async function boot() {
  hydrateIcons();
  $('#topicSel').addEventListener('change', e => { location.hash = e.target.value === '__new' ? '#/new' : `#/${e.target.value}/${app.view === 'new' ? 'learn' : app.view}`; });
  $$('.views button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  $('#searchBtn').addEventListener('click', openSearch);
  $('#status').addEventListener('click', togglePopover);
  // a page, not a popover: your instructions to the tutors, and changes to the app (tell.js); again = back
  let beforeTell = null;
  $('#feedbackBtn')?.addEventListener('click', () => {
    if (app.view === 'tell') { if (beforeTell && !/\/tell(\/|$)/.test(beforeTell)) location.hash = beforeTell; else go('learn'); return; }
    beforeTell = location.hash;
    go('tell', store.get('tellTab', 'instructions'));
  });
  $('#awayBtn')?.addEventListener('click', toggleAway);
  $('#reloadBtn')?.addEventListener('click', reloadKeepingPlace);
  $('#dockBtn').addEventListener('click', () => { setDock(!document.body.classList.contains('dock-open')); renderDock(); });
  $('#leftToggle').addEventListener('click', () => setLeft(document.body.classList.contains('left-closed')));
  let theme = store.get('theme', 'auto');
  applyTheme(theme);
  $('#themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; store.set('theme', theme); applyTheme(theme); });
  configure({
    hoverCard,
    onRef: (type, id) => {
      if (type === 'map') { go('map', id); return; }
      if (type === 'wiki') { go('wiki', ...String(id).split('/')); return; }
      openDock(type, id);
    },
  });
  setDock(store.get('dockOpen', true));
  setLeft(store.get('leftOpen', true));
  initResizers();
  app.topics = await getJSON('/api/topics');
  app.status = await getJSON('/api/status');
  renderStatus();
  if (!/[?&]static\b/.test(location.search)) connect();   // ?static: no live updates (headless screenshots)
  await route();
  renderDock();
  restorePlace();
  onJobs();
}

// ---------------------------------------------------------------- UI code changed
// Reload into the new code only when it can't disturb the learner: the tab is hidden, or nothing
// was touched for a while. Otherwise show a Reload button and keep checking. Drafts are in
// localStorage already; the scroll position survives the reload.
let lastInput = Date.now(), reloadPending = false;
for (const ev of ['keydown', 'mousedown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
const IDLE_MS = 90e3;
function canReloadNow() {
  if (document.querySelector('.popover, .hovercard')) return false;
  return document.hidden || Date.now() - lastInput > IDLE_MS;
}
function uiChanged() {
  reloadPending = true;
  if (canReloadNow()) return reloadKeepingPlace();
  const b = $('#reloadBtn');
  if (b) b.hidden = false;
}
setInterval(() => { if (reloadPending && canReloadNow()) reloadKeepingPlace(); }, 5000);
document.addEventListener('visibilitychange', () => { if (reloadPending && document.hidden) reloadKeepingPlace(); });
export function reloadKeepingPlace() {
  const sc = $('#threadScroll') || $('.view-body');
  try { sessionStorage.setItem('learn:place', JSON.stringify({ hash: location.hash, top: sc ? sc.scrollTop : 0, bottom: sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80 : true })); } catch {}
  location.reload();
}
function restorePlace() {
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem('learn:place')); sessionStorage.removeItem('learn:place'); } catch {}
  if (!p || p.hash !== location.hash || p.bottom) return;
  const apply = () => { const sc = $('#threadScroll') || $('.view-body'); if (sc) sc.scrollTop = p.top; };
  requestAnimationFrame(() => { apply(); setTimeout(apply, 150); });
}
boot().catch(e => { document.body.append(h('pre', { class: 'error', text: e.stack || e.message })); });
