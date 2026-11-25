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
// The open question: the last tutor question not followed by an answer to it (app talk never is
// one). With a track: that thread's open question.
export function pendingQuestion(J, track = null, meta = metaIds(J)) {
  let pending = null;
  for (const e of J) {
    if (meta.has(e.id) || (track && trackOf(e) !== track)) continue;
    if (e.role === 'tutor' && e.kind === 'message' && e.question) pending = e;
    else if (e.role === 'user' && e.kind === 'answer' && pending && (!e.replyTo || e.replyTo === pending.id)) pending = null;
  }
  return pending;
}
