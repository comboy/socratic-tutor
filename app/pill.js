// A "knowledge pill": where the learner stands in one topic, as one short markdown file to hand to
// any other chat, tutor or agent, so it knows at what level to talk to them. The reader knows the
// subject, so the pill never explains it, and it isn't the learning process either (that's this
// workspace's job): it's the established result. Per topic: skills grouped by level, foundations,
// what was corrected recently and may not have stuck, how they like to be taught. Many pills
// together are a picture of the person. Generated from the workspace (levels, notes, profile.md),
// never hand-kept; workspace ids are stripped.
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

// The tutor wrote to the learner ("you"); the pill is about them.
function third(t) {
  const cap = (m, w) => m[0] === m[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
  return t.replace(/\b(you're|you've|you'd|yourself|your|you)\b/gi, m => cap(m, { "you're": "they're", "you've": "they've", "you'd": "they'd", yourself: 'themselves', your: 'their', you: 'they' }[m.toLowerCase()]));
}
// a note's gist: its first clause, without the bookkeeping that follows ("Corrected in …", "re-check …")
const gist = t => third(portable(t)).replace(/\s*\(\d+(?:\.\d+)*\)/g, '').split(/(?<=[a-z)\]'"])[.;] /)[0].replace(/[.;]\s*$/, '');
const MAX_CORRECTED = 8;

function pill(slug) {
  const meta = S.loadTopicMeta(slug);
  const leaves = []; S.walkSkills(meta.skills, s => { if (!s.children?.length) leaves.push(s); });
  const avg = leaves.length ? leaves.reduce((a, s) => a + (s.level || 0), 0) / leaves.length : 0;
  const out = [`# What I understand: ${meta.title || slug}`, '',
    `Where one learner stands in this topic (${S.localDate()}), for a reader who knows the subject: pitch explanations at this level. Levels rose only on evidence (two or more checks, one of them unprompted recall), so they're conservative rather than flattering.`, ''];
  if (meta.goal) out.push(`**Why they're learning it:** ${third(portable(meta.goal))}`, '');
  out.push(`**Overall:** ${avg.toFixed(1)} / 5 across ${leaves.length} skills (target ${meta.target ?? 4}).`, '');

  for (let lv = 5; lv >= 0; lv--) {
    const xs = leaves.filter(s => (s.level || 0) === lv);
    if (xs.length) out.push(`**${lv ? `${LEVELS[lv][0].toUpperCase() + LEVELS[lv].slice(1)} (${lv})` : 'Not yet'}:** ${xs.map(s => s.name).join(' · ')}`, '');
  }
  if (meta.foundations?.length) out.push(`**Foundations:** ${meta.foundations.map(f => `${f.name} ${f.level ?? '?'}`).join(' · ')}`, '');

  // open misconceptions: corrected once, not yet re-checked, so they may still hold
  const mis = S.readNotes(slug).items.filter(n => n.status === 'open' && n.kind === 'misconception').map(n => gist(n.text)).filter(Boolean).map(m => m[0].toUpperCase() + m.slice(1));
  if (mis.length) out.push('**Recently corrected, may not have stuck yet:**', '', ...mis.slice(-MAX_CORRECTED).map(m => `- ${m}`), '');

  const prof = S.readText(path.join(S.LEARNER, 'profile.md'), '');
  const own = (prof.match(/^## In my own words[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1];
  const quote = own ? own.split('\n').filter(l => /^>/.test(l)).map(l => l.replace(/^>\s?/, '')).join(' ').replace(/\s+/g, ' ').trim() : '';
  // the profile's sections: background as is; from the ones about learning, the bold lead of each
  // observation (or its first sentence). Sections about this app (workspace, interface) stay out.
  const secs = [...prof.matchAll(/^## ([^\n]*)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map(m => ({ title: m[1], body: m[2] }));
  const bullets = body => (body.match(/^- .+(?:\n {2,}\S.*)*/gm) || []).map(l => l.slice(2).replace(/\n\s+/g, ' '));
  // an observation's lead: its bold opening, else its first clause; dates and emphasis dropped
  const lead = l => { const b = l.match(/^\*\*(.+?)\*\*/); return (b ? b[1] : l.replace(/\*\*/g, '').split(/\.\s|;\s|:\s*"|\s\(\d{4}-/)[0]).replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)/g, '').replace(/[.:]$/, '').trim(); };
  const background = secs.filter(x => /^background/i.test(x.title)).flatMap(x => bullets(x.body)).map(l => third(portable(l)));
  const heads = secs.filter(x => !/own words|background|workspace|interface/i.test(x.title)).flatMap(x => bullets(x.body))
    .map(lead);
  if (quote || heads.length || background.length) {
    out.push('**About them:**', '');
    if (background.length) out.push(...background.map(b => `- ${b}`), '');
    if (quote) out.push('How they want to be talked to, in their words:', '', `> ${quote}`, '');
    if (heads.length) out.push(`Their tutors noticed: ${heads.map(x => portable(x)).join('; ')}.`, '');
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
