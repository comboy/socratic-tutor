// Glossary terms while writing an answer or a question (the learner, 2026-11-26: "the thing that
// catches it outside, I keep forgetting the terms"). Two tools on the composer's text box:
//
//  - Suggestions while typing (on by default; System → Settings turns it off). When the word being
//    typed begins a glossary term or alias, a small list opens at that word: the name, and a line
//    of its definition to recognise it by. Tab inserts the term as the glossary writes it (so it
//    links in the sent message, like any term: rich.js). It is built not to get in the way of prose:
//      · three letters before it opens, and nothing for a finished term or a common word;
//      · Enter is never taken (a new line stays a new line; Ctrl/⌘+Enter always sends);
//      · the arrow keys are taken only when there is a choice (two or more suggestions);
//      · Esc closes the list first and only the next Esc hides the input;
//      · typing on, clicking elsewhere or moving the caret makes it go away;
//      · it opens under the line being written when a row fits there, so it covers the quick
//        buttons rather than the question or the answer so far.
//  - Find a term (Ctrl+Space, or the button under the box) for when the beginning of the word is
//    what's forgotten: a small search over names, aliases and definitions, with typo tolerance
//    (terms.js rankTerms, the glossary filter's ranking). Enter inserts the term at the caret.
import { h, store } from './util.js';
import { icon } from './icons.js';
import { plain } from './md.js';
import { rankTerms } from './terms.js';

export const completeOn = () => store.get('termComplete', true) !== false;
export const setCompleteOn = on => store.set('termComplete', !!on);

const MIN = 3, MAX = 6;
const WORD = /[\p{L}\p{N}′']/u;
const fold = s => String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[\s‐‑-]+/g, ' ').trim();
// Whole words that begin many terms but are almost never the start of one when typed alone.
const COMMON = new Set(('the and for are but not you all any can had her was one our out has him his how its may new now old see two way who did get let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them then well were what also back into most part does each even form high next same seem show side tell turn used work about after again could every first found great might never other place right shall should since still their there these thing think those three under where which while whole would because before being between both during through without inside outside').split(' '));

// What to suggest for the text before the caret. -> { from, items: [{ entry, form, alias }] } or null.
// from: where the typed beginning of the term starts (the part an inserted term replaces).
// Up to three typed words can begin a term ("dna pol" -> DNA polymerase); the longest beginning
// that matches wins. A single word of 4+ letters also finds terms it begins a later word of
// ("poly" -> DNA polymerase), listed after the names it begins.
export function suggest(entries, before) {
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const m = line.match(/((?:[\p{L}\p{N}′']+[ ‐‑-]){0,2})([\p{L}\p{N}′']+)$/u);
  if (!m) return null;
  // word starts inside the tail: the tail may begin at any of them
  const lead = m[1].split(/(?<=[ ‐‑-])/).filter(Boolean);   // "dna ", "repair "
  const starts = [];
  let off = line.length - m[0].length;
  for (const w of lead) { starts.push(off); off += w.length; }
  starts.push(off);
  // a word glued to something before it ("x-ray", "non-polar" typed in full) is still a word start; a
  // tail starting mid-word is not
  const base = before.length - line.length;
  const forms = [];
  for (const entry of entries || []) [entry.term, ...(entry.aliases || [])].forEach((f, i) => { const k = fold(f); if (k.length > 1) forms.push({ entry, form: String(f).trim(), k, alias: i > 0 }); });
  for (const s of starts) {
    const tail = line.slice(s), q = fold(tail), single = s === starts[starts.length - 1];
    if (s > 0 && WORD.test(line[s - 1])) continue;
    if (q.length < MIN) continue;
    if (single && COMMON.has(q)) return null;
    if (forms.some(f => f.k === q)) return null;   // a finished term: nothing to add
    const hits = forms.filter(f => f.k.startsWith(q)).map(f => ({ ...f, rank: f.alias ? 1 : 0 }));
    if (single && q.length >= 4) for (const f of forms) if (!f.k.startsWith(q) && f.k.split(' ').some(w => w.startsWith(q) && w !== q)) hits.push({ ...f, rank: 2 });
    if (!hits.length) continue;
    hits.sort((a, b) => a.rank - b.rank || a.k.length - b.k.length || a.k.localeCompare(b.k));
    const seen = new Set(), items = [];
    for (const x of hits) { if (seen.has(x.entry)) continue; seen.add(x.entry); items.push({ entry: x.entry, form: x.form, alias: x.alias, inner: x.rank === 2 }); }
    return { from: base + s, typed: tail, items: items.slice(0, MAX) };
  }
  return null;
}
// The text to insert: the term as the glossary writes it; a lower-case name keeps a capital the
// learner typed (the beginning of a sentence).
export function insertText(form, typed = '') {
  if (form === form.toLowerCase() && typed && typed[0] !== typed[0].toLowerCase()) return form[0].toUpperCase() + form.slice(1);
  return form;
}
const defOf = t => plain([t.full && t.full !== t.term ? t.full + '.' : '', t.short].filter(Boolean).join(' '), 150);

// ---------------------------------------------------------------- the list
let pop = null;       // { el, ta, mode: 'type' | 'find', from, to, typed, items, sel, input }
export function closeComplete() { if (!pop) return; pop.el.remove(); pop = null; }
document.addEventListener('mousedown', e => { if (pop && !pop.el.contains(e.target) && !e.target.closest?.('.find-term')) closeComplete(); }, true);
addEventListener('resize', closeComplete);

// where a position of the textarea's text is on screen (a hidden copy with the same wrapping)
function caretPoint(ta, pos) {
  const cs = getComputedStyle(ta), m = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent']) m.style[p] = cs[p];
  Object.assign(m.style, { position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0', boxSizing: 'border-box', width: ta.offsetWidth + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  m.textContent = ta.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = ta.value.slice(pos) || '.';
  m.append(mark);
  document.body.append(m);
  const r = ta.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || 21;
  const out = { x: r.left + mark.offsetLeft - ta.scrollLeft, y: r.top + mark.offsetTop - ta.scrollTop, lh };
  m.remove();
  return out;
}
function place() {
  const { el, ta, from } = pop;
  const list = el.querySelector('.tc-list');
  if (list) list.style.maxHeight = '';
  const p = caretPoint(ta, from), r = ta.getBoundingClientRect();
  const y = Math.max(r.top, Math.min(r.bottom - p.lh, p.y));   // the caret's line, kept inside the box
  // Under the line whenever a row fits there (the list scrolls): above it lies what is
  // being answered, the question and the lines already written; below, only the quick buttons.
  const below = y + p.lh + 4, room = innerHeight - 6 - below - (el.offsetHeight - (list?.offsetHeight || 0));
  const under = !list || room >= Math.min(list.scrollHeight, 46);
  if (under && list && room < list.scrollHeight) list.style.maxHeight = room + 'px';
  el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, p.x - 10)) + 'px';
  el.style.top = (under ? below : Math.max(6, y - el.offsetHeight - 4)) + 'px';
}
function row(it, i) {
  const t = it.entry;
  return h('div', { class: 'tc-row' + (i === pop.sel ? ' on' : ''), role: 'option', 'aria-selected': String(i === pop.sel), 'data-i': i,
    onmousedown: e => { e.preventDefault(); pop.sel = i; accept(); },
    onmousemove: () => { if (pop && pop.sel !== i) { pop.sel = i; draw(); } } },
    h('span', { class: 'tc-name' }, h('b', { text: it.form || t.term }), it.alias && it.form ? h('span', { class: 'tc-alias', text: ' = ' + t.term }) : null),
    h('span', { class: 'tc-def', text: defOf(t) || '(no definition yet)' }),
    pop.mode === 'type' && i === pop.sel ? h('kbd', { class: 'tc-key', title: 'Tab puts it in your text · Esc closes the list · or just keep typing', text: 'Tab' }) : null);
}
function draw() {
  const kb = (key, what) => h('span', {}, h('kbd', { text: key }), ' ' + what);
  const list = h('div', { class: 'tc-list', role: 'listbox' }, ...pop.items.map(row));
  const many = pop.items.length > 1;
  // (the search field stays the same element: replacing it would take the focus from under the typing)
  if (pop.mode === 'find') pop.body.replaceChildren(
    pop.items.length ? list : h('div', { class: 'tc-empty', text: pop.input.value.trim() ? 'No term like that in this topic’s glossary.' : 'No terms in this topic’s glossary yet.' }),
    h('div', { class: 'tc-foot' }, kb('↵', 'insert'), many ? kb('↑↓', 'choose') : null, kb('Esc', 'back to writing')));
  // while typing: the rows and nothing else (the key is on the chosen row), so the list fits under
  // the line being written, in the little room a text box at the bottom of the window leaves
  else pop.body.replaceChildren(list);
  pop.el.querySelector('.tc-row.on')?.scrollIntoView({ block: 'nearest' });
  place();
}
function open(ta, mode, state) {
  closeComplete();
  const body = h('div', { class: 'tc-body' });
  pop = { el: h('div', { class: 'tc-pop tc-' + mode }, state.input ? h('div', { class: 'tc-head' }, icon('search'), state.input) : null, body), body, ta, mode, sel: 0, ...state };
  document.body.append(pop.el);
  draw();
}
// put the chosen term in the text: as typed input, so the draft is saved, the box refits, and undo works
function accept() {
  if (!pop) return;
  const it = pop.items[pop.sel], { ta, from, to, typed } = pop;
  closeComplete();
  if (!it) { ta.focus(); return; }
  const text = insertText(it.form || it.entry.term, typed);
  ta.focus();
  ta.setSelectionRange(from, to);
  let done = false;
  try { done = document.execCommand('insertText', false, text); } catch {}
  if (!done) { ta.setRangeText(text, from, to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
}

// ---------------------------------------------------------------- while typing
function onInput(ta, ev) {
  if (pop?.mode === 'find') return;
  if (!completeOn() || ev.isComposing || ta.readOnly || (ev.inputType && !/^insert(Text|CompositionText)$|^deleteContent/.test(ev.inputType))) return closeComplete();
  const at = ta.selectionStart;
  if (at !== ta.selectionEnd || WORD.test(ta.value[at] || '')) return closeComplete();   // mid-word: an edit, not a word being written
  const s = suggest(glossary(), ta.value.slice(0, at));
  if (!s) return closeComplete();
  open(ta, 'type', { from: s.from, to: at, typed: s.typed, items: s.items });
}
function onKey(ta, ev) {
  if (ev.isComposing) return;
  // Ctrl+Space: find a term (works with suggestions switched off too)
  if (ev.key === ' ' && ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); ev.stopImmediatePropagation(); findTerm(ta); return; }
  if (!pop || pop.mode !== 'type' || pop.ta !== ta) return;
  const take = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  if (ev.key === 'Tab' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { take(); accept(); }
  else if (ev.key === 'Escape') { take(); closeComplete(); }
  else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && pop.items.length > 1 && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    take(); pop.sel = (pop.sel + (ev.key === 'ArrowDown' ? 1 : pop.items.length - 1)) % pop.items.length; draw();
  }
  // anything else that isn't typing (arrows with one suggestion, Home/End, Enter…) acts as always and the list goes
  else if (ev.key.length > 1 && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Backspace', 'Delete', 'Dead', 'Process'].includes(ev.key)) closeComplete();
}
let glossary = () => [];
// The composer's text box (learn.js makes a new one with every redraw). Call before the box's own
// key handler is added: a key the list takes must not also reach it (Esc would hide the input).
export function attachComplete(ta, getGlossary) {
  glossary = getGlossary;
  // a redraw replaced the box under an open list (a reply arrived): the search keeps its place in
  // the same text; a suggestion list for the old box goes
  if (pop?.mode === 'find' && pop.ta.id === ta.id && pop.ta.value === ta.value) pop.ta = ta;
  else if (pop) setTimeout(() => { if (pop && !pop.ta.isConnected) closeComplete(); }, 0);
  ta.addEventListener('keydown', ev => onKey(ta, ev), true);
  ta.addEventListener('input', ev => onInput(ta, ev));
  ta.addEventListener('blur', () => setTimeout(() => { if (pop?.mode === 'type' && pop.ta === ta && document.activeElement !== ta) closeComplete(); }, 120));
  ta.addEventListener('scroll', () => { if (pop?.mode === 'type') closeComplete(); });
  ta.addEventListener('mousedown', () => { if (pop?.mode === 'type') closeComplete(); });
}

// ---------------------------------------------------------------- find a term
// Opens at the caret with whatever word is being typed as the first query; with nothing typed,
// the terms of the skill in focus come first (the ones the open question is most likely about).
export function findTerm(ta, focusSkills = []) {
  if (!ta || ta.readOnly) return;
  if (pop?.mode === 'find') { closeComplete(); ta.focus(); return; }
  const at = ta.selectionStart, before = ta.value.slice(0, at);
  const word = ta.selectionEnd === at && !WORD.test(ta.value[at] || '') ? (before.match(/[\p{L}\p{N}′']+$/u) || [''])[0] : '';
  const input = h('input', { class: 'tc-input', type: 'text', id: 'findTermBox', placeholder: 'Part of the name, or what it does…', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Find a glossary term' });
  input.value = word;
  const near = new Set((focusSkills || []).map(String));
  const fill = () => {
    const G = glossary(), q = input.value.trim();
    const ranked = q ? rankTerms(G, q, t => `${t.short || ''} ${t.body || ''}`).map(x => x.t)
      : [...G].sort((a, b) => Number((b.skills || []).some(s => near.has(String(s)))) - Number((a.skills || []).some(s => near.has(String(s)))));
    pop.items = ranked.slice(0, 8).map(entry => ({ entry, form: entry.term, alias: false }));
    pop.sel = 0;
    draw();
  };
  open(ta, 'find', { from: at - word.length, to: ta.selectionEnd, typed: word, items: [], input });
  input.addEventListener('input', fill);
  input.addEventListener('keydown', ev => {
    if (ev.isComposing) return;
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); if (!ev.metaKey && !ev.ctrlKey) accept(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeComplete(); ta.focus(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (pop.items.length) { pop.sel = (pop.sel + (ev.key === 'ArrowDown' ? 1 : pop.items.length - 1)) % pop.items.length; draw(); input.focus(); } }
  });
  fill();
  input.focus(); input.select();
}
