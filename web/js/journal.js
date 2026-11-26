// Journal helpers shared by the UI (util.js) and the CLI/server (app/store.js, via require). No DOM.

// App talk ("About the app"): kept in the journal, but out of the learning record (wiki, session
// pages, stats, `msgs`, `resume`). An entry is meta when
//  - it says so: "meta": true (the learner's "About the app" message, kind "meta", or a tutor
//    reply posted with `bin/learn post --meta`),
//  - it is a tag entry itself (kind "tag": bookkeeping), or
//  - a tag entry { kind: "tag", tag: "meta", ids: [...] } names it (`bin/learn meta <id>…`), and
//    no later one with "off": true takes it back. Tags are appended; entries are never rewritten.
export function metaIds(J) {
  const out = new Set();
  for (const e of J) {
    if (e.meta === true || e.kind === 'tag') out.add(e.id);
    if (e.kind === 'tag' && e.tag === 'meta') for (const id of e.ids || []) { if (e.off) out.delete(id); else out.add(id); }
  }
  return out;
}

// Two threads (an experiment against reply latency, docs/method.md "Two threads"): next to the
// main thread "a" the tutor can open a second, closely related thread "b". When the learner answers
// in one, the UI takes them to the other, where the tutor's reply is usually already waiting, so
// the tutor writes while they read instead of them waiting while it writes. Entries carry
// "track": "a" | "b" (none = "a"). Whether two threads are open is replayed from
// { kind: "tracks", open: true | false, titles: { a, b } } entries (`bin/learn track`).
export const trackOf = e => (e && e.track === 'b' ? 'b' : 'a');
export function tracksState(J) {
  let st = { open: false, titles: { a: '', b: '' }, since: null };
  for (const e of J) {
    if (e.kind !== 'tracks') continue;
    st = e.open ? { open: true, titles: { ...st.titles, ...(e.titles || {}) }, since: st.open ? st.since : e.ts }
      : { ...st, open: false };
  }
  return st;
}
// The learner's last message in a view (a thread, or the whole conversation) if no tutor reply
// to it has come yet, else null. A reply is a later tutor message that names it (replyTo: an
// app-talk reply posted with --meta has no thread, so the thread alone can't say) or, for a
// lesson message, a later lesson message in the same thread.
const LEARNER_KINDS = ['answer', 'ask', 'action', 'start', 'meta'];
export function awaitingReply(J, track = null) {
  let u = null;
  for (let i = J.length - 1; i >= 0; i--) {
    const e = J[i];
    if (e.role === 'user' && !e.imported && LEARNER_KINDS.includes(e.kind) && (!track || trackOf(e) === track)) { u = e; break; }
  }
  if (!u) return null;
  const answered = J.some(e => e.role === 'tutor' && e.kind === 'message' && e.ts >= u.ts && e.id !== u.id
    && (e.replyTo === u.id || (!e.meta && (!track || trackOf(e) === track))));
  return answered ? null : u;
}

// The open question: the last tutor question not followed by an answer to it (app talk never is
// one). With a track: that thread's open question.
// A grade that names its question (questionId) has the last word on which question a message
// answered: an answer typed in the Ask box, or sent in the other thread, is graded with
// `post --grade-of <id>`, and that grade closes the question it was for, and not the one the UI
// attached the message to (which stays, or becomes, open). For an answer sent the usual way the
// grade names the same question the answer did, so nothing changes.
export function pendingQuestion(J, track = null, meta = metaIds(J)) {
  const answered = new Map();   // learner message -> the question its grade says it answered
  for (const e of J) if (e.kind === 'grade' && e.questionId && e.target) answered.set(e.target, e.questionId);
  let pending = null;
  for (const e of J) {
    if (meta.has(e.id)) continue;
    if (e.role === 'user' && answered.has(e.id)) { if (pending && answered.get(e.id) === pending.id) pending = null; continue; }
    if (track && trackOf(e) !== track) continue;
    if (e.role === 'tutor' && e.kind === 'message' && e.question) pending = e;
    else if (e.role === 'user' && e.kind === 'answer' && pending && (!e.replyTo || e.replyTo === pending.id)) pending = null;
  }
  return pending;
}

// Corrections in place (`bin/learn post --corrects <id>`): the journal is append-only, so a
// corrected message is a later entry { kind: "correction", target, newText, note } and never an
// edit. Everything that reads the journal (the UI, `resume`, `show`, `grep`, stats, the wiki)
// reads through this: the target carries the corrected text, and what it said before stays in
// `versions` (oldest first), so the UI can mark it "corrected" and show the earlier version (the
// learner asked for both, 2026-11-25: a corrected drawing reposted as a new message read as two
// drawings). Only the tutor's messages are ever corrected. Mutates the entries of J; applying it
// again (the server did, then the browser does on what it received) changes nothing.
export function applyCorrections(J) {
  let byId = null;
  for (const c of J) {
    if (c.kind !== 'correction' || !c.target || typeof c.newText !== 'string') continue;
    byId ||= new Map(J.map(e => [e.id, e]));
    const t = byId.get(c.target);
    if (!t || t.role !== 'tutor' || t.kind !== 'message') continue;
    const ids = t.corrected?.ids || [];
    if (ids.includes(c.id)) continue;
    t.versions = [...(t.versions || []), { text: t.text, ts: t.corrected?.ts || t.ts }];
    t.text = c.newText;
    if (typeof c.question === 'boolean') t.question = c.question;
    if (c.expect) t.expect = c.expect;
    t.corrected = { ids: [...ids, c.id], ts: c.ts, note: c.note || '' };
  }
  return J;
}
