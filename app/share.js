// Getting the code ready to share: the code repo is meant to be shareable (others run it with their
// own agent and their own topics), and personal data lives in the data home. These two commands
// help keep it that way and make the publishing step mechanical.
//
//   bin/learn share check [--history] [--terms] [--dir <repo>]   look for personal traces in the code repo
//   bin/learn share export <new-dir>                   a fresh repo with the current code, one commit
//
// check compares the tracked files (and with --history, every commit message and every path ever
// committed) against what's personal: your home path and user name, git identity, your topics'
// slugs and titles, with --terms multi-word glossary terms from your topics (mostly textbook words
// used as examples, so off by default), and data files (topics/, learner/,
// feedback.md, reports/) that were committed before data/ moved out. It's a list to look at, not a
// verdict: an example id in the docs is fine, a lesson pasted into a doc is not.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./store');

const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SKIP = /^(web\/vendor\/|test\/fixture\/)|\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf)$/i;

// What counts as personal, from the data home and the machine. -> [{ kind, re, label }]
function needles(dir, { terms = false } = {}) {
  const out = [];
  const add = (kind, s, label = s, flags = 'i') => { if (s && s.length >= 3) out.push({ kind, label, re: new RegExp(`(?<![\\w-])${esc(s)}(?![\\w-])`, flags) }); };
  add('home path', os.homedir(), os.homedir(), '');
  try { add('user name', os.userInfo().username); } catch {}
  for (const k of ['user.name', 'user.email']) { try { add('git identity', git(dir, 'config', k).trim()); } catch {} }
  // what the fixtures already use is synthetic by definition
  const fixture = new Set();
  try {
    const fx = path.join(S.CODE, 'test', 'fixture', 'topics');
    for (const t of fs.readdirSync(fx)) { fixture.add(t.toLowerCase()); for (const l of fs.readFileSync(path.join(fx, t, 'glossary.md'), 'utf8').split('\n')) { const m = l.match(/^##\s+(.+)$/); if (m) fixture.add(m[1].trim().toLowerCase()); } }
  } catch {}
  for (const slug of S.listTopics()) {
    let meta = {}; try { meta = S.loadTopicMeta(slug); } catch {}
    if (!fixture.has(slug.toLowerCase())) add('your topic', slug, slug, '');
    if (meta.title) add('your topic', meta.title);
    let G = []; try { G = S.readGlossary(slug); } catch {}
    if (terms) for (const g of G) if (/\s/.test(g.term.trim()) && g.term.length >= 8 && !fixture.has(g.term.toLowerCase())) add('term from your topics', g.term, `${g.term} (${slug})`);
  }
  return out;
}

function check({ dir = S.CODE, history = false, terms = false } = {}) {
  const N = needles(dir, { terms }), findings = [];
  const files = git(dir, 'ls-files', '-z').split('\0').filter(f => f && !SKIP.test(f));
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((ln, i) => { for (const n of N) if (n.re.test(ln)) findings.push({ where: `${f}:${i + 1}`, kind: n.kind, label: n.label, text: ln.trim().slice(0, 140) }); });
  }
  const hist = [];
  if (history) {
    let log = ''; try { log = git(dir, 'log', '--all', '--format=%h %s'); } catch {}
    for (const ln of log.split('\n').filter(Boolean)) {
      for (const n of N) if (n.re.test(ln)) hist.push({ where: 'commit ' + ln.split(' ')[0], kind: n.kind, label: n.label, text: ln.slice(0, 140) });
      if (/^\w+ Session \d/i.test(ln)) hist.push({ where: 'commit ' + ln.split(' ')[0], kind: 'lesson commit', label: '', text: ln.slice(0, 140) });
    }
    let paths = ''; try { paths = git(dir, 'log', '--all', '--format=', '--name-only'); } catch {}
    const data = [...new Set(paths.split('\n').filter(p => /^(topics|learner|reports)\/|^feedback\.md$|^data\//.test(p)))];
    if (data.length) hist.push({ where: 'history', kind: 'data files in history', label: '', text: `${data.length} path(s), e.g. ${data.slice(0, 4).join(', ')}` });
  }
  return { files: files.length, findings, history: hist };
}

function exportTo(dest) {
  if (!dest) throw new Error('usage: share export <new-dir>');
  dest = path.resolve(dest);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error(`${dest} is not empty`);
  if (dest === S.CODE || dest.startsWith(S.CODE + path.sep)) throw new Error('export somewhere outside this checkout');
  const dirty = git(S.CODE, 'status', '--porcelain', '--untracked-files=no').trim();
  fs.mkdirSync(dest, { recursive: true });
  const files = git(S.CODE, 'ls-files', '-z').split('\0').filter(Boolean);
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true }); fs.copyFileSync(path.join(S.CODE, f), path.join(dest, f)); }
  git(dest, 'init', '-q');
  git(dest, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', 'Initial commit'], { cwd: dest, stdio: 'ignore' });
  return { dest, files: files.length, dirty: !!dirty };
}

function cli(argv) {
  const [sub, ...rest] = argv;
  const opt = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  if (sub === 'check') {
    const r = check({ dir: path.resolve(opt('--dir') || S.CODE), history: rest.includes('--history'), terms: rest.includes('--terms') });
    const all = [...r.findings, ...r.history];
    if (!all.length) { console.log(`share check: ${r.files} tracked files${rest.includes('--history') ? ' and history' : ''}, nothing personal found`); return; }
    const by = new Map(); for (const f of all) (by.get(f.kind) || by.set(f.kind, []).get(f.kind)).push(f);
    for (const [kind, list] of by) {
      console.log(`\n${kind} (${list.length}):`);
      for (const f of list.slice(0, 25)) console.log(`  ${f.where}${f.label ? `  [${f.label}]` : ''}  ${f.text}`);
      if (list.length > 25) console.log(`  … ${list.length - 25} more`);
    }
    if (r.history.length) console.log('\nThe history has personal traces: publish with `bin/learn share export <dir>` (a fresh repo, one commit) rather than pushing this one.');
    process.exitCode = 1;
  } else if (sub === 'export') {
    const r = exportTo(rest.find(a => !a.startsWith('-')));
    console.log(`exported ${r.files} files to ${r.dest} (fresh git repo, one commit)${r.dirty ? '\nnote: this checkout has uncommitted changes; the export copied the working files as they are' : ''}\nnext: bin/learn share check --dir ${r.dest}`);
  } else throw new Error('usage: share check [--history] [--dir repo] · share export <new-dir>');
}

module.exports = { check, exportTo, cli };
