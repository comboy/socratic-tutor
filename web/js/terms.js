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

const cache = new WeakMap();
// -> { find(text) -> [{ index, end, text, entry, form }], lookup(phrase) -> entry | null }
// entries: [{ term, aliases }]. Cached per array, so pass the same glossary array to reuse it.
export function termMatcher(entries) {
  if (entries && cache.has(entries)) return cache.get(entries);
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
  const pick = text => (byKey.get(key(text)) || []).find(f => caseOK(f.form, text)) || null;
  function find(text) {
    const out = [];
    if (!re || !text) return out;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const f = pick(m[1]);
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
  if (entries) cache.set(entries, api);
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
