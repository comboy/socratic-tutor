// Glossary term matching, shared by the auto-linker (rich.js), the term pages' occurrence lists
// (panels.js) and `bin/learn terms-missing` / `post` (app/check.js, via require). No DOM.
//
// Every form (the term and each alias) matches
//  - any case if it is all lower case; if it has capitals ("DNA polymerase", "ATP"), those must
//    stay capitals, the other letters may be capitalised too ("DNA Polymerase", "DNA POLYMERASE")
//  - with any whitespace, or a hyphen, between its words ("non-polar" = "non polar")
//  - in the plural: -s, -es, and y→ies, us→i, um→a, -rion/-menon→a; a plural form also matches
//    its singular. A possessive ('s) is left outside the link.
// Where forms overlap, the longest wins ("DNA polymerase" beats "polymerase").
const W = '\\p{L}\\p{N}_';
const SEP = '[\\s\\u2010\\u2011-]+';
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const spaced = s => String(s).trim().replace(/[\s\u2010\u2011-]+/g, ' ');
const key = s => spaced(s).toLowerCase();

// other spellings of a form: irregular plurals, and the singular of a plural form
function variants(form) {
  if (!/[a-z]$/.test(form)) return [];   // acronyms and symbols: only the -s plural (below)
  const out = [];
  if (/[^aeiou]y$/.test(form)) out.push(form.slice(0, -1) + 'ies');
  if (/.{3}us$/.test(form)) out.push(form.slice(0, -2) + 'i');
  if (/.{3}um$/.test(form)) out.push(form.slice(0, -2) + 'a');
  if (/(rion|menon)$/.test(form)) out.push(form.slice(0, -2) + 'a');
  if (/.{2}ies$/.test(form)) out.push(form.slice(0, -3) + 'y');
  else if (/.{3}[^sui']s$/.test(form)) out.push(form.slice(0, -1));
  return out;
}

// capitals in the form must be capitals in the text; lower-case letters may be either
function caseOK(form, text) {
  if (form === form.toLowerCase()) return true;
  const f = spaced(form), t = spaced(text);
  if (f.length !== t.length) return false;
  for (let i = 0; i < f.length; i++) if (f[i] !== f[i].toLowerCase() && t[i] !== f[i]) return false;
  return true;
}

// The learner's own messages are typed fast, mostly in lower case ("the golgi", "dna polymerase"),
// and the terms in them should still open their cards. So `loose` drops the capitals rule where
// that is safe, measured on real messages (2026-11-26): names with only word-initial capitals
// ("Golgi apparatus") and plain acronyms of 3+ letters ("DNA", and only without a plural ending:
// "TIM" + "es" is the word "times"). Not mixed-case names ("ZeRO" is not "zero"), nor forms
// beginning with a single letter ("A site" is not "a site").
function looseOK(form, plural) {
  const words = spaced(form).split(' ');
  if (words[0].length < 2 || spaced(form).length < 3) return false;
  const acronym = w => /^\p{Lu}{3,}$/u.test(w);
  if (plural && acronym(words.at(-1))) return false;
  return words.every(w => acronym(w) || !/[\p{Lu}_]/u.test(w.slice(1)));
}

const cache = new WeakMap(), looseCache = new WeakMap();
// -> { find(text) -> [{ index, end, text, entry, form }], lookup(phrase) -> entry | null }
// entries: [{ term, aliases }]. Cached per array, so pass the same glossary array to reuse it.
export function termMatcher(entries, { loose = false } = {}) {
  const cache_ = loose ? looseCache : cache;
  if (entries && cache_.has(entries)) return cache_.get(entries);
  const byKey = new Map();
  const add = (form, entry) => { const k = key(form); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push({ form, entry }); };
  const forms = [];
  for (const entry of entries || []) for (const raw of [entry.term, ...(entry.aliases || [])]) {
    const form = String(raw || '').trim();
    if (form.length > 1) { forms.push([form, entry]); add(form, entry); }
  }
  // derived spellings only where no real form already has that spelling
  for (const [form, entry] of forms) for (const v of variants(form)) if (!byKey.has(key(v))) add(v, entry);
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  const re = keys.length ? new RegExp(`(?<![${W}\\-])(${keys.map(k => k.split(' ').map(reEsc).join(SEP)).join('|')})(?:e?s)?(?![${W}])`, 'giu') : null;
  const pick = (text, plural) => { const fs = byKey.get(key(text)) || []; return fs.find(f => caseOK(f.form, text)) || (loose && fs.find(f => looseOK(f.form, plural))) || null; };
  function find(text) {
    const out = [];
    if (!re || !text) return out;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const f = pick(m[1], m[0].length > m[1].length);
      // a form with capitals didn't match this text's case: try shorter forms further on
      if (!f) { re.lastIndex = m.index + 1; continue; }
      out.push({ index: m.index, end: m.index + m[0].length, text: m[0], entry: f.entry, form: f.form });
    }
    return out;
  }
  // the glossary entry a whole phrase names (e.g. a bold phrase), or null
  function lookup(phrase) {
    const t = String(phrase || '').trim();
    const hits = find(t);
    return hits.length === 1 && hits[0].index === 0 && hits[0].end === t.length ? hits[0].entry : null;
  }
  const api = { find, lookup };
  if (entries) cache_.set(entries, api);
  return api;
}

// The file name of a term's wiki page (topics/<t>/terms/<name>.md): lower case, words joined by
// "-" ("KV cache" -> "kv-cache", "5′ cap" -> "5-cap"). A page may also be named after an alias.
export function termSlug(form) {
  return String(form || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}
export const TERM_PAGE = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}-]*$/u;
// The page for a glossary entry from [{ name, text, … }], by its term's name, else an alias's.
export function pageForTerm(entry, pages) {
  if (!entry || !pages?.length) return null;
  for (const f of [entry.term, ...(entry.aliases || [])]) { const n = termSlug(f), p = pages.find(x => x.name === n); if (p) return p; }
  return null;
}

// ---------------------------------------------------------------- glossary filter
// Ranks glossary entries for what the learner typed in a filter box. What they expect (their
// words, 2026-11-26): the name from its beginning first, then inside the name, then the
// description; a typo should still find the term. So four tiers, in this order:
//   0 a name (the term or an alias) starts with the query        "RNA" -> RNA, RNA polymerase
//   1 the query is inside a name or the expansion                "RNA" -> mRNA, tRNA
//   2 every word of the query is somewhere in the description
//   3 similar spelling of a name ("ribsome" -> ribosome), only when no name matched at all:
//     next to real hits it would be noise
// Inside a tier: the term's own name before an alias, a word's beginning before its middle, and
// otherwise the order the entries came in (so the list's A–Z / Newest choice still holds).
// -> [{ t, tier }]; with an empty query, every entry with tier -1. desc(t): the text of tier 2.
export const TERM_TIERS = ['Name starts with it', 'In the name', 'In the description', 'Similar spelling'];
const fold = s => String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
// edit distance with swaps of neighbours counted as one (optimal string alignment)
export function editDistance(a, b) {
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
// is q a misspelling of s, or of the beginning of s (the learner may still be typing)?
function near(q, s, lim) {
  for (let n = q.length - lim; n <= q.length + lim; n++) {
    if (n < 2 || n > s.length) continue;
    if (editDistance(q, s.slice(0, n)) <= lim) return true;
  }
  return false;
}
export function rankTerms(entries, query, desc = t => t.short || '') {
  const q = fold(query);
  if (!q) return (entries || []).map(t => ({ t, tier: -1 }));
  const words = q.split(' ');
  const wordStart = (s, i) => i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]);
  const scored = [];
  (entries || []).forEach((t, order) => {
    const forms = [t.term, ...(t.aliases || [])].map(fold).filter(Boolean);
    let tier = 9, sub = 9;
    const take = (T, S) => { if (T < tier || (T === tier && S < sub)) { tier = T; sub = S; } };
    forms.forEach((f, i) => {
      const at = f.indexOf(q), alias = i ? 1 : 0;
      if (f === q) take(0, alias);
      else if (at === 0) take(0, 2 + alias);
      else if (at > 0) take(1, (wordStart(f, at) ? 0 : 2) + alias);
    });
    const full = fold(t.full).replace(/[*_`]/g, '');
    if (tier > 1 && (full.includes(q) || (words.length > 1 && words.every(w => forms.some(f => f.includes(w)) || full.includes(w))))) take(1, 4);
    if (tier > 2) { const d = fold(desc(t)) + ' ' + full + ' ' + forms.join(' '); if (words.every(w => d.includes(w))) take(2, 0); }
    if (tier < 9) scored.push({ t, tier, sub, order });
  });
  if (!scored.some(x => x.tier < 2) && q.length >= 4) {
    const lim = q.length >= 8 ? 2 : 1, have = new Set(scored.map(x => x.t));
    (entries || []).forEach((t, order) => {
      if (have.has(t)) return;
      const forms = [t.term, ...(t.aliases || [])].map(fold).filter(Boolean);
      if (forms.some(f => near(q, f, lim) || f.split(/[^\p{L}\p{N}]+/u).some(w => near(q, w, lim)))) scored.push({ t, tier: 3, sub: 0, order });
    });
  }
  return scored.sort((a, b) => a.tier - b.tier || a.sub - b.sub || a.order - b.order).map(({ t, tier }) => ({ t, tier }));
}
