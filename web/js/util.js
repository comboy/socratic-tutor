// Shared helpers: DOM, skills, derived journal data.
export { h } from '../viz/core.js';
import { h } from '../viz/core.js';
import { metaIds, pendingQuestion, tracksState, applyCorrections, openQueue, trackOf } from './journal.js';

export const $ = (s, r = document) => r.querySelector(s);
// the key that sends and saves with Enter, as this keyboard calls it (both work everywhere)
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const store = {
  get(k, d) { try { const v = localStorage.getItem('learn:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('learn:' + k, JSON.stringify(v)); } catch {} },
};

// ---------- skills ----------
export function flatSkills(skills, depth = 0, parent = null, out = []) {
  for (const s of skills || []) { out.push({ ...s, depth, parent: parent?.id ?? null, node: s }); flatSkills(s.children, depth + 1, s, out); }
  return out;
}
export function levelOf(s) {
  if (s.children && s.children.length) {
    const ls = s.children.map(levelOf);
    return ls.reduce((a, b) => a + b, 0) / ls.length;
  }
  return Number(s.level || 0);
}
export function overall(meta) {
  const top = meta.skills || [];
  if (!top.length) return 0;
  return top.map(levelOf).reduce((a, b) => a + b, 0) / top.length;
}
export function skillById(meta, id) { return flatSkills(meta.skills).find(s => s.id === String(id)) || null; }
export function descendants(meta, id) {
  const s = skillById(meta, id);
  const ids = new Set([String(id)]);
  (function walk(n) { for (const c of n?.children || []) { ids.add(c.id); walk(c); } })(s?.node);
  return ids;
}
export function lvClass(l) { return 'l' + Math.max(0, Math.min(5, Math.round(Number(l) || 0))); }
// coloured chip with the level number (mastery colour scale)
export function lvChip(l, title) {
  return h('span', { class: 'lv ' + lvClass(l), title: title || `level ${fmtLevel(l)}/5 · ${LEVEL_NAMES[Math.round(l)] || ''}`, text: fmtLevel(l) });
}
// thin bar coloured by level, optional target marker
export function meter(l, target = null, cls = '') {
  const m = h('span', { class: `meter ${lvClass(l)} ${cls}`, title: `level ${fmtLevel(l)}/5` }, h('i', { style: { width: Math.max(0, Math.min(1, l / 5)) * 100 + '%' } }));
  if (target) m.append(h('span', { class: 'tgt', style: { left: `calc(${target / 5 * 100}% - 1px)` } }));
  return m;
}
export const levelBar = meter;
export function levelScale() {
  return h('span', { class: 'scale' }, ...[0, 1, 2, 3, 4, 5].map(l => h('span', { class: 'lv ' + lvClass(l), title: LEVEL_NAMES[l], text: l === 0 ? 'unknown' : `${l} ${['', 'heard', 'follow', 'with help', 'independent', 'teach'][l]}` })));
}
export function fmtLevel(l) { l = Number(l) || 0; return Number.isInteger(l) ? String(l) : l.toFixed(1); }
export const LEVEL_NAMES = ['unaware', 'heard of it', 'can follow along', 'can do with help', 'independent', 'can teach it'];

// ---------- dates ----------
export function fmtDate(d, opts = { month: 'short', day: 'numeric' }) {
  return new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, opts);
}
export function fmtTime(ts) { return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
export function daysAgo(ts) { return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000); }
export function relDays(ts) {
  const d = daysAgo(ts);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
export function shortId(id) { const [d, n] = String(id).split('.'); return `${fmtDate(d)} · #${n}`; }

// ---------- journal derivations ----------
export function derive(topic) {
  const J = applyCorrections(topic.journal);   // corrected messages read as corrected (journal.js)
  const byId = new Map(J.map(e => [e.id, e]));
  const grades = new Map();       // answer id -> grade entry
  for (const e of J) if (e.kind === 'grade') grades.set(e.target, e);
  const tags = topic.tags || {};
  // _meta: app talk ("About the app", --meta replies, tagged entries, the tags themselves): shown
  // dimmed in the thread, left out of the learning record (wiki, sessions, stats, term mentions)
  const meta = metaIds(J);
  for (const e of J) {
    const t = tags[e.id];
    e._skills = [...new Set([...(e.skills || []), ...(t || [])].map(String))];
    e._meta = meta.has(e.id);
  }
  // the open question; with two threads open, each thread's own (journal.js)
  const pending = pendingQuestion(J, null, meta);
  const tracks = tracksState(J);
  const pendingBy = tracks.open ? { a: pendingQuestion(J, 'a', meta), b: pendingQuestion(J, 'b', meta) } : null;
  // review questions waiting side by side in a thread (journal.js openQueue)
  const queue = openQueue(J, meta, tracks);
  const queueBy = { a: queue.filter(e => trackOf(e) === 'a'), b: queue.filter(e => trackOf(e) === 'b') };
  return { byId, grades, pending, tracks, pendingBy, queue, queueBy };
}
