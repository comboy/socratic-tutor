// Global search overlay (/ or ⌘K): terms, skills, map nodes and every message.
import { h, $, flatSkills, levelOf, fmtLevel, shortId } from './util.js';
import { plain } from './md.js';
import { pageForTerm } from './terms.js';
import { icon } from './icons.js';
import { app, go } from './app.js';
import { openDock, snippet } from './panels.js';

// ---------------------------------------------------------------- search
export function openSearch() {
  if ($('.search-overlay')) return;
  const input = h('input', { class: 'input search-input', placeholder: 'Search terms, skills, the map and every message…', type: 'search' });
  const results = h('div', { class: 'search-results' });
  let items = [], sel = 0;
  const ov = h('div', { class: 'search-overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'search-box' }, h('div', { class: 'search-top' }, icon('search'), input), results,
      h('div', { class: 'search-hint', text: '↑↓ move · Enter opens in the side panel · Esc closes' })));
  document.body.append(ov);
  input.focus();
  const run = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    items = [];
    if (words.length) {
      const has = s => words.every(w => String(s).toLowerCase().includes(w));
      for (const t of app.topic.glossary) if (has(t.term + ' ' + t.aliases.join(' ') + ' ' + plain(t.full || '', 200)) || has(t.short) || has(pageForTerm(t, app.topic.termPages)?.text || '')) items.push({ type: 'term', id: t.term, title: t.term, sub: plain(t.short, 120), score: has(t.term) ? 3 : 1 });
      for (const s of flatSkills(app.topic.meta.skills)) if (has(s.name) || has(s.summary || '')) items.push({ type: 'skill', id: s.id, title: `${s.id} ${s.name}`, sub: `level ${fmtLevel(levelOf(s.node))}`, score: has(s.name) ? 2.5 : 1 });
      for (const pg of app.topic.pages || []) if (has(pg.title) || has(pg.text)) items.push({ type: 'page', id: pg.name, title: pg.title, sub: `wiki page · pages/${pg.name}.md`, score: has(pg.title) ? 2.8 : 1.2 });
      for (const n of app.topic.map?.nodes || []) if (has(n.label) || has(n.desc || '')) items.push({ type: 'node', id: n.id, title: n.label, sub: n.sub || '', score: 2 });
      for (const e of app.topic.journal) if (e.text && (e.kind === 'message' || e.role === 'user') && has(e.text)) items.push({ type: 'msg', id: e.id, title: `${e.role === 'tutor' ? 'Tutor' : 'You'} · ${shortId(e.id)}`, sub: snippet(e.text, words[0], 140), score: e.role === 'tutor' ? 0.5 : 0.3, ts: e.ts });
      items.sort((a, b) => b.score - a.score || (b.ts || '').localeCompare(a.ts || ''));
      items = items.slice(0, 60);
    }
    sel = 0; draw();
  };
  const LBL = { term: 'term', skill: 'skill', node: 'map', msg: 'msg', page: 'page' };
  const draw = () => {
    results.replaceChildren(...items.map((it, i) => h('button', { class: 'sr' + (i === sel ? ' on' : ''), onclick: () => pick(it) },
      h('span', { class: 'sr-type t-' + it.type, text: LBL[it.type] }), h('span', { class: 'sr-title', text: it.title }), h('span', { class: 'sr-sub', text: it.sub }))));
    results.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  const pick = it => { ov.remove(); if (it.type === 'page') go('wiki', 'page', it.id); else openDock(it.type, it.id); };
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) pick(items[sel]);
    else if (e.key === 'Escape') ov.remove();
  });
}
