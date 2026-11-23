// A "knowledge pill": what the learner knows in one topic, as one portable markdown file that any
// other tutor or system could start from (instead of from zero, or from this workspace's files).
// Generated from the structured data (levels, skill summaries, notes, foundations, glossary,
// knowledge.md, profile.md), so it's always as current as they are; nothing in it is hand-kept.
// Workspace-specific bits (msg: links, message and note ids) are stripped: they mean nothing elsewhere.
//
//   bin/learn pill [t]            print it
//   bin/learn pill [t] --write    write learner/pills/<slug>.md · pill --all: every topic
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./store');

const LEVELS = ['unaware', 'heard of it', 'can follow along', 'can do with help', 'can do independently', 'can teach it'];
const PILLS = path.join(S.LEARNER, 'pills');

// markdown from this workspace -> plain prose that stands alone
function portable(t) {
  return String(t || '')
    .replace(/\s*\((?:\s*\[[^\]]*\]\((?:msg|skill|term|wiki|map|tip|media):[^)]*\)\s*[,;]?)+\s*\)/g, '')   // "([explained](msg:…), [viz](msg:…))"
    .replace(/!\[([^\]]*)\]\(media:[^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\((?:msg|skill|term|wiki|map|tip):[^)]*\)/g, '$1')
    .replace(/\{\{([^{}|\n]+?)(?:\|[^{}\n]+?)?\}\}/g, '$1')
    // message ids ("2026-11-22.67", ".67", ".121–.127", "msg llms 2026-…") and note ids ("n12"), with
    // the "in"/"at" that pointed at them ("explained in .74" -> "explained")
    .replace(/(?:\s+(?:in|at|from|since|see)\b)?(?:\s+msg)?(?:\s+[a-z][a-z0-9-]*(?=\s+\d{4}-))?\s*\b\d{4}-\d{2}-\d{2}\.\d+(?:\s*[–-]\s*\.?\d+)?\b/g, '')
    .replace(/(?:\s+(?:in|at|from|since|see)\s+|(?<=[\s(,;]|^))\.\d+(?:\s*[–-]\s*\.?\d+)?\b/gm, '')
    .replace(/(?<![\w.])n\d+\b/g, '')
    .replace(/\(\s*msg\s*(?:[a-z][a-z0-9-]*)?\s*\)/g, '')
    .replace(/\(\s*(?:[,;/]\s*|and\s+|also\s+)*\)/g, '').replace(/\(\s*[,;]\s*/g, '(').replace(/\s*[,;]\s*\)/g, ')')
    .replace(/ {2,}/g, ' ').replace(/ +([,.;:)])/g, '$1').trim();
}
const oneLine = t => portable(t).replace(/^\s*[-*]\s+/gm, '').split('\n').map(s => s.trim()).filter(Boolean);

function pill(slug) {
  const meta = S.loadTopicMeta(slug);
  const leaves = []; S.walkSkills(meta.skills, s => { if (!s.children?.length) leaves.push(s); });
  const avg = xs => xs.length ? xs.reduce((a, s) => a + (s.level || 0), 0) / xs.length : 0;
  const out = [`# What I know: ${meta.title || slug}`, '',
    `A portable summary of one learner's knowledge in this topic, generated ${S.localDate()} from their learning workspace (\`bin/learn pill\`). For any tutor or system: start from here rather than from zero, and treat it as evidence-based but fallible.`, ''];
  if (meta.goal) out.push(`**Goal, in their words:** ${portable(meta.goal)}`, '');
  out.push(`**Overall:** ${avg(leaves).toFixed(1)} / 5 across ${leaves.length} skills (target ${meta.target ?? 4}). Levels: ${LEVELS.map((l, i) => `${i} ${l}`).join(' · ')}. A level was raised only on evidence: two or more independent checks, at least one of them unprompted recall.`, '');

  out.push('## Skills', '');
  for (const b of meta.skills || []) {
    const kids = b.children?.length ? b.children : [b];
    out.push(`### ${b.id} ${b.name} (${avg(kids).toFixed(1)})`, '');
    const started = kids.filter(s => (s.level || 0) > 0 || s.summary), not = kids.filter(s => !started.includes(s));
    for (const s of started) {
      out.push(`- **${s.id} ${s.name}: ${s.level || 0}** (${LEVELS[s.level || 0]})`);
      const got = oneLine(s.summary);
      if (got.length) out.push(`  - Covered: ${got.join('; ')}`);
      if (s.notes) out.push(`  - Note: ${oneLine(s.notes).join(' ')}`);
    }
    if (not.length) out.push(`- Not started: ${not.map(s => `${s.id} ${s.name}`).join(', ')}`);
    out.push('');
  }

  if (meta.foundations?.length) {
    out.push('## Foundations from outside the topic', '');
    for (const f of meta.foundations) out.push(`- **${f.name}: ${f.level ?? '?'}**${f.why ? `. ${portable(f.why)}` : ''}`);
    out.push('');
  }

  const notes = S.readNotes(slug).items.filter(n => n.status === 'open');
  const skillName = id => { if (!id) return ''; const s = S.findSkill(meta, id); const f = (meta.foundations || []).find(x => x.id === id); return s ? ` (${s.id} ${s.name})` : f ? ` (${f.name})` : ''; };
  for (const [kind, title] of [['misconception', 'Misconceptions still being worked on'], ['hole', 'Suspected gaps'], ['review', 'Worth re-testing'], ['parked', 'Their own questions, parked for later']]) {
    const xs = notes.filter(n => n.kind === kind);
    if (xs.length) out.push(`## ${title}`, '', ...xs.map(n => `- ${portable(n.text)}${skillName(n.skill)}`), '');
  }

  // knowledge.md lines about this topic (cross-topic islands, shaky foundations, connections)
  const know = S.readText(path.join(S.LEARNER, 'knowledge.md'), '');
  const re = new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b|${(meta.title || slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const items = know.match(/^- .*(?:\n {2,}.*)*/gm) || [];
  const cross = items.filter(l => re.test(l));
  if (cross.length) out.push('## Across topics', '', ...cross.map(l => '- ' + portable(l.replace(/^- /, '').replace(/\n\s+/g, ' '))), '');

  const G = S.readGlossary(slug);
  if (G.length) out.push(`## Vocabulary they've met (${G.length} terms)`, '', G.map(g => g.term).join(', '), '');

  const prof = S.readText(path.join(S.LEARNER, 'profile.md'), '');
  const own = (prof.match(/^## In my own words[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1];
  const quote = own ? own.split('\n').filter(l => /^>/.test(l)).join('\n').trim() : '';
  // bold leads of the observations; a profile without them: the bullets under its learning sections
  let heads = [...prof.matchAll(/^- \*\*(.+?)\*\*/gm)].map(m => m[1].replace(/[.:]$/, ''));
  if (!heads.length) for (const m of prof.matchAll(/^## ([^\n]*)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm))
    if (/learn|prefer|observ/i.test(m[1]) && !/own words/i.test(m[1])) heads.push(...(m[2].match(/^- .+/gm) || []).map(l => l.slice(2).split(/(?<=\.)\s/)[0]));
  if (quote || heads.length) {
    out.push('## How they learn', '');
    if (quote) out.push('In their own words:', '', quote, '');
    if (heads.length) out.push('Observed by their tutors:', '', ...heads.map(x => `- ${portable(x)}`), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function write(slug) {
  S.ensureDir(PILLS);
  const f = path.join(PILLS, slug + '.md');
  fs.writeFileSync(f, pill(slug));
  return f;
}

module.exports = { pill, write, portable, PILLS };
