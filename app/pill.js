// A "knowledge pill": what the learner understands in one topic, as one portable markdown file for
// any other tutor, agent or tool. Its reader knows the subject, so the pill never explains the
// subject: it says what this learner has shown they understand, how well (unprompted, after a
// narrower question, with help), what they got wrong, what they hold mistakenly, and what they
// haven't shown yet. Generated from the evidence in the workspace (level changes with reasons,
// graded checks with notes, misconceptions, notes, knowledge.md, profile.md), so it's as current as
// they are and nothing in it is hand-kept. Workspace-specific bits (msg: links, message and note
// ids) are stripped: they mean nothing elsewhere.
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
    .replace(/(?:\s+(?:in|at|from|since|see|over|after|across)\b)?(?:\s+msg)?(?:\s+[a-z][a-z0-9-]*(?=\s+\d{4}-))?\s*\b\d{4}-\d{2}-\d{2}\.\d+(?:\s*[–→-]\s*\.?\d+)?\b/g, '')
    .replace(/(?:\s+(?:in|at|from|since|see|over|after|across)\s+|(?<=[\s(,;]|^))\.\d+(?:\s*[–→-]\s*\.?\d+)?\b/gm, '')
    .replace(/(?<![\w.])n\d+\b/g, '')
    .replace(/\(\s*msg\s*(?:[a-z][a-z0-9-]*)?\s*\)/g, '')
    .replace(/\(\s*(?:[,;/]\s*|and\s+|also\s+)*\)/g, '').replace(/\(\s*(?:[,;:]\s*)+/g, '(').replace(/(?:\s*[,;])+\s*\)/g, ')')
    .replace(/ {2,}/g, ' ').replace(/ +([,.;:)])/g, '$1').trim();
}
const oneLine = t => portable(t).replace(/^\s*[-*]\s+/gm, '').split('\n').map(s => s.trim()).filter(Boolean);

// A summary line about the learner rather than the subject: older sessions recorded evidence inside
// the skill summaries ("You derived …", "Diagnostic: you knew …"). -> third person, or null.
function aboutThem(line) {
  return /\b(you|your|yourself|learner)\b/i.test(line) ? third(line).replace(/^Diagnostic: /, 'In the diagnostic: ') : null;
}
// The tutor wrote to the learner ("you"); the pill is about them.
function third(t) {
  const cap = (m, w) => m[0] === m[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
  return t.replace(/\b(you're|you've|you'd|yourself|your|you)\b/gi, m => cap(m, { "you're": "they're", "you've": "they've", "you'd": "they'd", yourself: 'themselves', your: 'their', you: 'they' }[m.toLowerCase()]));
}
const MARK = { correct: '✓', partial: '◐', wrong: '✗', skipped: '–' };
const MAX_CHECKS = 6;

function pill(slug) {
  const meta = S.loadTopicMeta(slug);
  const J = S.readJournal(slug);
  const leaves = []; S.walkSkills(meta.skills, s => { if (!s.children?.length) leaves.push(s); });
  const avg = xs => xs.length ? xs.reduce((a, s) => a + (s.level || 0), 0) / xs.length : 0;
  const ids = e => String(e.skill || '').split(',').map(x => x.trim());
  const grades = id => J.filter(e => e.kind === 'grade' && ids(e).includes(id) && e.note);
  const lastLevel = id => J.filter(e => e.kind === 'level' && e.skill === id && e.reason).pop();
  const out = [`# What I understand: ${meta.title || slug}`, '',
    `What one learner has shown they understand in this topic, generated ${S.localDate()} from their tutoring sessions (\`bin/learn pill\`). It's written for a reader who knows the subject: nothing here explains the subject; it says what they understand and how well, so you can start from there instead of from zero. Evidence-based but fallible.`, '',
    `How to read it: each skill has a level (${LEVELS.map((l, i) => `${i} ${l}`).join(' · ')}), raised only on two or more independent checks, at least one of them unprompted recall. Under it, the recorded checks: ✓ right, ◐ partly right, ✗ wrong; "after narrowing" means it took a narrower follow-up question. Then difficulties and misconceptions (resolved or still held), and parts of the skill not covered yet (the tutor's list; it can lag behind the lessons).`, ''];
  if (meta.goal) out.push(`**Their goal, in their words:** ${portable(meta.goal)}`, '');
  out.push(`**Overall:** ${avg(leaves).toFixed(1)} / 5 across ${leaves.length} skills (target ${meta.target ?? 4}).`, '');

  out.push('## Skills', '');
  for (const b of meta.skills || []) {
    const kids = b.children?.length ? b.children : [b];
    out.push(`### ${b.id} ${b.name} (${avg(kids).toFixed(1)})`, '');
    const started = kids.filter(s => (s.level || 0) > 0), not = kids.filter(s => !started.includes(s));
    for (const s of started) {
      const lv = lastLevel(s.id);
      out.push(`- **${s.id} ${s.name}: ${s.level}/5** (${LEVELS[s.level]})${lv ? `. Why: ${third(portable(lv.reason))}` : ''}`);
      const G = grades(s.id);
      if (G.length > MAX_CHECKS) out.push(`  - (${G.length - MAX_CHECKS} earlier checks)`);
      for (const g of G.slice(-MAX_CHECKS)) out.push(`  - ${MARK[g.verdict] || g.verdict} ${third(portable(g.note))}`);
      for (const l of oneLine(s.summary).map(aboutThem).filter(Boolean)) out.push(`  - ${l}`);
      for (const m of s.misconceptions || []) out.push(`  - Difficulty: ${third(portable(m))}`);
      for (const u of s.unknown || []) out.push(`  - Not covered yet: ${third(portable(u))}`);
      if (s.notes) out.push(`  - Note: ${oneLine(s.notes).join(' ')}`);
      if (!lv && !G.length && !out[out.length - 1].startsWith('  - ')) out.push('  - No recorded evidence (level set in early sessions, before checks were logged).');
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
  if (G.length) out.push(`## Terms they've been taught (${G.length})`, '', 'Safe to use with them; each was defined in a lesson, though a reminder may be needed.', '', G.map(g => g.term).join(', '), '');

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
