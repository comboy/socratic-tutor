// Inspector panel (right dock) and the panels it shows: glossary, pinned messages, term, skill,
// message, map node. The same panels render full-width in the wiki. Also: hover-card content.
import { h, $, store, levelOf, skillById, descendants, lvChip, meter, fmtLevel, LEVEL_NAMES, fmtDate, shortId } from './util.js';
import { rich } from './rich.js';
import { plain, md } from './md.js';
import { icon } from './icons.js';
import { app, go, renderLeft } from './app.js';
import * as learn from './learn.js';
import * as mapView from './map.js';

// ---------------------------------------------------------------- inspector (right panel)
export function openDock(type, id, { replace = false } = {}) {
  if (replace) app.dockStack.pop();
  const top = app.dockStack[app.dockStack.length - 1];
  if (!top || top.type !== type || top.id !== id) app.dockStack.push({ type, id });
  setDock(true);
  renderDock();
  renderLeft();
}
export function setDock(open) { document.body.classList.toggle('dock-open', open); store.set('dockOpen', open); $('#dockBtn').classList.toggle('on', open); }
function backToTab(tab) { store.set('dockTab', tab); app.dockStack = []; renderDock(); renderLeft(); }
export function renderDock() {
  const el = $('#dock');
  if (!app.topic) return;
  const top = app.dockStack[app.dockStack.length - 1];
  const tab = store.get('dockTab', 'glossary');
  const pins = store.get('pins:' + app.topic.slug, []);
  const head = h('div', { class: 'dock-head' },
    h('div', { class: 'seg' },
      h('button', { class: !top && tab === 'glossary' ? 'on' : '', onclick: () => backToTab('glossary') }, icon('book'), 'Glossary'),
      h('button', { class: !top && tab === 'pinned' ? 'on' : '', onclick: () => backToTab('pinned') }, icon('pin'), `Pinned${pins.length ? ' · ' + pins.length : ''}`)),
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Close panel  ]', onclick: () => setDock(false) }, icon('close')));
  const body = h('div', { class: 'dock-body' });
  if (top) {
    const label = { term: 'Glossary term', msg: 'Message', skill: 'Skill', node: 'Concept map node', report: 'Report' }[top.type] || '';
    body.append(h('div', { class: 'crumb' },
      h('button', { class: 'btn btn-small', title: 'Back', onclick: () => { app.dockStack.pop(); renderDock(); renderLeft(); } }, icon('back'), app.dockStack.length > 1 ? 'Back' : (tab === 'pinned' ? 'Pinned' : 'Glossary')),
      h('b', { text: label })));
    try { (DOCK[top.type] || (() => body.append('?')))(body, top.id); }
    catch (e) { body.append(h('div', { class: 'error', text: e.message })); }
  } else if (tab === 'pinned') dockPinned(body, pins);
  else dockGlossary(body);
  el.replaceChildren(head, body);
  el.scrollTop = 0;
}

let dockFilter = '';
function dockGlossary(body) {
  const q = h('input', { class: 'input', type: 'search', placeholder: `Filter ${app.topic.glossary.length} terms…`, value: dockFilter });
  const list = h('div', { class: 'gl-list' });
  const draw = () => {
    dockFilter = q.value;
    const f = q.value.trim().toLowerCase();
    const items = sortedGlossary().filter(({ t }) => !f || termText(t).includes(f));
    list.replaceChildren();
    let section = null;
    for (const { t, section: S } of items) {
      if (S !== section && !f) { section = S; list.append(h('div', { class: 'gl-letter', text: S })); }
      const sk = t.skill ? skillById(app.topic.meta, t.skill) : null;
      const lv = sk ? levelOf(sk.node) : 0;
      list.append(h('button', { class: 'gl-item', onclick: () => openDock('term', t.term) },
        lvChip(lv, sk ? `${sk.id} ${sk.name}: level ${fmtLevel(lv)}` : 'no skill'),
        h('span', { class: 'gl-term' }, t.term, t.full ? h('span', { class: 'gl-full', text: plain(t.full, 80) }) : null),
        h('span', { class: 'gl-short', text: plain(t.short, 160) })));
    }
    if (!items.length) list.append(h('div', { class: 'empty-row', text: 'No matching terms.' }));
  };
  q.addEventListener('input', draw);
  body.append(h('div', { class: 'dock-search' }, q, sortToggle(draw)), list);
  draw();
}

// ---------------------------------------------------------------- glossary order
// 'alpha' (A–Z, sectioned by initial) or 'new' (newest first, sectioned by the day the term was
// introduced). Shared by the dock and the wiki glossary; remembered in localStorage.
const alpha = (a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' });
export const termText = t => [t.term, ...t.aliases, plain(t.full || '', 400), t.short].join(' ').toLowerCase();
// When a term was introduced: the first tutor message mentioning it (or an alias), or the
// earliest of its refs if that is earlier. No metadata needed. Returns { id, day, ts } or null.
export function introOf(t) {
  let best = occurrences(t)[0]?.e || null;
  for (const id of t.refs) {
    const e = app.d.byId.get(id) || (/^\d{4}-\d{2}-\d{2}\.\d+$/.test(id) ? { id, ts: id.slice(0, 10) } : null);
    if (e && (!best || e.ts < best.ts)) best = e;
  }
  return best && { id: best.id, day: String(best.id).split('.')[0], ts: best.ts };
}
export function sortedGlossary(mode = store.get('glossarySort', 'alpha')) {
  if (mode !== 'new') return [...app.topic.glossary].sort(alpha).map(t => ({ t, section: t.term[0].toUpperCase() }));
  return app.topic.glossary.map(t => ({ t, intro: introOf(t) }))
    .sort((a, b) => (!a.intro || !b.intro ? !a.intro - !b.intro : b.intro.ts.localeCompare(a.intro.ts)) || alpha(a.t, b.t))
    .map(x => ({ ...x, section: x.intro ? fmtDate(x.intro.day, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not in a message yet' }));
}
export function sortToggle(redraw) {
  const mode = store.get('glossarySort', 'alpha');
  const seg = h('div', { class: 'seg seg-small gl-sort', title: 'Sort the glossary' });
  for (const [id, label, title] of [['alpha', 'A–Z', 'Alphabetical'], ['new', 'Newest', 'Newest first: by the first message that used the term']]) {
    seg.append(h('button', { class: mode === id ? 'on' : '', 'data-sort': id, title, text: label, onclick: () => {
      store.set('glossarySort', id);
      for (const b of seg.children) b.classList.toggle('on', b.dataset.sort === id);
      redraw();
    } }));
  }
  return seg;
}
function dockPinned(body, pins) {
  const pinned = pins.map(id => app.d.byId.get(id)).filter(Boolean);
  if (!pinned.length) { body.append(h('div', { class: 'empty-row', text: 'Pin a tutor message (pin button in its header) to keep it here while you answer, e.g. the one with the matrix you need.' })); return; }
  for (const e of pinned) body.append(h('div', { class: 'pin-card' }, learn.messageNode(e, { compact: true, pinnable: true })));
}

export function togglePin(id) {
  const k = 'pins:' + app.topic.slug;
  const pins = store.get(k, []);
  const i = pins.indexOf(id);
  if (i >= 0) pins.splice(i, 1); else pins.unshift(id);
  store.set(k, pins);
  return i < 0;
}
export function isPinned(id) { return store.get('pins:' + app.topic.slug, []).includes(id); }

export function termEntry(name) {
  const n = String(name).toLowerCase();
  return app.topic.glossary.find(t => t.term.toLowerCase() === n || t.aliases.some(a => a.toLowerCase() === n)) || null;
}
const occCache = new Map();
export function occurrences(t) {
  const key = app.topic.slug + ':' + t.term + ':' + app.topic.journal.length;
  if (occCache.has(key)) return occCache.get(key);
  const forms = [t.term, ...t.aliases].filter(f => f.length > 1);
  const re = new RegExp(`(?<![\\w-])(${forms.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:e?s)?(?![\\w])`, /[A-Z]/.test(t.term) ? 'g' : 'gi');
  const out = [];
  for (const e of app.topic.journal) {
    if (e.role !== 'tutor' || e.kind !== 'message' || !e.text) continue;
    const hits = e.text.match(re);
    if (hits) out.push({ e, n: hits.length });
  }
  occCache.set(key, out);
  return out;
}
export function snippet(text, needle, n = 180) {
  const p = plain(text, 100000);
  const i = needle ? p.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return p.slice(0, n) + (p.length > n ? '…' : '');
  const s = Math.max(0, i - n / 3);
  return (s > 0 ? '…' : '') + p.slice(s, s + n) + (s + n < p.length ? '…' : '');
}
export function group(title, ...kids) { return h('div', { class: 'group' }, h('div', { class: 'group-h' }, ...[].concat(title)), ...kids); }

export function termPanel(body, name, { full = false } = {}) {
  const t = termEntry(name);
  if (!t) { body.append(h('div', { class: 'empty-row', text: `No glossary entry for “${name}”.` })); return; }
  const sk = t.skill ? skillById(app.topic.meta, t.skill) : null;
  const lv = sk ? levelOf(sk.node) : 0;
  body.append(h('div', { class: 'title-block' },
    h('h2', {}, t.term, t.full ? h('span', { class: 'term-full', html: '— ' + md(t.full, { inline: true }) }) : null),
    h('div', { class: 'title-meta' },
      sk ? h('button', { class: 'chip chip-btn', onclick: () => openDock('skill', sk.id) }, lvChip(lv), `${sk.id} ${sk.name}`) : null,
      t.size ? h('span', { class: 'chip', title: 'size in Llama-2-7B', text: t.size }) : null,
      t.aliases.length ? h('span', { text: 'also: ' + t.aliases.join(', ') }) : null)));
  body.append(group('Definition', h('div', { class: 'group-b' }, rich(t.short, 'def hl-scope'), t.body ? rich(t.body, 'hl-scope') : null)));
  if (t.parts.length) body.append(group(['Built from', h('span', { class: 'count', text: String(t.parts.length) })], h('div', { class: 'parts' }, ...t.parts.map(partRow))));
  if (t.see.length) body.append(group('Related terms', h('div', { class: 'group-b chips' }, ...t.see.map(s => h('button', { class: 'chip chip-btn' + (termEntry(s) ? '' : ' missing'), text: s, onclick: () => openDock('term', s) })))));
  const occ = occurrences(t);
  const refs = t.refs.map(id => app.d.byId.get(id)).filter(Boolean);
  const list = [...refs.map(e => ({ e, best: true })), ...occ.filter(o => !t.refs.includes(o.e.id)).map(o => ({ e: o.e }))];
  const firstOther = list.find(x => !x.best);
  body.append(group(['Explained in', h('span', { class: 'count', text: String(list.length) })],
    h('div', { class: 'occ' }, ...list.slice(0, full ? 999 : 12).map(o => msgLine(o.e, t.term, o.best ? 'best' : o === firstOther ? 'first' : null)),
      !full && list.length > 12 ? h('div', { class: 'group-b' }, h('button', { class: 'btn btn-small', text: `All ${list.length} in the wiki`, onclick: () => go('wiki', 'term', t.term) })) : null,
      !list.length ? h('div', { class: 'empty-row', text: 'Not discussed in any message yet.' }) : null)));
  body.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => learn.prefillAsk(`Can you re-explain “${t.term}”? I forgot how it works.`) }, icon('ask'), 'Explain this again'),
    full ? null : h('button', { class: 'btn', onclick: () => go('wiki', 'term', t.term) }, icon('wiki'), 'Open in wiki')));
}
// a sub-term from `parts:`: level chip, name, its short definition
function partRow(name) {
  const p = termEntry(name);
  if (!p) return h('div', { class: 'part missing', title: 'No glossary entry yet' }, lvChip(0), h('span', { class: 'gl-term', text: name }), h('span', { class: 'gl-short', text: 'not in the glossary yet' }));
  const sk = p.skill ? skillById(app.topic.meta, p.skill) : null;
  return h('button', { class: 'part', onclick: () => openDock('term', p.term) }, lvChip(sk ? levelOf(sk.node) : 0),
    h('span', { class: 'gl-term' }, p.term, p.full ? h('span', { class: 'gl-full', text: plain(p.full, 80) }) : null),
    h('span', { class: 'gl-short', text: plain(p.short, 200) }));
}
export function msgLine(e, needle, badge) {
  return h('button', { class: 'msgline', onclick: () => openDock('msg', e.id) },
    h('span', { class: 'msgline-id', text: shortId(e.id) }),
    badge ? h('span', { class: 'badge badge-' + badge, text: badge === 'best' ? 'best explanation' : 'first' }) : h('span'),
    h('span', { class: 'msgline-snip', text: snippet(e.text, needle) }));
}

export function skillPanel(body, id, { full = false } = {}) {
  const m = app.topic.meta, s = skillById(m, id);
  if (!s) { body.append(h('div', { class: 'empty-row', text: `No skill ${id}` })); return; }
  const lv = levelOf(s.node);
  body.append(h('div', { class: 'title-block' },
    h('h2', {}, h('span', { class: 'sid', text: s.id }), s.name),
    h('div', { class: 'title-meta' }, lvChip(lv), meter(lv, m.target), h('span', { text: `${fmtLevel(lv)} / 5 · ${LEVEL_NAMES[Math.round(lv)]}` }),
      m.focus === s.id ? h('span', { class: 'focus-tag', text: 'current focus' }) : null)));
  body.append(h('div', { class: 'actions' },
    h('button', { class: 'btn btn-primary', onclick: () => learn.quickAction(`review ${s.id} (${s.name}): give me a review question`) }, icon('quiz'), 'Quiz me'),
    h('button', { class: 'btn', onclick: () => learn.quickAction(`recap ${s.id} (${s.name}): short recap of what I covered, linking the earlier explanations`) }, icon('notes'), 'Recap for me'),
    full ? null : h('button', { class: 'btn', onclick: () => go('wiki', 'skill', s.id) }, icon('wiki'), 'Wiki page')));
  if (s.children?.length) body.append(group(['Subskills', h('span', { class: 'count', text: String(s.children.length) })], h('div', { class: 'kids' },
    ...s.children.map(c => h('button', { class: 'kid' + (levelOf(c) === 0 ? ' fog' : ''), title: c.name, onclick: () => openDock('skill', c.id) }, lvChip(levelOf(c)), h('span', { class: 'sid', text: c.id }), h('span', { text: c.name }))))));
  const deps = dependencies(m, s);
  if (deps.needs.length || deps.unlocks.length) body.append(group('Builds on · leads to', h('div', { class: 'group-b deps' },
    deps.needs.length ? h('div', { class: 'deps-row' }, h('span', { class: 'deps-label', text: 'Needs' }), ...deps.needs.map(depChip)) : null,
    deps.unlocks.length ? h('div', { class: 'deps-row' }, h('span', { class: 'deps-label', text: 'Unlocks' }), ...deps.unlocks.map(depChip)) : null)));
  const ids0 = descendants(m, id);
  const notes = (app.topic.notes?.items || []).filter(n => n.skill && ids0.has(n.skill));
  const openN = notes.filter(n => n.status === 'open');
  if (openN.length) body.append(group(['Tutor’s notes', h('span', { class: 'count', text: String(openN.length) })], h('div', { class: 'notes-list' }, ...openN.map(noteRow))));
  if (s.summary) body.append(group('What you covered', h('div', { class: 'group-b' }, rich(s.summary, 'hl-scope'))));
  if (s.notes) body.append(group('Notes', h('div', { class: 'group-b' }, rich(s.notes))));
  if (s.misconceptions?.length) body.append(group('Misconceptions seen', h('div', { class: 'group-b' }, h('ul', { class: 'plain-list' }, ...s.misconceptions.map(x => h('li', { html: md(x, { inline: true }) }))))));
  if (s.unknown?.length) body.append(group('Not covered yet', h('div', { class: 'group-b' }, h('ul', { class: 'plain-list fog-list' }, ...s.unknown.map(x => h('li', { html: md(x, { inline: true }) }))))));
  const ids = descendants(m, id), J = app.topic.journal;
  const hist = J.filter(e => (e.kind === 'level' || e.kind === 'grade') && ids.has(String(e.skill)));
  if (hist.length) body.append(group('Checks & level changes', h('div', { class: 'hist' }, ...hist.slice().reverse().map(e => h('div', { class: 'hist-row' },
    h('span', { class: 'muted small', text: fmtDate(e.ts) }),
    e.kind === 'level' ? h('span', { class: 'chip', text: `${e.skill}: ${e.from} → ${e.to}` }) : h('button', { class: `badge verdict-${e.verdict}`, text: e.verdict, onclick: () => openDock('msg', e.target) }),
    h('span', { class: 'small', text: e.reason || e.note || '' }))))));
  const msgs = J.filter(e => e.role === 'tutor' && e.kind === 'message' && e._skills.some(x => ids.has(x)));
  body.append(group(['Explanations', h('span', { class: 'count', text: String(msgs.length) })], h('div', { class: 'occ' }, ...msgs.slice(0, full ? 999 : 15).map(e => msgLine(e, null)),
    !msgs.length ? h('div', { class: 'empty-row', text: 'No messages tagged with this skill yet.' }) : null)));
  const pages = (app.topic.pages || []).filter(pg => [...pg.text.matchAll(/\]\(skill:([^)\s]+)\)/g)].some(x => ids.has(x[1])));
  if (pages.length) body.append(group(['Wiki pages', h('span', { class: 'count', text: String(pages.length) })], h('div', { class: 'group-b chips' }, ...pages.map(pg => h('button', { class: 'chip chip-btn', text: pg.title, onclick: () => go('wiki', 'page', pg.name) })))));
  const terms = app.topic.glossary.filter(t => (t.skills || []).some(x => ids.has(String(x))));
  if (terms.length) body.append(group(['Terms', h('span', { class: 'count', text: String(terms.length) })], h('div', { class: 'group-b chips' }, ...terms.map(t => h('button', { class: 'chip chip-btn', text: t.term, onclick: () => openDock('term', t.term) })))));
}

// ---------------------------------------------------------------- skill dependencies (topic.json `needs`)
export function dependencies(meta, s) {
  const found = new Map((meta.foundations || []).map(f => [f.id, f]));
  const needs = (s.needs || []).map(id => found.has(id) ? { id, foundation: found.get(id) } : { id, skill: skillById(meta, id) });
  const unlocks = [];
  (function walk(list) { for (const x of list || []) { if ((x.needs || []).includes(s.id)) unlocks.push({ id: x.id, skill: skillById(meta, x.id) }); walk(x.children); } })(meta.skills);
  return { needs, unlocks };
}
function depChip(d) {
  if (d.foundation) return h('button', { class: 'chip chip-btn chip-found', title: `Foundation (outside this topic): ${d.foundation.name}${d.foundation.why ? ' · ' + d.foundation.why : ''}`, onclick: () => go('tree', d.id) },
    lvChip(d.foundation.level ?? 0), d.foundation.name);
  if (!d.skill) return h('span', { class: 'chip missing', text: d.id });
  const lv = levelOf(d.skill.node);
  return h('button', { class: 'chip chip-btn' + (lv < 2 ? ' chip-weak' : ''), title: lv < 2 ? 'Below level 2: worth firming up first' : '', onclick: () => openDock('skill', d.id) }, lvChip(lv), `${d.id} ${d.skill.name}`);
}

// ---------------------------------------------------------------- tutor's notes (notes.json)
export const NOTE_KIND = { review: ['Re-test', 'quiz'], hole: ['Possible gap', 'hole'], parked: ['Parked question', 'ask'], misconception: ['Misconception', 'lost'] };
export function noteRow(n) {
  const [label, ic] = NOTE_KIND[n.kind] || [n.kind, 'dot'];
  const due = n.due && n.status === 'open' && n.due <= new Date().toISOString().slice(0, 10);
  return h('div', { class: `note-row note-${n.kind}` + (n.status === 'done' ? ' done' : '') },
    h('span', { class: 'note-kind', title: label }, icon(ic), label),
    h('div', { class: 'note-text' }, h('span', { html: md(n.text, { inline: true }) }),
      n.outcome ? h('span', { class: 'muted small', text: ' → ' + n.outcome }) : null),
    h('span', { class: 'note-meta' },
      n.skill ? h('button', { class: 'chip chip-btn', text: n.skill, title: skillById(app.topic.meta, n.skill)?.name || '', onclick: () => openDock('skill', n.skill) }) : null,
      n.ref ? h('button', { class: 'icon-btn', title: 'The message it came from', onclick: () => openDock('msg', n.ref) }, icon('link')) : null,
      n.due && n.status === 'open' ? h('span', { class: 'small ' + (due ? 'note-due' : 'muted'), text: due ? 'due' : 'due ' + fmtDate(n.due) }) : null,
      n.status === 'done' ? h('span', { class: 'muted small', text: n.closed ? fmtDate(n.closed) : 'done' }) : null));
}

const DOCK = {
  report: (b, file) => {
    const box = h('div', { class: 'group-b' }, h('div', { class: 'muted', text: 'Loading…' }));
    b.append(h('div', { class: 'report' }, box));
    fetch('/api/report/' + encodeURIComponent(file)).then(r => r.json()).then(j => {
      box.replaceChildren(j.text != null ? rich(j.text, 'hl-scope report-md') : h('div', { class: 'error', text: j.error || 'not found' }));
    }).catch(e => box.replaceChildren(h('div', { class: 'error', text: e.message })));
  },
  term: (b, id) => termPanel(b, id),
  skill: (b, id) => skillPanel(b, id),
  node: (b, id) => mapView.nodePanel(b, id, app),
  msg: (b, id) => {
    const e = app.d.byId.get(id);
    if (!e) { b.append(h('div', { class: 'empty-row', text: `Message ${id} not found` })); return; }
    b.append(h('div', { class: 'actions' },
      h('button', { class: 'btn btn-small', onclick: () => learn.reveal(e.id) }, icon('learn'), 'Show in conversation'),
      h('button', { class: 'btn btn-small', onclick: () => { togglePin(id); renderDock(); } }, icon('pin'), isPinned(id) ? 'Unpin' : 'Pin')));
    b.append(learn.messageNode(e, { compact: true }));
  },
};

// ---------------------------------------------------------------- hover cards
export function hoverCard(t) {
  if (t.classList.contains('term') || t.dataset.ref === 'term') {
    const e = termEntry(t.dataset.term || t.dataset.id);
    if (!e) return null;
    const occ = occurrences(e);
    const sk = e.skill ? skillById(app.topic.meta, e.skill) : null;
    return h('div', {},
      h('div', { class: 'hc-head' }, sk ? lvChip(levelOf(sk.node)) : null, h('b', { text: e.term }),
        e.full ? h('span', { class: 'hc-full', html: '— ' + md(e.full, { inline: true }) }) : null,
        h('span', { class: 'spacer' }), e.size ? h('span', { class: 'chip', text: e.size }) : null),
      rich(e.short, 'hc-body hl-scope', { terms: false }),
      e.parts.length ? h('div', { class: 'hc-parts' }, h('span', { class: 'hc-parts-label', text: 'Built from' }),
        ...e.parts.map(p => termEntry(p) ? h('button', { type: 'button', class: 'ref ref-term', 'data-ref': 'term', 'data-id': p, text: p }) : h('span', { class: 'muted', text: p }))) : null,
      h('div', { class: 'hc-foot', text: `Explained in ${occ.length} message${occ.length === 1 ? '' : 's'} · click for details` }));
  }
  if (t.dataset.ref === 'msg') {
    const e = app.d.byId.get(t.dataset.id);
    if (!e) return h('div', { class: 'hc-body muted', text: 'Message not found' });
    return h('div', {}, h('div', { class: 'hc-head' }, h('b', { text: e.role === 'tutor' ? 'Tutor' : 'You' }), h('span', { class: 'muted small', text: shortId(e.id) })),
      rich(e.text.length > 1400 ? e.text.slice(0, 1400) + '\n\n…' : e.text, 'hc-body hc-msg hl-scope', { terms: false }),
      h('div', { class: 'hc-foot', text: 'Click to open in the side panel' }));
  }
  if (t.dataset.ref === 'skill') {
    const s = skillById(app.topic.meta, t.dataset.id);
    if (!s) return null;
    return h('div', {}, h('div', { class: 'hc-head' }, lvChip(levelOf(s.node)), h('b', { text: `${s.id} ${s.name}` })),
      s.summary ? rich(s.summary, 'hc-body', { terms: false }) : h('div', { class: 'hc-body muted', text: 'No summary yet' }));
  }
  return null;
}
