// `bin/learn check [topic]`: validate a topic's files after editing them by hand.
// Catches what the UI would silently show wrong: bad JSON, unknown skill ids, broken
// msg:/term:/skill:/map:/wiki: links, media: images, map edges to missing nodes, glossary metadata typos,
// term pages (terms/<name>.md) that no term owns.
// linkChecker() is also used by `bin/learn post` to refuse broken links before they're posted.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./store');

const LINK = /\]\((msg|term|skill|map|wiki):([^)\n]+)\)/g;
const WIKI_PAGES = /^(home|cheatsheet|glossary|skills|tree|sessions|notes|you|pages|page\/[a-z0-9-]+|session\/\d{4}-\d{2}-\d{2}|term\/.+|skill\/.+)$/;
const TEXT_KINDS = new Set(['message', 'answer', 'ask', 'action', 'start']);

// -> fn(text) returning [{ type, id, error: bool, why }]. Reads the topic once.
function linkChecker(slug) {
  const meta = S.loadTopicMeta(slug);
  const skills = new Set(); S.walkSkills(meta.skills, s => skills.add(String(s.id)));
  const forms = new Set(); for (const g of S.readGlossary(slug)) for (const f of [g.term, ...g.aliases]) forms.add(f.toLowerCase());
  let map = null; try { map = S.readJSON(path.join(S.topicDir(slug), 'map.json'), null); } catch {}
  const nodes = new Set((map?.nodes || []).map(n => n.id));
  const pageNames = new Set(S.readPages(slug).map(p => p.name));
  const J = S.readJournal(slug), byId = new Map(J.map(e => [e.id, e]));
  const days = new Set(J.map(e => e.id.split('.')[0]));
  const media = new Set(Object.keys(S.readMedia(slug)));
  return text => {
    const out = [];
    // a link written as code (an example in the notes) is not a link
    text = String(text || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, ' ');
    for (const m of text.matchAll(/!\[[^\]\n]*\]\(media:([^)\s]+)\)/g))
      if (!media.has(m[1])) out.push({ type: 'media', id: m[1], why: 'not in media/ (download it first: bin/learn image)', error: true });
    for (const m of text.matchAll(LINK)) {
      const [, type, raw] = m;
      let id = raw.trim(); try { id = decodeURIComponent(id); } catch {}
      let why = null;
      if (type === 'msg') {
        const e = byId.get(id) || S.findEntry(id, slug);
        if (!e) why = 'no such message';
        else if (!TEXT_KINDS.has(e.kind)) why = `${id} is a ${e.kind} entry, not a message${e.kind === 'grade' ? ` (it grades ${e.target})` : ''}`;
      } else if (type === 'term') { if (!forms.has(id.toLowerCase())) why = 'not in the glossary'; }
      else if (type === 'skill') { if (!skills.has(id)) why = 'no such skill'; }
      else if (type === 'map') { if (!nodes.has(id)) why = 'no such map node'; }
      else if (!WIKI_PAGES.test(id) || (id.startsWith('session/') && !days.has(id.slice(8))) || (id.startsWith('page/') && !pageNames.has(id.slice(5)))) why = 'no such wiki page';
      if (why) out.push({ type, id, why, error: type === 'msg' || type === 'skill' });
    }
    return out;
  };
}

function checkTopic(slug) {
  const problems = [], warnings = [];
  const bad = (where, msg) => problems.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
  const dir = S.topicDir(slug), file = f => path.join(dir, f);

  let meta;
  try { meta = S.loadTopicMeta(slug); } catch (e) { bad('topic.json', e.message); return { problems, warnings }; }
  const skills = new Map();
  S.walkSkills(meta.skills, s => {
    if (skills.has(String(s.id))) bad('topic.json', `duplicate skill id ${s.id}`);
    skills.set(String(s.id), s);
    if (!s.children?.length && s.level != null && !(s.level >= 0 && s.level <= 5)) bad('topic.json', `skill ${s.id}: level ${s.level} not in 0..5`);
  });
  if (meta.focus && !skills.has(String(meta.focus))) bad('topic.json', `focus ${meta.focus} is not a skill`);
  const found = new Set();
  for (const f of meta.foundations || []) {
    if (!f.id || /^\d/.test(f.id)) bad('topic.json', `foundation id "${f.id}" must be a word (skill ids are numbers)`);
    if (skills.has(f.id) || found.has(f.id)) bad('topic.json', `foundation id ${f.id} is used twice`);
    found.add(f.id);
  }
  for (const s of skills.values()) for (const n of s.needs || []) {
    if (!skills.has(String(n)) && !found.has(n)) bad('topic.json', `skill ${s.id} needs "${n}": not a skill or foundation`);
    if (String(n) === String(s.id)) bad('topic.json', `skill ${s.id} needs itself`);
  }

  const glossary = S.readGlossary(slug);
  const forms = new Map();   // lowercased form -> term
  for (const g of glossary) for (const f of [g.term, ...g.aliases]) {
    if (forms.has(f.toLowerCase()) && forms.get(f.toLowerCase()) !== g.term) warn('glossary.md', `"${f}" is used by both "${forms.get(f.toLowerCase())}" and "${g.term}"`);
    forms.set(f.toLowerCase(), g.term);
  }
  for (const g of glossary) {
    if (!g.short) bad(`glossary "${g.term}"`, 'no definition paragraph');
    for (const s of g.skills) if (!skills.has(s)) bad(`glossary "${g.term}"`, `unknown skill ${s}`);
    for (const s of g.see) if (!forms.has(s.toLowerCase())) warn(`glossary "${g.term}"`, `see: "${s}" is not a term`);
    for (const s of g.parts) if (!forms.has(s.toLowerCase())) warn(`glossary "${g.term}"`, `parts: "${s}" is not a term`);
    // an unknown key ends the metadata block, so it silently becomes the definition
    const k = g.short.match(/^([a-z]+):\s/);
    if (k && !S.META_KEYS.has(k[1])) warn(`glossary "${g.term}"`, `"${k[1]}:" is not a metadata key (known: ${[...S.META_KEYS].join(', ')}), so it became the definition`);
  }

  let map = null;
  try { map = S.readJSON(file('map.json'), null); } catch (e) { bad('map.json', e.message); }
  const nodes = new Set((map?.nodes || []).map(n => n.id));
  if (map) {
    for (const n of map.nodes || []) {
      if (n.skill && !skills.has(String(n.skill))) bad(`map node ${n.id}`, `unknown skill ${n.skill}`);
      for (const t of n.terms || []) if (!forms.has(t.toLowerCase())) warn(`map node ${n.id}`, `term "${t}" is not in the glossary`);
    }
    for (const e of map.edges || []) for (const end of [e.from, e.to]) if (!nodes.has(end)) bad('map.json', `edge ${e.from} → ${e.to}: no node ${end}`);
  }
  try { S.readJSON(file('tags.json'), null); } catch (e) { bad('tags.json', e.message); }
  let notes = null;
  try { notes = S.readJSON(file('notes.json'), null); } catch (e) { bad('notes.json', e.message); }
  for (const n of notes?.items || []) {
    if (!S.NOTE_KINDS.includes(n.kind)) bad(`note ${n.id}`, `unknown kind ${n.kind}`);
    if (n.skill && !skills.has(String(n.skill))) warn(`note ${n.id}`, `unknown skill ${n.skill}`);
  }

  try { for (const f of fs.readdirSync(file('pages'))) if (!(f.endsWith('.md') && S.PAGE_NAME.test(f.slice(0, -3)))) warn('pages/', `${f}: not shown (pages are <name>.md, name a-z 0-9 -)`); } catch {}
  const check = linkChecker(slug);
  const links = (where, text) => { for (const p of check(text)) (p.error ? bad : warn)(where, `broken link ${p.type}:${p.id} (${p.why})`); };
  for (const s of skills.values()) { links(`skill ${s.id} summary`, s.summary); links(`skill ${s.id} notes`, s.notes); }
  for (const g of glossary) links(`glossary "${g.term}"`, g.short + '\n' + g.body);
  links('cheatsheet.md', S.readText(file('cheatsheet.md'), ''));
  links('progress.md', S.readText(file('progress.md'), ''));
  for (const n of map?.nodes || []) links(`map node ${n.id}`, n.desc);
  for (const p of S.readPages(slug)) links(`pages/${p.name}.md`, p.text);
  // terms/<name>.md: one page per glossary term, named after the term or an alias (termSlug)
  try {
    for (const f of fs.readdirSync(file('terms'))) {
      const n = f.normalize('NFC');
      if (!(n.endsWith('.md') && S.TERM_PAGE.test(n.slice(0, -3)))) warn('terms/', `${f}: not shown (term pages are <name>.md, lower case, words joined by "-")`);
    }
  } catch {}
  const slugs = new Map(); for (const g of glossary) for (const f of [g.term, ...g.aliases]) if (!slugs.has(S.termSlug(f))) slugs.set(S.termSlug(f), g.term);
  const termPages = S.readTermPages(slug);
  const shown = new Map(glossary.map(g => [g.term, S.pageForTerm(g, termPages)]));   // the term's own name wins over an alias
  for (const p of termPages) {
    const owner = slugs.get(p.name);
    if (!owner) warn(`terms/${p.name}.md`, `no glossary term or alias is called that (expected terms/<termSlug(term)>.md, e.g. "KV cache" -> kv-cache.md), so it is not shown`);
    else if (shown.get(owner) !== p) warn(`terms/${p.name}.md`, `"${owner}" already has terms/${shown.get(owner).name}.md; only that one is shown`);
    links(`terms/${p.name}.md`, p.text);
  }
  // old messages can't be fixed any more, so broken links in them are only warnings
  for (const e of S.readJournal(slug)) if (e.role === 'tutor' && e.text) for (const p of check(e.text)) warn(`message ${e.id}`, `broken link ${p.type}:${p.id} (${p.why})`);
  return { problems, warnings };
}

// ---------------------------------------------------------------- glossary coverage
// Bold phrases are how a tutor marks a new term, so a bold phrase that names no glossary term or
// alias is probably a term that was never added. Heuristic: 1–4 words, not a sentence or a label
// like "**Correct:**". Matching is the UI's own (web/js/terms.js), plurals and case included.
const { termMatcher } = require('../web/js/terms.js');
// first words of emphasis rather than of a term; words that make a phrase a clause; last words of
// a label ("**The error-rate answer:**")
const words = s => new Set(s.split(/\s+/));
const NOT_FIRST = words(`correct partial wrong right left yes no not nothing none everything something anything always never
  why how what when where which who whose without with careful note tip example recap question answer step steps numbers
  focus important key remember both each every all only also then so but and or if because first second third next last
  now here there this that these those it its they we you he she i your my our their one two three four five more less most
  least much many same different given known inside outside red blue green orange grey gray yellow purple black white`);
const CLAUSE = words(`the a an and or in into from across to on by with at as is are was were be been it they them we you can cannot
  does do did has have had will would should could gets get got makes make made goes go`);
const NOT_LAST = words(`answer answers question questions part point idea rule version picture case reason catch problem trick
  takeaway summary check test chart diagram`);
function boldPhrases(text) {
  // no code, maths or link targets (a tip's note is not where terms are introduced)
  const src = String(text || '').replace(/```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' ').replace(/\]\((?:[^()\n]|\([^()\n]*\))*\)/g, ']')
    .replace(/\{\{([^{}|\n]+?)(?:\|[^{}\n]+?)?\}\}/g, '$1');
  const out = [];
  for (const m of src.matchAll(/\*\*([^*\n]+?)\*\*|(?<![\w])__([^_\n]+?)__(?![\w])/g)) {
    const p = (m[1] || m[2]).replace(/[[\]{}|]/g, ' ').trim()
      .replace(/^["'“‘(]+|["'”’)]+$/g, '').replace(/[:,;.!?]+$/, '').trim().replace(/^(the|a|an)\s+/i, '');
    if (p.length < 2 || /[.,!?;:=<>$\\]/.test(p) || /^\d/.test(p) || !/\p{L}/u.test(p)) continue;
    const w = p.toLowerCase().split(/\s+/);
    if (w.length > 4 || NOT_FIRST.has(w[0]) || NOT_LAST.has(w.at(-1)) || w.slice(1).some(x => CLAUSE.has(x))) continue;
    if (w.length === 1 && /^[a-z]+(ed|ly)$/.test(p)) continue;   // "charged", "quickly": emphasis
    out.push(p);
  }
  return out;
}
// -> { missing: [{ phrase, ids, n }], partial: [{ phrase, ids, n, has: [terms] }], scanned }, most
// recent first. missing: names no term; partial: contains one ("whole nucleotide": "nucleotide").
// texts: [{ id, text }] to check instead of the last tutor messages (`post` checks the new one).
function missingTerms(slug, { last = 20, texts = null } = {}) {
  const m = termMatcher(S.readGlossary(slug));
  const msgs = texts || S.readJournal(slug).filter(e => e.role === 'tutor' && e.kind === 'message' && e.text).slice(-last);
  const groups = new Map();
  msgs.forEach((e, i) => {
    for (const p of boldPhrases(e.text)) {
      if (m.lookup(p)) continue;
      const k = p.toLowerCase().replace(/(?<=.{3})(e?s)$/, '');
      const g = groups.get(k) || groups.set(k, { phrase: p, ids: [], n: 0, at: 0, has: [...new Set(m.find(p).map(h => h.entry.term))] }).get(k);
      g.n++; g.at = i;
      if (e.id && !g.ids.includes(e.id)) g.ids.push(e.id);
    }
  });
  const all = [...groups.values()].sort((a, b) => b.at - a.at || a.phrase.localeCompare(b.phrase)).map(({ at, ...g }) => g);
  return { missing: all.filter(g => !g.has.length), partial: all.filter(g => g.has.length), scanned: msgs.length };
}

module.exports = { checkTopic, linkChecker, boldPhrases, missingTerms };
