// Shared storage layer: topics, journal, glossary parsing, notes, inbox, feedback. No dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// CODE: this checkout (app/, web/, docs/): shareable, no personal data.
// ROOT: the learner's data home (topics/, learner/, feedback.md, reports/, state/). Defaults to
// data/ inside the checkout, which is gitignored there and is its own git repo. LEARN_HOME points
// elsewhere (tests, demo, or data kept in some other place).
const CODE = path.resolve(__dirname, '..');
const ROOT = path.resolve(process.env.LEARN_HOME || path.join(CODE, 'data'));
const TOPICS = path.join(ROOT, 'topics');
const LEARNER = path.join(ROOT, 'learner');         // cross-topic: profile.md, knowledge.md
const REPORTS = path.join(ROOT, 'reports');         // output of background jobs (bin/learn away)
const FEEDBACK = path.join(ROOT, 'feedback.md');    // meta feedback queue for the builder
const CONFIG = path.join(ROOT, 'config.json');      // optional: agent choice etc.
const STATE = path.join(ROOT, 'state');             // runtime only, gitignored
const INBOX = path.join(STATE, 'inbox');
const PORT = Number(process.env.LEARN_PORT || 4747);

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function readText(p, dflt = null) { try { return fs.readFileSync(p, 'utf8'); } catch { return dflt; } }
function readJSON(p, dflt = null) {
  const t = readText(p);
  if (t == null) return dflt;
  try { return JSON.parse(t); } catch (e) { throw new Error(`Bad JSON in ${p}: ${e.message}`); }
}
function writeJSON(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}
function config() { try { return readJSON(CONFIG, {}) || {}; } catch { return {}; } }

// Local calendar date, YYYY-MM-DD
function localDate(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// ---------- data home ----------
// Create the data home on first use: folders, a .gitignore for runtime state, starter learner files,
// and a git repo (the data is versioned separately from the code, so the code can be shared).
function ensureHome() {
  ensureDir(TOPICS); ensureDir(LEARNER); ensureDir(STATE);
  const gi = path.join(ROOT, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'state/\n.DS_Store\n');
  const prof = path.join(LEARNER, 'profile.md');
  if (!fs.existsSync(prof)) fs.writeFileSync(prof, PROFILE_TEMPLATE);
  const know = path.join(LEARNER, 'knowledge.md');
  if (!fs.existsSync(know)) fs.writeFileSync(know, KNOWLEDGE_TEMPLATE);
  if (!fs.existsSync(path.join(ROOT, '.git')) && !process.env.LEARN_NO_GIT) {
    try { execFileSync('git', ['init', '-q'], { cwd: ROOT, stdio: 'ignore' }); } catch {}
  }
}
const PROFILE_TEMPLATE = `# Learner profile

Who the learner is and how they like to be taught. Shared by every topic. Tutors read it at the start
of a session; edit it freely. Keep it short.

## In my own words (authoritative)

Written by the learner. Agents: never edit or paraphrase this section; propose changes instead.

## Background

## Observations so far (derived, could be wrong: use judgement)

## Interface preferences (derived)
`;
const KNOWLEDGE_TEMPLATE = `# Knowledge across topics

What the learner knows across all topics: islands of solid knowledge, shaky foundations, and links
between topics worth making. Maintained by the tutors and the reviewer job (\`bin/learn away\`).
Keep it short: one line per item, with the topic and skill ids.

## Solid

## Shaky foundations

## Connections worth making

## Suggested topics
`;

// Commit everything in the data home (its own repo). Returns the git output or a reason it didn't.
function commitData(message) {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return 'data home is not a git repo';
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  git('add', '-A');
  if (!git('status', '--porcelain').trim()) return 'nothing to commit';
  return git('commit', '-q', '-m', message || 'Update learning data').trim() || 'committed';
}

// ---------- topics ----------
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
function listTopics() {
  if (!fs.existsSync(TOPICS)) return [];
  return fs.readdirSync(TOPICS).filter(s => SLUG.test(s) && fs.existsSync(path.join(TOPICS, s, 'topic.json'))).sort();
}
function topicDir(slug) {
  if (!SLUG.test(slug || '')) throw new Error(`bad topic slug: ${slug}`);
  return path.join(TOPICS, slug);
}
function loadTopicMeta(slug) { return readJSON(path.join(topicDir(slug), 'topic.json')); }
function saveTopicMeta(slug, meta) { writeJSON(path.join(topicDir(slug), 'topic.json'), meta); }

function slugify(text) {
  const stop = new Set(['a', 'an', 'the', 'how', 'to', 'of', 'and', 'i', 'want', 'learn', 'about', 'in', 'on', 'for', 'what', 'is', 'are', 'do', 'does', 'work', 'works', 'understand', 'me', 'my', 'some', 'basics']);
  const words = String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, ' ').split(/[\s_]+/).filter(w => w && !stop.has(w));
  let s = words.slice(0, 3).join('-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'topic';
  if (!/^[a-z0-9]/.test(s)) s = 't-' + s;
  if (s === 'new') s = 'new-topic';   // #/new is the new-topic page
  let out = s, i = 2;
  while (fs.existsSync(path.join(TOPICS, out))) out = `${s}-${i++}`;
  return out;
}

// Scaffold a new topic with valid empty files (passes `bin/learn check`).
function createTopic(slug, title, extra = {}) {
  ensureHome();
  const d = topicDir(slug);
  if (fs.existsSync(path.join(d, 'topic.json'))) throw new Error(`topic ${slug} exists`);
  title = title || slug;
  ensureDir(path.join(d, 'journal'));
  writeJSON(path.join(d, 'topic.json'), { title, target: 4, focus: null, created: localDate(), ...extra, skills: [] });
  fs.writeFileSync(path.join(d, 'glossary.md'), `# Glossary\n`);
  fs.writeFileSync(path.join(d, 'cheatsheet.md'), `# ${title}: cheat sheet\n`);
  fs.writeFileSync(path.join(d, 'progress.md'), `# ${title}\n\n## Resume here (read first)\n\nNew topic: no diagnostic yet (see docs/bootstrap.md).\n`);
  fs.writeFileSync(path.join(d, 'log.md'), `# ${title}: session log\n`);
  writeJSON(path.join(d, 'map.json'), { title, cols: 6, groups: [], nodes: [], edges: [] });
  writeJSON(path.join(d, 'notes.json'), { next: 1, items: [] });
  return d;
}

function walkSkills(skills, fn, parent = null) {
  for (const s of skills || []) { fn(s, parent); walkSkills(s.children, fn, s); }
}
function findSkill(meta, id) {
  let found = null;
  walkSkills(meta.skills, s => { if (s.id === String(id)) found = s; });
  return found;
}
function leafSkills(meta) { const out = []; walkSkills(meta.skills, s => { if (!s.children?.length) out.push(s); }); return out; }

// ---------- pages/<name>.md: standalone wiki pages ----------
// Markdown with the usual extensions (viz blocks, links). Title: the first "# " heading, else the name.
const PAGE_NAME = /^[a-z0-9][a-z0-9-]*$/;
function readPages(slug) {
  const d = path.join(topicDir(slug), 'pages');
  let files = [];
  try { files = fs.readdirSync(d).filter(f => f.endsWith('.md') && PAGE_NAME.test(f.slice(0, -3))).sort(); } catch { return []; }
  return files.map(f => {
    const text = readText(path.join(d, f), '');
    const m = text.match(/^#\s+(.+)$/m);
    return { name: f.slice(0, -3), title: m ? m[1].trim() : f.slice(0, -3), text, mtime: fs.statSync(path.join(d, f)).mtime.toISOString() };
  });
}

// ---------- glossary.md parser ----------
// full: expansion of an acronym/name (inline markdown, e.g. "**P**roximal **P**olicy **O**ptimization")
// parts: sub-terms the expansion or definition is built from (comma list of glossary terms)
const META_KEYS = new Set(['aliases', 'skill', 'size', 'see', 'refs', 'full', 'parts']);
const LIST_KEYS = ['aliases', 'see', 'refs', 'parts'];
function parseGlossary(md) {
  if (!md) return [];
  const out = [];
  const parts = md.split(/^## +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const term = (nl < 0 ? part : part.slice(0, nl)).trim();
    let lines = (nl < 0 ? '' : part.slice(nl + 1)).replace(/^\s*\n/, '').split('\n');
    const entry = { term, aliases: [], see: [], refs: [], parts: [], skill: null, size: null, full: null, short: '', body: '' };
    let i = 0;
    for (; i < lines.length; i++) {
      const m = lines[i].match(/^([a-z]+):\s*(.*)$/);
      if (!m || !META_KEYS.has(m[1])) break;
      const v = m[2].trim();
      if (LIST_KEYS.includes(m[1])) entry[m[1]] = v ? v.split(',').map(x => x.trim()).filter(Boolean) : [];
      else entry[m[1]] = v && v !== '—' ? v : null;
    }
    entry.skills = entry.skill ? entry.skill.split(',').map(x => x.trim()).filter(Boolean) : [];
    entry.skill = entry.skills[0] || null;
    const rest = lines.slice(i).join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    const para = rest.split(/\n\s*\n/);
    entry.short = (para[0] || '').trim();
    entry.body = para.slice(1).join('\n\n').trim();
    out.push(entry);
  }
  return out;
}
function glossaryPath(slug) { return path.join(topicDir(slug), 'glossary.md'); }
function readGlossary(slug) { return parseGlossary(readText(glossaryPath(slug), '')); }
// Append a glossary entry. Refuses a term (or alias) that already exists.
function addTerm(slug, { term, short, body, ...meta }) {
  term = String(term || '').trim();
  if (!term) throw new Error('term name required');
  if (!short || !String(short).trim()) throw new Error('short definition required (--short)');
  const forms = new Map();
  for (const g of readGlossary(slug)) for (const f of [g.term, ...g.aliases]) forms.set(f.toLowerCase(), g.term);
  for (const f of [term, ...(meta.aliases || [])]) if (forms.has(f.toLowerCase())) throw new Error(`"${f}" is already in the glossary (entry "${forms.get(f.toLowerCase())}")`);
  const lines = [`## ${term}`];
  for (const k of ['full', 'aliases', 'skill', 'parts', 'see', 'refs', 'size']) {
    const v = meta[k];
    if (v == null || (Array.isArray(v) && !v.length) || v === '') continue;
    lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }
  lines.push(String(short).trim().replace(/\n\s*\n/g, ' '));
  if (body && String(body).trim()) lines.push('', String(body).trim());
  const cur = readText(glossaryPath(slug), '# Glossary\n');
  fs.writeFileSync(glossaryPath(slug), cur.replace(/\s*$/, '\n\n') + lines.join('\n') + '\n');
  return lines.join('\n');
}

// ---------- notes.json: the tutor's working model of the learner, per topic ----------
// { next, items: [{ id, kind, skill, text, ref, created, due, status: open|done, outcome, closed }] }
//   review         re-test this later (spaced review), optional due date
//   hole           a suspected gap in understanding, worth probing some time; not urgent
//   parked         a question the learner asked that was deferred
//   misconception  a confusion that came up; closed when resolved
const NOTE_KINDS = ['review', 'hole', 'parked', 'misconception'];
function notesPath(slug) { return path.join(topicDir(slug), 'notes.json'); }
function readNotes(slug) {
  const n = readJSON(notesPath(slug), null) || { next: 1, items: [] };
  n.items = n.items || [];
  n.next = n.next || n.items.length + 1;
  return n;
}
function addNote(slug, { kind, text, skill = null, ref = null, due = null }) {
  if (!NOTE_KINDS.includes(kind)) throw new Error(`note kind must be one of ${NOTE_KINDS.join('|')}`);
  if (!String(text || '').trim()) throw new Error('note text required');
  const n = readNotes(slug);
  const item = { id: 'n' + n.next++, kind, skill: skill ? String(skill) : null, text: String(text).trim(), ref, created: localDate(), status: 'open' };
  if (due) item.due = due;
  n.items.push(item);
  writeJSON(notesPath(slug), n);
  return item;
}
function closeNote(slug, id, outcome = '') {
  const n = readNotes(slug);
  const it = n.items.find(x => x.id === id);
  if (!it) throw new Error(`no note ${id} in ${slug}`);
  Object.assign(it, { status: 'done', closed: localDate() }, outcome ? { outcome } : {});
  writeJSON(notesPath(slug), n);
  return it;
}
// "3d", "1w", "2026-12-01" -> YYYY-MM-DD
function parseDue(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = String(s).match(/^(\d+)\s*([dw])$/);
  if (!m) throw new Error(`bad due "${s}" (use 3d, 2w or YYYY-MM-DD)`);
  return localDate(new Date(Date.now() + Number(m[1]) * (m[2] === 'w' ? 7 : 1) * 86400e3));
}

// ---------- log.md: dated session log (append-only; read on demand, not at startup) ----------
function appendLog(slug, text) {
  const f = path.join(topicDir(slug), 'log.md');
  let cur = readText(f, null);
  if (cur == null) cur = `# ${loadTopicMeta(slug).title}: session log\n`;
  const head = `### ${localDate()}`;
  const lastHead = (cur.match(/^### .+$/gm) || []).pop();
  const lines = String(text).trim().split('\n').map((l, i) => (i ? '  ' + l : '- ' + l.replace(/^- /, ''))).join('\n');
  fs.writeFileSync(f, cur.replace(/\s*$/, '\n') + (lastHead === head ? '' : `\n${head}\n`) + lines + '\n');
}

// ---------- journal ----------
function journalDir(slug) { return path.join(topicDir(slug), 'journal'); }
function journalFiles(slug) {
  const d = journalDir(slug);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
}
function readJournalFile(slug, file) {
  const t = readText(path.join(journalDir(slug), file), '');
  const out = [];
  for (const line of t.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn line */ }
  }
  return out;
}
function readJournal(slug) {
  return journalFiles(slug).flatMap(f => readJournalFile(slug, f));
}
// Append entries (without ids) to a topic journal; assigns ids "<date>.<n>". Returns entries.
function appendJournal(slug, entries, date = localDate()) {
  ensureDir(journalDir(slug));
  const file = path.join(journalDir(slug), `${date}.jsonl`);
  const existing = readJournalFile(slug, `${date}.jsonl`);
  let n = existing.reduce((mx, e) => Math.max(mx, Number(String(e.id).split('.').pop()) || 0), 0);
  const out = entries.map(e => ({ id: `${date}.${++n}`, ts: e.ts || new Date().toISOString(), ...e, topic: slug }));
  fs.appendFileSync(file, out.map(e => JSON.stringify(e)).join('\n') + '\n');
  return out;
}
// `id` may be "<date>.<n>" (searched in `slug` first, then every topic) or "<topic>/<date>.<n>".
function findEntry(id, slug = null) {
  id = String(id);
  const m = id.match(/^([a-z0-9][a-z0-9-]*)\/(.+)$/);
  if (m) { slug = m[1]; id = m[2]; }
  const date = id.split('.')[0];
  const order = slug ? [slug, ...listTopics().filter(t => t !== slug)] : listTopics();
  for (const t of m ? [slug] : order) {
    if (!fs.existsSync(path.join(journalDir(t), `${date}.jsonl`))) continue;
    const e = readJournalFile(t, `${date}.jsonl`).find(x => x.id === id);
    if (e) return e;
  }
  return null;
}
function lastEntry(pred, slugs = listTopics()) {
  // newest first across the given topics (by ts)
  let best = null;
  for (const slug of slugs) {
    const files = journalFiles(slug);
    for (let i = files.length - 1; i >= 0; i--) {
      const es = readJournalFile(slug, files[i]).filter(pred);
      if (es.length) {
        const e = es[es.length - 1];
        if (!best || e.ts > best.ts) best = e;
        break;
      }
    }
  }
  return best;
}
// The open question: the last tutor question not followed by an answer to it.
function pendingQuestion(J) {
  let pending = null;
  for (const e of J) {
    if (e.role === 'tutor' && e.kind === 'message' && e.question) pending = e;
    else if (e.role === 'user' && e.kind === 'answer' && pending && (!e.replyTo || e.replyTo === pending.id)) pending = null;
  }
  return pending;
}

// ---------- inbox (learner -> tutor) ----------
// One file per message; `bin/learn wait` claims them by atomic rename.
function enqueue(entry) {
  ensureDir(INBOX);
  const f = path.join(INBOX, `${Date.now()}-${entry.id}.json`);
  fs.writeFileSync(f + '.tmp', JSON.stringify(entry));
  fs.renameSync(f + '.tmp', f);
}
function inboxIds() {
  try { return fs.readdirSync(INBOX).filter(f => f.endsWith('.json')).map(f => f.replace(/^\d+-/, '').replace(/\.json$/, '')); }
  catch { return []; }
}

// ---------- meta feedback (learner or tutor -> builder) ----------
// feedback.md in the data home: a checklist the builder job works through (`- [ ]` open, `- [x]`
// done). The learner adds items with the UI's feedback box, the tutor with `bin/learn feedback`.
// Never journaled or queued for the tutor.
function appendFeedback(text, context, source = 'learner') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').trim().split('\n').map(l => l.trimEnd());
  if (!lines.join('').trim()) throw new Error('empty');
  if (lines.join('\n').length > 4000) throw new Error('too long (4000 characters max)');
  const ctx = String(context || '').replace(/[\s()]+/g, ' ').trim().slice(0, 80);
  const bullet = `- [ ] ${localDate()} (${source}${ctx ? ', ' + ctx : ''}): ` + lines.map((l, i) => (i && l ? '      ' + l : l)).join('\n');
  ensureDir(ROOT);
  const cur = readText(FEEDBACK, null);
  const head = cur == null ? FEEDBACK_HEAD : cur && !cur.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(FEEDBACK, head + bullet + '\n');
  return { ok: true, file: path.relative(ROOT, FEEDBACK), bullet };
}
const FEEDBACK_HEAD = `# Feedback for the builder

Remarks about the app and the learning process, from the learner (feedback box in the UI) and the
tutor (\`bin/learn feedback\`). The builder job (\`bin/learn away\`, or the "I'm away" button) works
through the open items: \`- [ ]\` open, \`- [x]\` done, with a note on what was done.

`;
function openFeedback() {
  return (readText(FEEDBACK, '').match(/^- \[ \] .*(?:\n {2,}.*)*/gm) || []);
}

// ---------- tutor message analysis ----------
function hasQuestion(md) { return /^:::question\b/m.test(md || ''); }

// ---------- levels ----------
function setLevel(slug, skillId, level, reason) {
  const meta = loadTopicMeta(slug);
  const s = findSkill(meta, skillId);
  if (!s) throw new Error(`no skill ${skillId} in ${slug}`);
  if (s.children && s.children.length) throw new Error(`skill ${skillId} has children; set a child's level`);
  const from = s.level ?? 0;
  s.level = Number(level);
  saveTopicMeta(slug, meta);
  return appendJournal(slug, [{ role: 'tutor', kind: 'level', skill: String(skillId), from, to: s.level, reason: reason || '' }])[0];
}

module.exports = {
  CODE, ROOT, TOPICS, LEARNER, REPORTS, FEEDBACK, CONFIG, STATE, INBOX, PORT,
  ensureDir, readText, readJSON, writeJSON, localDate, config, ensureHome, commitData,
  listTopics, topicDir, slugify, createTopic, readPages, PAGE_NAME, loadTopicMeta, saveTopicMeta,
  walkSkills, findSkill, leafSkills, parseGlossary, readGlossary, addTerm, META_KEYS,
  NOTE_KINDS, readNotes, addNote, closeNote, parseDue, appendLog,
  journalDir, journalFiles, readJournal, readJournalFile, appendJournal, findEntry, lastEntry, pendingQuestion,
  hasQuestion, setLevel, enqueue, inboxIds, appendFeedback, openFeedback,
};
