// The two writing tabs of the System page (system.js; the toolbar's speech-bubble button):
//  - How to teach me: the learner's instructions to every tutor, the "In my own words" section of
//    learner/profile.md in the data folder (POST /api/instructions). Tutors read it first and it
//    overrides what they derive; a running tutor gets the new version with the next message.
//  - Change the app: remarks about the interface or the process, appended to feedback.md for the
//    builder job (POST /api/feedback). "Tell the tutor now" also sends it to the tutor as META
//    (POST /api/send kind "meta", which adds the feedback.md item itself). Below: what's still open.
// Drafts live in localStorage, so a reload, a redraw or a wrong click never loses text.
import { h, store, MOD } from './util.js';
import { app, learner, postJSON, send } from './app.js';
import { rich } from './rich.js';

let openList = null;   // the "still open" list on the app tab, refreshed when feedback.md changes
// a tab is about to be drawn: the list of the last one is gone
export function leaveTab() { openList = null; }
// learner files changed (a save here, an agent's commit): only the parts that are safe to redraw
export function onLearner() { if (openList) fillOpen(openList); }

const page = (...kids) => h('div', { class: 'tell-page' }, ...kids);
const onSaveKey = (ta, fn) => ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); } });

// ---------------------------------------------------------------- how to teach me
export async function instructionsTab(body) {
  const ta = h('textarea', { class: 'input tell-box', id: 'instrBox', spellcheck: 'true',
    placeholder: 'How should the tutors work with you? Tone, pace, how direct the feedback, what to avoid…' });
  const note = h('div', { class: 'tell-note', role: 'status' });
  const save = h('button', { class: 'btn btn-primary', id: 'instrSave', title: `Save  ${MOD}↵` }, 'Save');
  const revert = h('button', { class: 'btn', id: 'instrRevert', title: 'Back to the saved version' }, 'Revert');
  body.append(page(
    h('p', { class: 'tell-desc' }, 'How every tutor should work with you. They read this first, and it overrides whatever they work out about you themselves. A tutor that is running now gets the new version with your next message.'),
    ta,
    h('div', { class: 'tell-actions' }, save, revert, h('span', { class: 'muted small' }, h('kbd', { text: MOD + '↵' }), ' saves · Markdown'), h('span', { class: 'spacer' }),
      h('span', { class: 'muted small', title: 'Section "In my own words". The tutors never edit it. Committed to your data repo on every save.' }, 'Kept in your data folder: ', h('code', { text: 'learner/profile.md' }))),
    note));
  let saved = '';
  try { saved = (await learner()).instructions || ''; }
  catch (e) { note.className = 'tell-note pop-warn'; note.textContent = 'Could not load: ' + e.message; }
  const draft = store.get('draft:instructions', null);
  ta.value = draft ?? saved;
  const dirty = () => ta.value.trim() !== saved.trim();
  const sync = () => { save.disabled = !dirty(); revert.hidden = !dirty(); };
  ta.addEventListener('input', () => { store.set('draft:instructions', dirty() ? ta.value : null); note.textContent = ''; note.className = 'tell-note'; sync(); });
  revert.addEventListener('click', () => { ta.value = saved; store.set('draft:instructions', null); sync(); ta.focus(); });
  const doSave = async () => {
    if (!dirty()) return;
    save.disabled = true;
    try {
      saved = (await postJSON('/api/instructions', { text: ta.value }, { tries: 3 })).instructions;
      ta.value = saved; store.set('draft:instructions', null);
      note.className = 'tell-note ok'; note.textContent = 'Saved. Every tutor reads it from now on; the one running now with your next message.';
    } catch (e) { note.className = 'tell-note pop-warn'; note.textContent = 'Not saved: ' + e.message + ' Your text is still here.'; }
    sync();
  };
  save.addEventListener('click', doSave);
  onSaveKey(ta, doSave);
  sync();
  ta.focus();
}

// ---------------------------------------------------------------- change the app
export function appTab(body) {
  const ta = h('textarea', { class: 'input tell-box', id: 'feedbackBox',
    placeholder: 'Something awkward, missing or broken in the app, or in how the sessions run…' });
  ta.value = store.get('draft:feedback', '');
  const note = h('div', { class: 'tell-note', role: 'status' });
  const save = h('button', { class: 'btn btn-primary', id: 'feedbackSave', title: `Save  ${MOD}↵` });
  const live = h('input', { type: 'checkbox', id: 'feedbackLive' });
  live.checked = store.get('feedbackLive', false);
  const label = () => { save.textContent = live.checked ? 'Send to the tutor' : 'Save for the builder'; };
  live.addEventListener('change', () => { store.set('feedbackLive', live.checked); label(); });
  label();
  ta.addEventListener('input', () => { store.set('draft:feedback', ta.value); note.textContent = ''; note.className = 'tell-note'; });
  const submit = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    save.disabled = true;
    try {
      let file = 'feedback.md';
      if (live.checked) await send('meta', text);
      else file = (await postJSON('/api/feedback', { text, topic: app.topic?.slug, view: 'tell' }, { tries: 1 })).file || file;   // ('tell': the page's first name, kept so the items in feedback.md read alike)
      ta.value = ''; store.set('draft:feedback', '');
      // told to the tutor: its reply comes in the conversation, so go there (as the quick buttons do)
      if (live.checked && app.topic) { location.hash = `#/${app.topic.slug}/learn`; return; }
      note.className = 'tell-note ok';
      note.replaceChildren(h('b', { text: live.checked ? 'Sent' : 'Saved' }), live.checked
        ? ' to the tutor; it answers in the conversation (folded as app talk). Also kept in feedback.md for the builder.'
        : ` to ${file}. The tutor isn’t interrupted; the builder works through it while you’re away (the coffee-cup button).`);
    } catch (e) { note.className = 'tell-note pop-warn'; note.textContent = 'Not saved: ' + e.message + ' Your text is still here.'; }
    save.disabled = false;
  };
  save.addEventListener('click', submit);
  onSaveKey(ta, submit);
  openList = h('div', { class: 'tell-open' });
  body.append(page(
    h('p', { class: 'tell-desc' }, 'About the interface or the way sessions run, not the lesson. It is saved to ', h('code', { text: 'feedback.md' }),
      ' in your data folder and doesn’t interrupt the tutor; the builder implements it while you’re away.'),
    ta,
    h('div', { class: 'tell-actions' }, save,
      h('label', { class: 'fb-live', title: 'The tutor reads it now and replies in the conversation (dimmed and folded, kept out of the lesson record)' },
        live, h('span', { text: 'Tell the tutor now' }), h('span', { class: 'muted', text: '(it replies in the conversation)' })),
      h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, h('kbd', { text: MOD + '↵' }), ' saves')),
    note,
    openList));
  fillOpen(openList);
  ta.focus();
}
// the open items of feedback.md ("- [ ] date (who, where): text", continuation lines indented)
async function fillOpen(el) {
  let text = '';
  try { text = (await learner()).feedback || ''; } catch { return; }
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^- \[( |x)\] (\d{4}-\d{2}-\d{2}) \(([^)]*)\): ?(.*)$/);
    if (m) items.push({ open: m[1] === ' ', date: m[2], ctx: m[3], text: m[4] });
    else if (items.length && /^\s+\S/.test(line)) items[items.length - 1].text += '\n' + line.trim();
  }
  const open = items.filter(i => i.open).reverse();
  el.replaceChildren(h('div', { class: 'tell-open-h' }, h('b', { text: 'Waiting for the builder' }), h('span', { class: 'count', text: String(open.length) }),
    h('span', { class: 'muted small', text: `${items.length - open.length} done` })),
  ...(open.length ? open.map(i => h('div', { class: 'tell-item' }, h('span', { class: 'tell-item-meta', text: `${i.date} · ${i.ctx}` }),
    rich(i.text.length > 600 ? i.text.slice(0, 600) + '…' : i.text, 'wiki-md', { terms: false })))
    : [h('div', { class: 'empty-row', text: 'Nothing open.' })]));
}
