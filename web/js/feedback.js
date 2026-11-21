// Meta feedback box (toolbar): notes about the app or the way sessions run, for the builder.
// The server appends them to feedback.md in the data home, for the builder job ("I'm away").
// They are never journaled or sent to the tutor.
import { h, $, store } from './util.js';
import { icon } from './icons.js';
import { app } from './app.js';

let pop = null, closeT = null;
function close() {
  clearTimeout(closeT);
  pop?.remove(); pop = null;
  $('#feedbackBtn')?.classList.remove('on');
  document.removeEventListener('mousedown', outside, true);
}
function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('#feedbackBtn')) close(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) close(); });

export function toggleFeedback() {
  if (pop) { close(); return; }
  const ta = h('textarea', { class: 'input fb-text', id: 'feedbackBox', placeholder: 'Something awkward, missing or broken in the app, or in how the sessions run…' });
  ta.value = store.get('draft:feedback', '');
  const note = h('div', { class: 'fb-note' });
  const save = h('button', { class: 'btn btn-primary btn-small', title: 'Save  ⌘↵' }, 'Save feedback');
  const submit = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    save.disabled = true;
    try {
      const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, topic: app.topic?.slug, view: [app.view, ...app.args].join('/') }) });
      if (r.status === 404) throw new Error('the running server is older than the feedback box. Restart bin/learn to enable it.');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      ta.value = ''; store.set('draft:feedback', '');
      note.className = 'fb-note pop-note ok';
      note.replaceChildren(h('b', { text: 'Saved' }), ` to ${j.file}. The tutor won’t see it.`);
      clearTimeout(closeT);
      closeT = setTimeout(() => { if (pop && !ta.value) close(); }, 2500);
    } catch (e) {
      note.className = 'fb-note pop-warn';
      note.textContent = 'Not saved: ' + e.message;
    }
    save.disabled = false;
  };
  save.addEventListener('click', submit);
  ta.addEventListener('input', () => { store.set('draft:feedback', ta.value); clearTimeout(closeT); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });

  pop = h('div', { class: 'popover fb-pop' },
    h('div', { class: 'pop-h' }, icon('feedback'), h('b', { text: 'Feedback on the app' }), h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Close  Esc', onclick: close }, icon('close'))),
    h('div', { class: 'pop-b' },
      h('p', { class: 'pop-hint fb-desc' }, 'About the interface or the process, not the lesson. Goes to ', h('code', { text: 'feedback.md' }), ' in your data folder; the builder works through it while you’re away (the coffee-cup button). The tutor doesn’t see it.'),
      ta, note),
    h('div', { class: 'pop-f' }, h('span', { class: 'pop-hint' }, h('kbd', { text: '⌘↵' }), ' saves'), h('span', { class: 'spacer' }), save));
  document.body.append(pop);
  const r = $('#feedbackBtn').getBoundingClientRect();
  pop.style.top = r.bottom + 6 + 'px';
  pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  $('#feedbackBtn').classList.add('on');
  document.addEventListener('mousedown', outside, true);
  ta.focus();
}
