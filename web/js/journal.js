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
