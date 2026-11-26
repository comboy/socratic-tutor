// New topic page (#/new, and the first screen when there are no topics): the learner says what they
// want to learn; the server scaffolds the topic and queues a START message; the tutor maps the topic
// and starts a short diagnostic (docs/bootstrap.md).
import { h, $, store, MOD } from './util.js';
import { icon } from './icons.js';
import { app, refreshTopics } from './app.js';

const EXAMPLES = ['How the immune system tells friend from foe', 'Linear algebra, enough for machine learning papers',
  'Cell biology: what actually happens inside a cell', 'How compilers turn code into machine instructions', 'Music theory for reading jazz charts'];

export function renderNewTopic(center, goal0 = '') {
  const first = !app.topics.length;
  const draft = store.get('draft:newtopic', {});
  const goal = h('textarea', { class: 'input nt-goal', id: 'ntGoal', rows: 3, placeholder: 'e.g. ' + EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)] });
  const why = h('textarea', { class: 'input', id: 'ntWhy', rows: 2, placeholder: 'e.g. to read papers in the field · just curious · an exam in March · down to the molecular level' });
  const know = h('textarea', { class: 'input', id: 'ntKnow', rows: 2, placeholder: 'e.g. high-school biology, long ago · I program for a living · nothing yet' });
  goal.value = goal0 || draft.goal || ''; why.value = draft.why || ''; know.value = draft.know || '';
  const save = () => store.set('draft:newtopic', { goal: goal.value, why: why.value, know: know.value });
  for (const t of [goal, why, know]) t.addEventListener('input', save);
  const note = h('div', { class: 'nt-note' });
  const btn = h('button', { class: 'btn btn-primary nt-start', type: 'submit' }, icon('send'), 'Start learning');
  const submit = async ev => {
    ev?.preventDefault();
    if (goal.value.trim().length < 3) { goal.focus(); note.className = 'nt-note pop-warn'; note.textContent = 'Say what you want to learn, in your own words.'; return; }
    btn.disabled = true; note.className = 'nt-note'; note.textContent = 'Creating the topic…';
    try {
      const r = await fetch('/api/topics/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: goal.value, why: why.value, know: know.value }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      store.set('draft:newtopic', {});
      await refreshTopics();
      location.hash = `#/${j.slug}/learn`;
    } catch (e) { btn.disabled = false; note.className = 'nt-note pop-warn'; note.textContent = 'Could not create the topic: ' + e.message; }
  };
  const field = (label, sub, el) => h('label', { class: 'nt-field' }, h('span', { class: 'nt-label' }, label, sub ? h('span', { class: 'nt-sub', text: sub }) : null), el);
  const keys = ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) submit(ev); };
  const form = h('form', { class: 'nt-form', onsubmit: submit, onkeydown: keys },
    field('What do you want to learn?', 'in your own words, as broad or as narrow as you like', goal),
    field('What for, and how deep?', 'optional', why),
    field('What do you already know about it?', 'optional; the tutor also knows your other topics', know),
    h('div', { class: 'nt-actions' }, btn, h('kbd', { text: MOD + '↵' }), h('span', { class: 'spacer' }),
      !first ? h('button', { class: 'btn', type: 'button', onclick: () => history.back() }, 'Cancel') : null),
    note);
  const steps = h('ol', { class: 'nt-steps' },
    h('li', {}, h('b', { text: 'A few questions first. ' }), 'The tutor asks 3–5 questions, one at a time, to see where you stand. Answer in your own words; "no idea" is a fine answer.'),
    h('li', {}, h('b', { text: 'A map of the topic. ' }), 'Meanwhile it builds a skill tree, a concept map and a glossary. They fill in as you learn (Tree, Map and Wiki tabs).'),
    h('li', {}, h('b', { text: 'Then explain, check, repeat. ' }), 'A chunk of explanation, one question to check it, and your levels rise only on real evidence. Ask anything any time in the "Ask" box.'));
  const status = app.status?.launcher ? null : h('div', { class: 'pop-warn nt-warn' }, 'No tutor is running yet. Start one in a terminal with ', h('code', { text: 'bin/learn' }), '; your topic will be waiting for it.');
  center.replaceChildren(h('div', { class: 'view nt-view' }, h('div', { class: 'view-body' }, h('div', { class: 'nt-wrap' },
    h('div', { class: 'group nt-card' },
      h('div', { class: 'group-h' }, icon('plus'), first ? 'Welcome. What do you want to learn?' : 'New topic'),
      h('div', { class: 'group-b' }, first ? h('p', { class: 'nt-intro', text: 'A tutor that teaches you anything, up to research level: it explains, checks your understanding, and keeps a map of what you know. Everything stays in files on this computer.' }) : null,
        form, status)),
    h('div', { class: 'group nt-card' }, h('div', { class: 'group-h' }, icon('bulb'), 'What happens next'), h('div', { class: 'group-b' }, steps))))));
  requestAnimationFrame(() => goal.focus());
}
