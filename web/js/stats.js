// Stats: activity, time, checks, level history, freshness per skill.
import { h, flatSkills, levelOf, overall, skillById, levelBar, lvChip, fmtLevel, fmtDate, relDays, daysAgo } from './util.js';
import { app } from './app.js';
import { openDock } from './panels.js';
/* global d3 */

export const routeAlways = true;
const VERDICTS = [['correct', '✓ correct'], ['partial', '◐ partial'], ['wrong', '✗ not quite'], ['skipped', '↷ skipped']];

export function render(center) {
  const J = app.topic.journal.filter(e => !e._meta), m = app.topic.meta;   // app talk isn't learning
  const el = h('div', { class: 'stats' });
  center.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'view-bar' }, h('h1', { text: `Statistics · ${m.title}` })), h('div', { class: 'view-body' }, el)));

  // ----- derive
  const days = new Map();
  for (const e of J) { const d = e.ts.slice(0, 10); if (!days.has(d)) days.set(d, { d, user: 0, tutor: 0, minutes: 0, es: [] }); const x = days.get(d); x.es.push(e); if (e.role === 'user') x.user++; if (e.role === 'tutor' && e.kind === 'message') x.tutor++; }
  for (const x of days.values()) {
    const ts = x.es.filter(e => e.role !== 'system').map(e => +new Date(e.ts)).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) { const g = (ts[i] - ts[i - 1]) / 60000; if (g < 25) x.minutes += g; }
  }
  const dayList = [...days.values()].sort((a, b) => a.d.localeCompare(b.d));
  const minutes = dayList.reduce((a, x) => a + x.minutes, 0);
  const grades = J.filter(e => e.kind === 'grade');
  const answers = J.filter(e => e.role === 'user' && (e.kind === 'answer' || (e.imported && e.kind === 'message')));
  const asks = J.filter(e => e.role === 'user' && e.kind === 'ask');
  const correct = grades.filter(g => g.verdict === 'correct').length;
  const streak = (() => { let s = 0; const set = new Set(days.keys()); for (let d = new Date(); ; d.setDate(d.getDate() - 1)) { const k = d.toISOString().slice(0, 10); if (set.has(k)) s++; else if (s || k !== new Date().toISOString().slice(0, 10)) break; } return s; })();

  el.append(h('div', { class: 'tiles' },
    tile('Overall level', `${fmtLevel(Math.round(overall(m) * 10) / 10)}`, `/5 · target ${m.target}`, levelBar(overall(m), m.target)),
    tile('Days studied', dayList.length, streak > 1 ? `${streak}-day streak` : `since ${dayList[0] ? fmtDate(dayList[0].d) : '—'}`),
    tile('Time learning', minutes >= 90 ? (minutes / 60).toFixed(1) : Math.round(minutes), minutes >= 90 ? 'hours (est.)' : 'minutes (est.)'),
    tile('Your messages', answers.length + asks.length, `${asks.length} side questions`),
    tile('Graded checks', grades.length ? `${correct}/${grades.length}` : '—', grades.length ? `${Math.round(correct / grades.length * 100)}% fully correct` : 'grading started with the web UI'),
    tile('Terms', app.topic.glossary.length, 'in the glossary'),
  ));

  // ----- activity per day
  el.append(section('Activity per day', 'Minutes estimated from gaps under 25 min between messages.', box => barsChart(box, dayList.map(x => ({ k: x.d, label: fmtDate(x.d), v: Math.round(x.minutes), tip: `${fmtDate(x.d, { weekday: 'short', month: 'short', day: 'numeric' })}<br>${Math.round(x.minutes)} min · ${x.user} your msgs · ${x.tutor} tutor` })), 'min')));

  // ----- level history
  const lvEvents = J.filter(e => e.kind === 'level');
  el.append(section('Overall level over time', lvEvents.length ? 'Reconstructed from recorded level changes.' : 'Level changes are recorded from now on (bin/learn level). Earlier levels came from the terminal sessions.', box => {
    if (!lvEvents.length) { box.append(h('div', { class: 'muted small', text: `Current: ${fmtLevel(overall(m))}/5` })); return; }
    const meta = JSON.parse(JSON.stringify(m));
    const pts = [{ t: new Date(), v: overall(meta) }];
    for (const e of [...lvEvents].reverse()) { const s = skillById(meta, e.skill); if (s) s.node.level = e.from; pts.unshift({ t: new Date(e.ts), v: overall(meta), e }); }
    lineChart(box, pts);
  }));

  // ----- checks per skill
  const leaf = flatSkills(m.skills);
  const bySkill = new Map();
  for (const g of grades) { const k = String(g.skill || '?'); if (!bySkill.has(k)) bySkill.set(k, { correct: 0, partial: 0, wrong: 0, skipped: 0 }); bySkill.get(k)[g.verdict]++; }
  el.append(section('Checks by skill', 'How your graded answers went, per subskill.', box => {
    if (!bySkill.size) { box.append(h('div', { class: 'muted small', text: 'No graded checks yet. They start with the web UI.' })); return; }
    stackChart(box, [...bySkill].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, v]) => ({ k, label: `${k} ${skillById(m, k)?.name || ''}`, v })));
  }));

  // ----- freshness table
  const last = new Map(), count = new Map();
  for (const g of grades) { const k = String(g.skill); last.set(k, g.ts); count.set(k, (count.get(k) || 0) + 1); }
  const lastTaught = new Map();
  for (const e of J) if (e.role === 'tutor' && e.kind === 'message') for (const s of e._skills || []) lastTaught.set(s, e.ts);
  const age = r => (r.last ? daysAgo(r.last) : 1e4);
  el.append(section('Skill freshness', 'Oldest “last checked” first: these are the ones to review.', box => {
    const rows = leaf.filter(s => !s.children?.length).map(s => ({ s, lv: levelOf(s.node), last: last.get(s.id), taught: lastTaught.get(s.id), n: count.get(s.id) || 0 }))
      .sort((a, b) => (a.lv === 0) - (b.lv === 0) || age(b) - age(a));
    box.style.padding = '0';
    const t = h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...['Skill', 'Level', 'Checks', 'Last checked', 'Last taught'].map(x => h('th', { text: x })))),
      h('tbody', {}, ...rows.map(r => h('tr', { class: r.lv === 0 ? 'fog' : '' },
        h('td', {}, h('button', { class: 'linkish', text: `${r.s.id} ${r.s.name}`, onclick: () => openDock('skill', r.s.id) })),
        h('td', {}, h('span', { class: 'lvcell' }, lvChip(r.lv), levelBar(r.lv))),
        h('td', { text: r.n || '—' }),
        h('td', { text: r.last ? relDays(r.last) : '—' }),
        h('td', { text: r.taught ? relDays(r.taught) : '—' })))));
    box.append(t);
  }));
}

function tile(label, value, sub, extra) {
  return h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value' }, h('span', { text: value }), h('span', { class: 'tile-sub', text: ' ' + sub })), extra || null);
}
function section(title, sub, fill) {
  const box = h('div', { class: 'chart-box' });
  const s = h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', { text: title }), h('p', { text: sub })), box);
  requestAnimationFrame(() => fill(box));
  return s;
}
function tooltip(box) {
  const t = h('div', { class: 'tip' }); box.style.position = 'relative'; box.append(t);
  return { show(html, x, y) { t.innerHTML = html; t.style.left = x + 'px'; t.style.top = y + 'px'; t.classList.add('on'); }, hide() { t.classList.remove('on'); } };
}

function barsChart(box, data, unit) {
  const W = Math.max(320, box.clientWidth), H = 180, mg = { t: 10, r: 10, b: 26, l: 36 };
  const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('class', 'chart');
  const x = d3.scaleBand().domain(data.map(d => d.k)).range([mg.l, W - mg.r]).padding(0.25);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.v) || 1]).nice().range([H - mg.b, mg.t]);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - mg.l - mg.r)).tickFormat(v => v + (unit && v ? '' : '')));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(x).tickFormat(k => data.find(d => d.k === k).label).tickSizeOuter(0));
  const tip = tooltip(box);
  const bw = Math.min(40, x.bandwidth());
  svg.append('g').selectAll('path').data(data).join('path').attr('class', 'bar')
    .attr('d', d => roundTop(x(d.k) + (x.bandwidth() - bw) / 2, y(d.v), bw, y(0) - y(d.v), 4));
  svg.append('g').selectAll('rect').data(data).join('rect').attr('class', 'hit').attr('x', d => x(d.k)).attr('y', mg.t).attr('width', x.bandwidth()).attr('height', H - mg.t - mg.b)
    .on('mousemove', (ev, d) => { const [px, py] = d3.pointer(ev, box); tip.show(d.tip, px + 12, py - 10); })
    .on('mouseleave', () => tip.hide());
  svg.selectAll('.axis .tick text').attr('opacity', (_, i) => data.length > 14 && i % Math.ceil(data.length / 12) ? 0 : 1);
}
function roundTop(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
function lineChart(box, pts) {
  const W = Math.max(320, box.clientWidth), H = 180, mg = { t: 10, r: 14, b: 26, l: 36 };
  const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('class', 'chart');
  const x = d3.scaleTime().domain(d3.extent(pts, d => d.t)).range([mg.l, W - mg.r]);
  const y = d3.scaleLinear().domain([0, 5]).range([H - mg.b, mg.t]);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - mg.l - mg.r)));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
  svg.append('path').datum(pts).attr('class', 'line').attr('d', d3.line().curve(d3.curveStepAfter).x(d => x(d.t)).y(d => y(d.v)));
  const tip = tooltip(box);
  const dot = svg.append('circle').attr('r', 4.5).attr('class', 'dot').style('opacity', 0);
  svg.append('rect').attr('class', 'hit').attr('x', mg.l).attr('y', mg.t).attr('width', W - mg.l - mg.r).attr('height', H - mg.t - mg.b)
    .on('mousemove', ev => {
      const [px] = d3.pointer(ev); const t = x.invert(px);
      let p = pts[0]; for (const q of pts) if (q.t <= t) p = q;
      dot.attr('cx', x(p.t)).attr('cy', y(p.v)).style('opacity', 1);
      const [bx, by] = d3.pointer(ev, box);
      tip.show(`${p.t.toLocaleDateString()}<br><b>${p.v.toFixed(2)}</b>/5${p.e ? `<br>${p.e.skill}: ${p.e.from}→${p.e.to}` : ''}`, bx + 12, by - 10);
    })
    .on('mouseleave', () => { tip.hide(); dot.style('opacity', 0); });
}
function stackChart(box, rows) {
  const W = Math.max(320, box.clientWidth), RH = 24, mg = { t: 4, r: 40, b: 4, l: 200 };
  const H = rows.length * RH + mg.t + mg.b;
  box.append(h('div', { class: 'legend' }, ...VERDICTS.map(([k, l]) => h('span', { class: 'lg-item' }, h('span', { class: 'lg-sw verdict-bg-' + k }), h('span', { class: 'small', text: l })))));
  const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('class', 'chart');
  const max = d3.max(rows, r => VERDICTS.reduce((a, [k]) => a + r.v[k], 0)) || 1;
  const x = d3.scaleLinear().domain([0, max]).range([mg.l, W - mg.r]);
  const tip = tooltip(box);
  rows.forEach((r, i) => {
    const y = mg.t + i * RH;
    svg.append('text').attr('class', 'rowlabel').attr('x', mg.l - 8).attr('y', y + RH / 2 + 4).attr('text-anchor', 'end').text(r.label.length > 30 ? r.label.slice(0, 29) + '…' : r.label);
    let acc = 0;
    for (const [k] of VERDICTS) {
      const v = r.v[k]; if (!v) continue;
      svg.append('rect').attr('class', 'seg verdict-fill-' + k).attr('x', x(acc) + (acc ? 1 : 0)).attr('y', y + 5).attr('width', Math.max(1, x(acc + v) - x(acc) - (acc ? 1 : 0))).attr('height', RH - 10).attr('rx', 3);
      acc += v;
    }
    svg.append('text').attr('class', 'rowval').attr('x', x(acc) + 6).attr('y', y + RH / 2 + 4).text(acc);
    svg.append('rect').attr('class', 'hit').attr('x', 0).attr('y', y).attr('width', W).attr('height', RH)
      .on('mousemove', ev => { const [bx, by] = d3.pointer(ev, box); tip.show(`<b>${r.label}</b><br>${VERDICTS.filter(([k]) => r.v[k]).map(([k, l]) => `${l}: ${r.v[k]}`).join('<br>')}`, bx + 12, by - 10); })
      .on('mouseleave', () => tip.hide());
  });
}
