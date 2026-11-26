// Wiki: cheat sheet, glossary, skill pages, session reader, tutor notes — as tabs.
import { h, flatSkills, levelOf, lvChip, meter, fmtLevel, fmtDate, skillById, overall, LEVEL_NAMES, lvClass, relDays } from './util.js';
import { rich, legendEntries } from './rich.js';
import { plain, md } from './md.js';
import { icon } from './icons.js';
import { app, go, learner, getJSON } from './app.js';
import { termPanel, skillPanel, occurrences, group, sortedGlossary, filteredGlossary, sortToggle, introOf, noteRow, NOTE_KIND, dependencies, openDock, termEntry } from './panels.js';
import { pageForTerm } from './terms.js';
import * as learnView from './learn.js';
import { messageNode } from './learn.js';

export const routeAlways = true;
const TABS = [['home', 'Overview', 'wiki'], ['cheatsheet', 'Cheat sheet', 'sheet'], ['pages', 'Pages', 'page'], ['glossary', 'Glossary', 'book'], ['skills', 'Skills', 'skills'], ['you', 'You', 'hole'], ['sessions', 'Sessions', 'sessions'], ['notes', 'Tutor notes', 'notes']];
const PARENT = { term: 'glossary', skill: 'skills', session: 'sessions', page: 'pages' };

export function render(center, _app, args) {
  const [page = 'home', arg] = args;
  const cur = PARENT[page] || page;
  const body = h('div', { class: 'view-body' });
  center.replaceChildren(h('div', { class: 'view' },
    h('div', { class: 'view-bar tabbed' }, h('div', { class: 'tabs' }, ...TABS.map(([id, label, ic]) =>
      h('button', { class: 'tab' + (cur === id ? ' on' : ''), onclick: () => go('wiki', id) }, icon(ic), label)))),
    body));
  (P[page] || P.home)(body, arg);
}
export function onTopic() { render(document.getElementById('center'), app, app.args); }
export function onLearner() { if (['you', 'home'].includes(app.args[0] || 'home')) onTopic(); }
const sheet = (...kids) => h('div', { class: 'sheet' }, ...kids);
const RESTART = 'Restart the server (bin/learn) to load this topic’s pages.';
// skills a page links to (skill:ID), in order of first mention
export function pageSkills(text) { return [...new Set([...String(text).matchAll(/\]\(skill:([^)\s]+)\)/g)].map(m => m[1]))]; }
function pageSummary(text) {
  const para = String(text).replace(/^#.*$/m, '').split(/\n\s*\n/).map(s => s.trim()).find(s => s && !/^(```|:::|#|\$\$)/.test(s));
  return plain(para || '', 220);
}
// term pages (terms/<name>.md) with their glossary entries, most recently updated first
function termPages() {
  const G = app.topic.glossary;
  return (app.topic.termPages || []).map(p => ({ p, t: G.find(g => pageForTerm(g, [p])) || null }))
    .sort((a, b) => b.p.mtime.localeCompare(a.p.mtime));
}
function skillChip(id) {
  const sk = skillById(app.topic.meta, id);
  return h('button', { class: 'chip chip-skill chip-btn l' + Math.round(sk ? levelOf(sk.node) : 0), text: id, title: sk?.name || 'unknown skill', onclick: e => { e.stopPropagation(); go('wiki', 'skill', id); } });
}

const P = {
  home(el) { overview(el); },
  cheatsheet(el) {
    el.append(sheet(h('div', { class: 'sheet-pad' }, rich(app.topic.cheatsheet || '*No cheat sheet yet.*', 'wiki-md hl-scope'))));
    const L = legendEntries();
    if (L.length) el.append(sheet(group([icon('palette'), 'Colours in diagrams', h('span', { class: 'count', text: String(L.length) }), h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'one colour per thing, the same in every diagram and highlight' })]),
      h('div', { class: 'vlg-list hl-scope' }, ...L.map(x => { const t = x.term ? termEntry(x.term) : null; return h('div', { class: 'vlg-row', 'data-k': x.key },
        h('span', { class: 'vl-sw', style: { background: x.color } }), h('span', { text: x.label || x.key }),
        t ? h('button', { class: 'chip chip-btn', onclick: () => go('wiki', 'term', t.term) }, icon('book'), t.term) : h('span'),
        h('span', { class: 'vlg-key', title: 'key: {{text|key}} in messages, ctx.color(key) in drawings', text: x.key })); }))));
  },
  you(el) { you(el); },
  pages(el) {
    const pages = app.topic.pages;
    const list = h('div', { class: 'page-list' });
    for (const pg of pages || []) {
      list.append(h('button', { class: 'page-row', onclick: () => go('wiki', 'page', pg.name) },
        h('div', { class: 'page-title' }, icon('page'), h('b', { text: pg.title })),
        h('div', { class: 'page-sum', text: pageSummary(pg.text) }),
        h('div', { class: 'chips' }, ...pageSkills(pg.text).map(skillChip), h('span', { class: 'muted small', text: `pages/${pg.name}.md` }))));
    }
    if (!pages?.length) list.append(h('div', { class: 'empty-row', text: pages ? 'No pages yet. The tutor can add standing reference pages as topics/<slug>/pages/<name>.md.' : RESTART }));
    el.append(sheet(group(['Pages', h('span', { class: 'count', text: String(pages?.length || 0) }), h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'standing reference pages, with live diagrams' })]), list));
    const tp = termPages();
    const tl = h('div', { class: 'page-list term-pages' });
    for (const { p, t } of tp) {
      tl.append(h('button', { class: 'page-row' + (t ? '' : ' missing'), onclick: () => t && go('wiki', 'term', t.term) },
        h('div', { class: 'page-title' }, icon('book'), h('b', { text: t ? t.term : p.name }), t?.full ? h('span', { class: 'gl-full-line', html: md(t.full, { inline: true }) }) : null,
          h('span', { class: 'spacer' }), h('span', { class: 'muted small', text: t ? fmtDate(p.mtime.slice(0, 10)) : 'no glossary term with this name' })),
        h('div', { class: 'page-sum', text: pageSummary(p.text) })));
    }
    if (!tp.length) tl.append(h('div', { class: 'empty-row', text: app.topic.termPages ? 'No term pages yet. A glossary term gets its own page (terms/<name>.md) once there’s more to say than its definition.' : RESTART }));
    el.append(sheet(group(['Term pages', h('span', { class: 'count', text: String(tp.length) }), h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'what you know about a term, gathered on one page; newest first' })]), tl));
  },
  page(el, name) {
    const pg = (app.topic.pages || []).find(p => p.name === name);
    const bar = h('div', { class: 'actions' },
      h('button', { class: 'btn btn-small', onclick: () => go('wiki', 'pages') }, icon('back'), 'All pages'),
      pg ? h('div', { class: 'chips' }, ...pageSkills(pg.text).map(skillChip)) : null);
    if (!pg) { el.append(sheet(bar, h('div', { class: 'empty-row', text: app.topic.pages ? `No page "${name}" in this topic.` : RESTART }))); return; }
    el.append(sheet(bar, h('div', { class: 'sheet-pad' }, rich(pg.text, 'wiki-md page-md hl-scope'))));
  },
  notes(el) {
    el.append(sheet(group('Tutor’s hand-over notes (progress.md)'),
      h('div', { class: 'sheet-pad' }, rich(app.topic.progress || '', 'wiki-md notes-md hl-scope', { terms: false }))));
    if (app.topic.log) el.append(sheet(group('Session log (log.md)'),
      h('div', { class: 'sheet-pad' }, rich(app.topic.log.replace(/^# .*\n/, ''), 'wiki-md notes-md log-md hl-scope', { terms: false }))));
  },
  glossary(el) {
    const q = h('input', { class: 'input', type: 'search', placeholder: `Filter ${app.topic.glossary.length} terms…` });
    const list = h('div');
    const draw = () => {
      const items = filteredGlossary(q.value);
      let section = null;
      list.replaceChildren();
      for (const { t, section: S } of items) {
        if (S !== section) { section = S; list.append(h('div', { class: 'gl-letter', text: S })); }
        const sk = t.skill ? skillById(app.topic.meta, t.skill) : null;
        const n = occurrences(t).length;
        list.append(h('div', { class: 'gl-row' },
          h('button', { class: 'gl-name', onclick: () => go('wiki', 'term', t.term) }, lvChip(sk ? levelOf(sk.node) : 0), t.term,
            pageForTerm(t, app.topic.termPages) ? h('span', { class: 'gl-has-page', title: 'Has its own page' }, icon('page')) : null),
          h('div', { class: 'gl-def-col' },
            t.full ? h('div', { class: 'gl-full-line', html: md(t.full, { inline: true }) }) : null,
            rich(t.short, 'gl-def hl-scope', { terms: false })),
          h('div', { class: 'gl-meta' }, t.size ? h('span', { class: 'chip', text: t.size }) : null, h('span', { class: 'muted small', text: n ? `${n} msg` : '' }))));
      }
      if (!items.length) list.append(h('div', { class: 'empty-row', text: 'No matching terms.' }));
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', ev => { if (ev.key === 'Enter' && q.value.trim()) list.querySelector('.gl-name')?.click(); });
    el.append(sheet(group(['Glossary', h('span', { class: 'count', text: String(app.topic.glossary.length) }), sortToggle(draw), h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'the coloured chip is your level on the skill the term belongs to' })]),
      h('div', { class: 'group-b' }, q), list));
    draw(); q.focus();
  },
  term(el, name) { const d = sheet(); termPanel(d, name, { full: true }); el.append(d); },
  skill(el, id) { const d = sheet(); skillPanel(d, id, { full: true }); el.append(d); },
  skills(el) {
    const s0 = sheet(group('All skills, with what you covered'));
    for (const s of flatSkills(app.topic.meta.skills)) {
      const lv = levelOf(s.node);
      s0.append(h('div', { class: `wsk depth-${s.depth}` + (lv === 0 ? ' fog' : '') },
        h('div', { class: 'wsk-head' }, lvChip(lv),
          h('button', { class: 'gl-name', onclick: () => go('wiki', 'skill', s.id) }, h('span', { class: 'sid', text: s.id }), s.name),
          meter(lv)),
        s.summary && s.depth > 0 ? rich(s.summary, 'wsk-sum hl-scope') : null));
    }
    el.append(s0);
  },
  sessions(el) {
    const days = new Map();
    for (const e of app.topic.journal) { if (e._meta) continue; const d = e.ts.slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(e); }
    const list = h('div', { class: 'sess-list' });
    for (const [d, es] of [...days].reverse()) {
      const tutor = es.filter(e => e.role === 'tutor' && e.kind === 'message');
      const user = es.filter(e => e.role === 'user');
      const grades = es.filter(e => e.kind === 'grade');
      const lv = es.filter(e => e.kind === 'level');
      const heads = [...new Set(tutor.flatMap(e => (e.text.match(/^#{1,3} +(.+)$/gm) || []).map(x => x.replace(/^#+ +/, '').replace(/[*_`]/g, ''))))].slice(0, 6);
      const skills = [...new Set(es.flatMap(e => e._skills || []))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      list.append(h('button', { class: 'sess', onclick: () => go('wiki', 'session', d) },
        h('div', { class: 'sess-date' }, h('b', { text: fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) }), es.some(e => e.imported) ? h('span', { class: 'imported-tag', text: 'terminal' }) : null),
        h('div', { class: 'sess-heads', text: heads.length ? heads.join(' · ') : plain(tutor[0]?.text || '', 160) }),
        h('div', { class: 'sess-stats', text: `${tutor.length} tutor messages · ${user.length} yours${grades.length ? ` · ${grades.filter(g => g.verdict === 'correct').length}/${grades.length} checks correct` : ''}${lv.length ? ` · ${lv.length} level change${lv.length > 1 ? 's' : ''}` : ''}` }),
        skills.length ? h('div', { class: 'chips' }, ...skills.slice(0, 14).map(s => { const sk = skillById(app.topic.meta, s); return h('span', { class: 'chip chip-skill l' + Math.round(sk ? levelOf(sk.node) : 0), text: s, title: sk?.name || '' }); })) : null));
    }
    el.append(sheet(group(['Sessions', h('span', { class: 'count', text: String(days.size) }), h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'open one to re-read it in full' })]), list));
  },
  session(el, d) {
    const all = app.topic.journal.filter(e => e.ts.slice(0, 10) === d && (e.text || e.kind === 'level'));
    const es = all.filter(e => !e._meta), appTalk = all.length - es.length;   // app talk: not part of the lesson
    const days = [...new Set(app.topic.journal.filter(e => !e._meta).map(e => e.ts.slice(0, 10)))];
    const i = days.indexOf(d);
    const th = h('div', { class: 'thread reader' });
    for (const e of es) {
      if (e.kind === 'session') th.append(h('div', { class: 'divider session' }, h('span', { text: e.text })));
      else if (e.kind === 'level') th.append(h('div', { class: 'sysline', text: `${e.skill}: ${e.from} → ${e.to} · ${e.reason || ''}` }));
      else th.append(messageNode(e, { compact: true }));
    }
    if (appTalk) th.append(h('div', { class: 'empty-row', text: `${appTalk} message${appTalk > 1 ? 's' : ''} about the app not shown here (they’re in the conversation, dimmed).` }));
    el.append(sheet(
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-small', onclick: () => go('wiki', 'sessions') }, icon('back'), 'All sessions'),
        h('b', { class: 'reader-title', text: fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }),
        i > 0 ? h('button', { class: 'btn btn-small', onclick: () => go('wiki', 'session', days[i - 1]) }, '‹ Earlier day') : null,
        i < days.length - 1 ? h('button', { class: 'btn btn-small', onclick: () => go('wiki', 'session', days[i + 1]) }, 'Later day ›') : null),
      th));
  },
};

// ---------------------------------------------------------------- overview (wiki home)
const leaves = () => flatSkills(app.topic.meta.skills).filter(s => !s.children?.length);
// next up: unfinished skills whose needs are at level 2+, focus branch first
function nextUp(n = 5) {
  const m = app.topic.meta, target = m.target || 4;
  const focusBranch = m.focus ? String(m.focus).split('.')[0] : null;
  const ready = s => (s.needs || []).every(id => { const f = (m.foundations || []).find(x => x.id === id); const k = f ? null : skillById(m, id); return f ? (f.level ?? 0) >= 2 : k ? levelOf(k.node) >= 2 : true; });
  return leaves().filter(s => (s.level || 0) < Math.min(target, 3) && s.id !== m.focus && ready(s))
    .sort((a, b) => (String(b.id).split('.')[0] === focusBranch) - (String(a.id).split('.')[0] === focusBranch) || (b.level || 0) - (a.level || 0) || a.id.localeCompare(b.id, undefined, { numeric: true }))
    .slice(0, n);
}
function skillLine(s, extra) {
  const lv = levelOf(s.node || s);
  return h('button', { class: 'ov-row', onclick: () => openDock('skill', s.id) }, lvChip(lv), h('span', { class: 'sid', text: s.id }), h('span', { class: 'ov-name', text: s.name, title: s.name }), extra || null);
}
function overview(el) {
  const m = app.topic.meta, ov = overall(m), J = app.topic.journal.filter(e => !e._meta);
  const focus = m.focus ? skillById(m, m.focus) : null;
  const notes = (app.topic.notes?.items || []).filter(n => n.status === 'open');
  const today = new Date().toISOString().slice(0, 10);
  const due = notes.filter(n => n.kind === 'review' && (!n.due || n.due <= today));
  const grid = h('div', { class: 'ov-grid' });
  el.append(sheet(grid));
  // progress + goal
  grid.append(h('div', { class: 'group ov-wide' }, h('div', { class: 'group-h' }, icon('progress'), m.title),
    h('div', { class: 'group-b ov-head' },
      h('div', { class: 'ov-big ' + lvClass(ov) }, h('b', { text: fmtLevel(Math.round(ov * 10) / 10) }), h('small', { text: ' / 5' }), h('div', { class: 'muted small', text: LEVEL_NAMES[Math.round(ov)] })),
      h('div', { class: 'ov-goal' },
        meter(ov, m.target, 'big'),
        m.goal ? h('p', {}, h('span', { class: 'muted', text: 'Your goal: ' }), m.goal) : null,
        h('p', { class: 'muted small', text: `${leaves().length} skills · ${leaves().filter(s => (s.level || 0) >= (m.target || 4)).length} at target · ${app.topic.glossary.length} terms · ${new Set(J.map(e => e.ts.slice(0, 10))).size} days of sessions` })))));
  // focus + next
  const nx = nextUp();
  grid.append(group([icon('learn'), 'Now and next'], h('div', { class: 'ov-list' },
    focus ? skillLine(focus, h('span', { class: 'focus-tag', text: 'now' })) : h('div', { class: 'empty-row', text: 'No focus set yet.' }),
    ...nx.map(s => skillLine(s, h('span', { class: 'muted small', text: 'ready' }))),
    h('div', { class: 'group-b' }, h('button', { class: 'btn btn-small', onclick: () => go('tree') }, icon('tree'), 'Skill tree')))));
  // tutor's notes summary
  const counts = Object.keys(NOTE_KIND).map(k => [k, notes.filter(n => n.kind === k).length]).filter(([, c]) => c);
  grid.append(group([icon('hole'), 'The tutor’s picture of you'], h('div', { class: 'ov-list' },
    due.length ? h('div', { class: 'group-b' }, h('b', { text: `${due.length} review${due.length > 1 ? 's' : ''} due. ` }), h('span', { class: 'muted', text: 'The tutor slips these in; you can also ask: ' }),
      h('button', { class: 'btn btn-small', onclick: () => learnView.quickAction('give me a spaced-review question from the due list') }, icon('quiz'), 'Quiz me')) : null,
    counts.length ? h('div', { class: 'group-b chips' }, ...counts.map(([k, c]) => h('span', { class: `chip note-chip note-${k}`, text: `${c} ${NOTE_KIND[k][0].toLowerCase()}${c > 1 ? 's' : ''}` }))) : h('div', { class: 'empty-row', text: 'No open notes.' }),
    h('div', { class: 'group-b' }, h('button', { class: 'btn btn-small', onclick: () => go('wiki', 'you') }, icon('hole'), 'Open “You”')))));
  // recent sessions
  const days = [...new Set(J.map(e => e.ts.slice(0, 10)))].reverse().slice(0, 4);
  grid.append(group([icon('sessions'), 'Recent sessions'], h('div', { class: 'ov-list' }, ...days.map(d => {
    const es = J.filter(e => e.ts.slice(0, 10) === d);
    const heads = [...new Set(es.filter(e => e.role === 'tutor' && e.kind === 'message').flatMap(e => (e.text.match(/^#{1,3} +(.+)$/gm) || []).map(x => x.replace(/^#+ +/, '').replace(/[*_`]/g, ''))))].slice(0, 3);
    const sk = [...new Set(es.flatMap(e => e._skills || []))].slice(0, 6);
    return h('button', { class: 'ov-row', onclick: () => go('wiki', 'session', d) }, h('b', { class: 'ov-date', text: fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) }),
      h('span', { class: 'ov-name', text: heads.join(' · ') || sk.join(', ') || `${es.length} entries` }));
  }), !days.length ? h('div', { class: 'empty-row', text: 'No sessions yet.' }) : null)));
  // pages + newest terms
  const pages = app.topic.pages || [];
  const tps = termPages().filter(x => x.t).slice(0, Math.max(3, 8 - Math.min(pages.length, 6)));
  grid.append(group([icon('page'), 'Pages'], h('div', { class: 'ov-list' }, ...pages.slice(0, 6).map(pg => h('button', { class: 'ov-row', onclick: () => go('wiki', 'page', pg.name) }, icon('page'), h('span', { class: 'ov-name', text: pg.title }))),
    ...tps.map(({ t }) => h('button', { class: 'ov-row', title: 'Term page', onclick: () => go('wiki', 'term', t.term) }, icon('book'), h('span', { class: 'ov-name', text: t.term }), h('span', { class: 'muted small', text: 'term' }))),
    !pages.length && !tps.length ? h('div', { class: 'empty-row', text: 'No pages yet. The wiki job (I’m away) writes them from what you covered.' }) : null)));
  const newest = sortedGlossary('new').slice(0, 10);
  grid.append(group([icon('book'), 'Newest terms'], h('div', { class: 'group-b chips' }, ...newest.map(({ t }) => h('button', { class: 'chip chip-btn', text: t.term, onclick: () => go('wiki', 'term', t.term) })),
    !newest.length ? h('span', { class: 'muted', text: 'None yet.' }) : null)));
  if (m.foundations?.length) grid.append(group([icon('tree'), 'Foundations this topic builds on'], h('div', { class: 'ov-list' }, ...m.foundations.map(f =>
    h('button', { class: 'ov-row', title: f.why || '', onclick: () => go('tree', f.id) }, lvChip(f.level ?? 0), h('span', { class: 'ov-name', text: f.name }), (f.level ?? 0) < 2 ? h('span', { class: 'chip chip-weak', text: 'shaky' }) : null)))));
}

// ---------------------------------------------------------------- "You": the learner model
async function you(el) {
  const L0 = h('div');
  const notes = app.topic.notes?.items || [];
  const open = notes.filter(n => n.status === 'open'), done = notes.filter(n => n.status !== 'open').reverse();
  const s0 = sheet(group(['What the tutor has noticed', h('span', { class: 'count', text: String(open.length) }), h('span', { class: 'spacer' }),
    h('span', { class: 'group-note', text: 'kept so nothing gets lost, without derailing the lesson' })]));
  for (const k of Object.keys(NOTE_KIND)) {
    const items = open.filter(n => n.kind === k);
    if (!items.length) continue;
    s0.append(h('div', { class: 'notes-sec' }, h('div', { class: 'gl-letter', text: { review: 'To re-test (spaced review)', hole: 'Possible gaps (probed when relevant)', parked: 'Your questions, parked for later', misconception: 'Misconceptions being worked on' }[k] }),
      h('div', { class: 'notes-list' }, ...items.map(noteRow))));
  }
  if (!open.length) s0.append(h('div', { class: 'empty-row', text: 'No open notes for this topic.' }));
  if (done.length) s0.append(h('details', { class: 'notes-done' }, h('summary', { text: `Settled (${done.length})` }), h('div', { class: 'notes-list' }, ...done.map(noteRow))));
  el.append(s0);
  const L = h('div');
  el.prepend(L0);
  el.append(L);
  try {
    const l = await learner();
    L0.replaceChildren(instructionsSheet(l.instructions || ''));
    // the profile without its title and without "In my own words" (shown above, editable)
    const strip = t => String(t || '').replace(/^# [^\n]*\n[\s\S]*?(?=^## )/m, '').replace(/^## In my own words[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '');
    L.append(sheet(group(['Across all your topics', h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'learner/knowledge.md: kept by the tutors and the reviewer' })]),
      h('div', { class: 'sheet-pad' }, rich(strip(l.knowledge) || '*Nothing yet.*', 'wiki-md hl-scope', { terms: false }))));
    L.append(sheet(group(['How you like to learn', h('span', { class: 'spacer' }), h('span', { class: 'group-note', text: 'learner/profile.md: every tutor reads this; edit it freely' })]),
      h('div', { class: 'sheet-pad' }, rich(strip(l.profile) || '*Empty.*', 'wiki-md hl-scope', { terms: false }))));
  } catch (e) { L.append(h('div', { class: 'error', text: 'Could not load the learner files: ' + e.message })); }
  el.append(pillSheet(app.topic.slug));
}

// Your instructions to every tutor (learner/profile.md, "In my own words"): shown here with the
// rest of the learner model; edited on the Tell page (toolbar), so there's one editor.
function instructionsSheet(text) {
  return sheet(group(['Your instructions to every tutor', h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-small', id: 'instrEdit', onclick: () => go('tell', 'instructions') }, icon('compose'), 'Edit')]),
  h('div', { class: 'sheet-pad instr' }, text ? rich(text, 'wiki-md', { terms: false })
    : h('p', { class: 'muted', text: 'None yet: tell the tutors how to work with you (Edit).' })));
}

// The knowledge pill: what you know in this topic as one portable file (app/pill.js), for seeding
// another tutor or system. Generated on demand from the levels, summaries and notes, so it's current.
function pillSheet(slug) {
  const body = h('div', { class: 'sheet-pad pill-body' });
  const note = h('span', { class: 'group-note pill-note' });
  let text = null;
  const load = async () => { if (text == null) text = (await getJSON('/api/pill/' + slug)).text; return text; };
  const copy = h('button', { class: 'btn btn-small', id: 'pillCopy', onclick: async () => {
    try { await navigator.clipboard.writeText(await load()); note.textContent = 'Copied'; } catch (e) { note.textContent = 'Could not copy: ' + e.message; }
    setTimeout(() => { note.textContent = ''; }, 2500);
  } }, icon('page'), 'Copy');
  const show = h('button', { class: 'btn btn-small', id: 'pillShow', onclick: async () => {
    if (body.childElementCount) { body.replaceChildren(); show.lastChild.textContent = 'Show'; return; }
    try { body.append(h('div', { class: 'pill-text' }, rich(await load(), 'wiki-md', { terms: false }))); show.lastChild.textContent = 'Hide'; } catch (e) { body.append(h('div', { class: 'error', text: e.message })); }
  } }, icon('book'), h('span', { text: 'Show' }));
  return sheet(group(['Your knowledge pill', h('span', { class: 'spacer' }), note, copy, show]),
    h('div', { class: 'sheet-pad pill-desc' }, h('p', { class: 'muted' }, 'Where you stand in this topic, as one short markdown file: skills by level, foundations, what was corrected recently, your background and how you learn. Attach it to any chat or agent so it talks to you at the right level. Made fresh from your data each time; ',
      h('code', { text: 'bin/learn pill --all' }), ' saves every topic\u2019s to ', h('code', { text: 'learner/pills/' }), '.')),
    body);
}
