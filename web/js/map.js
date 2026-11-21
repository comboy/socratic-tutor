// Concept map view: map.json drawn on a grid. Regions are tinted by area, nodes carry the
// learner's level colour; uncovered territory is drawn as dashed "fog".
import { h, store, skillById, levelOf, lvChip, meter, levelScale, fmtLevel, LEVEL_NAMES, descendants, lvClass } from './util.js';
import { rich } from './rich.js';
import { icon } from './icons.js';
import { openDock, msgLine, termEntry, occurrences, group } from './panels.js';
import * as learn from './learn.js';
/* global d3 */

let selected = null, appRef = null, mapSize = null;
function setZoom(z) {
  if (!mapSize) return;
  z = Math.max(0.4, Math.min(2.5, z));
  store.set('mapZoom', z);
  mapSize.svg.attr('width', mapSize.W * z).attr('height', mapSize.H * z);
  const l = document.getElementById('zoomLvl'); if (l) l.textContent = Math.round(z * 100) + '%';
}
const zoomBy = f => setZoom(store.get('mapZoom', 1) * f);
function zoomFit() { if (mapSize) setZoom((mapSize.box.parentElement.clientWidth - 40) / mapSize.W); }
export const routeAlways = true;

export function render(center, app, args) {
  appRef = app;
  selected = args[0] || null;
  const map = app.topic.map;
  const body = h('div', { class: 'view-body' });
  center.replaceChildren(h('div', { class: 'view' },
    h('div', { class: 'view-bar' }, h('h1', { text: map?.title || 'Concept map' }),
      h('span', { class: 'zoom' },
        h('button', { class: 'icon-btn', title: 'Zoom out', text: '−', onclick: () => zoomBy(1 / 1.15) }),
        h('span', { class: 'lvl', id: 'zoomLvl' }),
        h('button', { class: 'icon-btn', title: 'Zoom in', text: '+', onclick: () => zoomBy(1.15) }),
        h('button', { class: 'btn btn-tiny', text: 'Fit', title: 'Fit the whole map in the window', onclick: () => zoomFit() }),
        h('button', { class: 'btn btn-tiny', text: '100%', onclick: () => setZoom(1) })),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted small', text: 'Box colour = your level:' }), levelScale()),
    body));
  if (!map || map.error) {
    body.append(h('div', { class: 'empty' }, map?.error ? 'map.json has an error: ' + map.error : 'No concept map for this topic yet. The tutor creates topics/<slug>/map.json.'));
    return;
  }
  const canvas = h('div', { class: 'map-canvas' });
  body.append(canvas);
  draw(canvas, map, app);
  if (selected) openDock('node', selected);
}
export function onTopic(part) { if (part === 'map.json' || part === 'topic.json') render(document.getElementById('center'), appRef, selected ? [selected] : []); }

function nodeLevel(n, app) {
  if (n.status === 'unknown') return 0;
  const s = n.skill ? skillById(app.topic.meta, n.skill) : null;
  return s ? levelOf(s.node) : (n.level ?? 0);
}

function draw(box, map, app) {
  const cols = map.cols || 8;
  const CW = 150, RH = map.rowHeight || 100, PAD = 10, GH = 22;
  const nodes = map.nodes || [], groups = map.groups || [];
  const rows = Math.max(1, ...nodes.map(n => (n.row || 0) + (n.h || 1)), ...groups.map(g => (g.row || 0) + (g.h || 1)));
  const W = cols * CW, H = rows * RH + 10;
  const svg = d3.select(box).append('svg').attr('class', 'map-svg').attr('viewBox', `0 0 ${W} ${H}`);
  mapSize = { W, H, svg, box };
  setZoom(store.get('mapZoom', 1));
  const defs = svg.append('defs');
  defs.append('marker').attr('id', 'arrow').attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5).attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto-start-reverse')
    .append('path').attr('d', 'M0,0 L10,5 L0,10 z').attr('class', 'map-arrowhead');
  const pat = defs.append('pattern').attr('id', 'fog').attr('patternUnits', 'userSpaceOnUse').attr('width', 8).attr('height', 8).attr('patternTransform', 'rotate(45)');
  pat.append('rect').attr('width', 8).attr('height', 8).attr('class', 'fog-bg');
  pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 8).attr('class', 'fog-line');

  const rect = n => ({ x: (n.col || 0) * CW + PAD, y: (n.row || 0) * RH + PAD + GH, w: (n.w || 1) * CW - PAD * 2, h: (n.h || 1) * RH - PAD * 2 - GH / 2 });
  const inside = (n, g) => (n.col || 0) >= (g.col || 0) && (n.col || 0) < (g.col || 0) + (g.w || 1) && (n.row || 0) >= (g.row || 0) && (n.row || 0) < (g.row || 0) + (g.h || 1);
  const tops = groups.filter(g => !groups.some(o => o !== g && inside(g, o)));
  const regionOf = n => tops.find(g => inside(n, g)) || null;
  const regionColor = g => `var(--r${Math.max(0, tops.indexOf(g)) % 6})`;

  for (const g of groups) {
    const top = tops.includes(g), c = regionColor(top ? g : regionOf(g));
    const x = (g.col || 0) * CW + 2, y = (g.row || 0) * RH + 2, w = (g.w || 1) * CW - 4, hh = (g.h || 1) * RH - 4;
    const gg = svg.append('g').attr('class', 'map-group');
    gg.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', hh).attr('rx', 10)
      .style('fill', `color-mix(in srgb, ${c} ${top ? 9 : 7}%, transparent)`).style('stroke', `color-mix(in srgb, ${c} 45%, transparent)`).style('stroke-dasharray', top ? null : '4 3');
    if (top) gg.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', 22).attr('rx', 10).style('fill', `color-mix(in srgb, ${c} 18%, transparent)`);
    gg.append('text').attr('x', x + 11).attr('y', y + 15).style('fill', c).text(g.label);
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edgesG = svg.append('g');
  const edgeEls = [];
  for (const e of map.edges || []) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const ra = rect(a), rb = rect(b);
    const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 }, cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
    const pa = edgePoint(ra, cb), pb = edgePoint(rb, ca);
    const horiz = Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y);
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const d = horiz ? `M${pa.x},${pa.y} C${mx},${pa.y} ${mx},${pb.y} ${pb.x},${pb.y}` : `M${pa.x},${pa.y} C${pa.x},${my} ${pb.x},${my} ${pb.x},${pb.y}`;
    const fogged = nodeLevel(a, app) === 0 || nodeLevel(b, app) === 0;
    const cross = regionOf(a) !== regionOf(b);
    const tight = Math.hypot(pb.x - pa.x, pb.y - pa.y) < 14 + (e.label || '').length * 6;
    const p = edgesG.append('path').attr('d', d).attr('class', 'map-edge' + (fogged ? ' fog' : '') + (e.dashed ? ' dashed' : '') + (cross ? ' cross' : '')).attr('marker-end', 'url(#arrow)');
    let t = null;
    if (e.label) t = edgesG.append('text').attr('class', 'map-elabel' + (cross || tight ? ' cross' : '')).attr('x', mx).attr('y', my - 4).attr('text-anchor', 'middle').text(e.label);
    edgeEls.push({ e, p, t });
  }
  const nodesG = svg.append('g');
  for (const n of nodes) {
    const r = rect(n), lv = nodeLevel(n, app), fog = lv === 0;
    const g = nodesG.append('g').attr('class', `map-node ${lvClass(lv)}` + (fog ? ' fog' : '') + (n.id === selected ? ' sel' : '')).attr('tabindex', 0).attr('data-node', n.id)
      .on('click', () => select(n.id))
      .on('keydown', ev => { if (ev.key === 'Enter') select(n.id); })
      .on('mouseenter', () => hot(n.id))
      .on('mouseleave', () => hot(selected));
    g.append('rect').attr('x', r.x).attr('y', r.y).attr('width', r.w).attr('height', r.h).attr('rx', 6).attr('class', 'map-box');
    if (fog) g.append('rect').attr('x', r.x).attr('y', r.y).attr('width', r.w).attr('height', r.h).attr('rx', 6).attr('fill', 'url(#fog)');
    else g.append('path').attr('class', 'map-strip').attr('d', `M${r.x} ${r.y + 5} V${r.y + 6} Q${r.x} ${r.y} ${r.x + 6} ${r.y} H${r.x + r.w - 6} Q${r.x + r.w} ${r.y} ${r.x + r.w} ${r.y + 6} V${r.y + 5} Z`);
    const fo = g.append('foreignObject').attr('x', r.x).attr('y', r.y).attr('width', r.w).attr('height', r.h);
    const div = fo.append('xhtml:div').attr('class', 'map-node-html');
    div.append('div').attr('class', 'mn-label').text(n.label);
    if (n.sub) div.append('div').attr('class', 'mn-sub').text(n.sub);
    if (fog) div.append('div').attr('class', 'mn-fog').text('not covered yet');
    g.append('title').text(`${n.label}${n.skill ? ` · skill ${n.skill}` : ''} · level ${fmtLevel(lv)}/5 · ${LEVEL_NAMES[Math.round(lv)]}`);
  }
  function hot(id) { edgeEls.forEach(x => { const on = !!id && (x.e.from === id || x.e.to === id); x.p.classed('hot', on); x.t?.classed('hot', on); }); }
  hot(selected);
  function select(id) {
    selected = id;
    hot(id);
    nodesG.selectAll('.map-node').classed('sel', function () { return this.dataset.node === id; });
    history.replaceState(null, '', `#/${app.topic.slug}/map/${encodeURIComponent(id)}`);
    openDock('node', id);
  }
}
function edgePoint(r, toward) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min((r.w / 2) / Math.abs(dx || 1e-9), (r.h / 2) / Math.abs(dy || 1e-9));
  return { x: cx + dx * s, y: cy + dy * s };
}

// Inspector content for a node
export function nodePanel(body, id, app) {
  const n = (app.topic.map?.nodes || []).find(x => x.id === id);
  if (!n) { body.append(h('div', { class: 'empty-row', text: `No map node ${id}` })); return; }
  const lv = nodeLevel(n, app);
  const s = n.skill ? skillById(app.topic.meta, n.skill) : null;
  body.append(h('div', { class: 'title-block' },
    h('h2', { text: n.label }),
    h('div', { class: 'title-meta' }, lvChip(lv), meter(lv, app.topic.meta.target), h('span', { text: lv === 0 ? 'not covered yet' : `${fmtLevel(lv)} / 5 · ${LEVEL_NAMES[Math.round(lv)]}` })),
    n.sub ? h('div', { class: 'muted small node-sub', text: n.sub }) : null));
  body.append(h('div', { class: 'actions' },
    h('button', { class: 'btn btn-primary', onclick: () => learn.prefillAsk(lv === 0 ? `I'd like to learn about “${n.label}” next. How does it fit into the picture?` : `Can you re-explain “${n.label}”: what goes in, what comes out, why it's there?`) }, icon('ask'), lv === 0 ? 'Teach me this' : 'Explain again'),
    lv > 0 ? h('button', { class: 'btn', onclick: () => learn.quickAction(`review map node “${n.label}”${s ? ` (skill ${s.id})` : ''}: give me a review question`) }, icon('quiz'), 'Quiz me') : null,
    s ? h('button', { class: 'btn', onclick: () => openDock('skill', s.id) }, icon('skills'), `Skill ${s.id}`) : null));
  if (n.desc) body.append(group('How it works', h('div', { class: 'group-b' }, rich(n.desc, 'hl-scope'))));
  if (n.terms?.length) body.append(group('Terms', h('div', { class: 'group-b chips' }, ...n.terms.map(t => h('button', { class: 'chip chip-btn' + (termEntry(t) ? '' : ' missing'), text: t, onclick: () => openDock('term', t) })))));
  const ids = n.skill ? descendants(app.topic.meta, n.skill) : new Set();
  const tagged = app.topic.journal.filter(e => e.role === 'tutor' && e.kind === 'message' && e._skills.some(x => ids.has(x)));
  const seen = new Set(tagged.map(e => e.id)), mentioned = [];
  for (const t of n.terms || []) { const te = termEntry(t); if (te) for (const o of occurrences(te)) if (!seen.has(o.e.id)) { seen.add(o.e.id); mentioned.push(o.e); } }
  mentioned.sort((a, b) => a.ts.localeCompare(b.ts));
  body.append(group(['Explained in', h('span', { class: 'count', text: String(tagged.length) })], h('div', { class: 'occ' }, ...tagged.map(e => msgLine(e, n.terms?.[0])),
    !tagged.length ? h('div', { class: 'empty-row', text: 'No messages tagged with this skill yet.' }) : null)));
  if (mentioned.length) body.append(group(['Also mentioned in', h('span', { class: 'count', text: String(mentioned.length) })], h('div', { class: 'occ' }, ...mentioned.slice(0, 30).map(e => msgLine(e, n.terms?.[0])))));
}
