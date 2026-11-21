// Skill tree view: a Civilization-style tech tree of the topic's leaf skills. Columns are tiers
// (rank = 1 + max rank of a skill's `needs`), foundations (knowledge from outside the topic) sit in
// their own lane on the left. Prerequisites are soft: the tree shows readiness, it never locks.
// Without any `needs` in topic.json the branches are simply laid out as columns.
import { h, store, flatSkills, levelOf, lvChip, lvClass, levelScale, fmtLevel, LEVEL_NAMES } from './util.js';
import { openDock } from './panels.js';
/* global d3 */

const NW = 176, NH = 56, CG = 68, RG = 12, RH = NH + RG, HH = 40, PAD = 18, LANE = 10;
const READY = 2, MASTERED = 4;
const SHORT = ['not covered', 'heard of it', 'can follow', 'with help', 'independent', 'can teach'];
const ZKEY = 'treeZoom';

let appRef = null, selected = null, branchHl = '', branchSlug = null;
let ui = null;   // { stage, sizer, body, W, H, nodes, edges, popover }

export const routeAlways = true;

export function render(center, app, args) {
  appRef = app;
  selected = args?.[0] || null;
  draw(center, app);
}
export function onTopic(part) {
  if (part && part !== 'topic.json') return;
  const center = document.getElementById('center');
  const body = ui?.body, sl = body?.scrollLeft, st = body?.scrollTop;
  draw(center, appRef, true);
  if (ui?.body && sl != null) { ui.body.scrollLeft = sl; ui.body.scrollTop = st; }
}

// ---------------------------------------------------------------- graph model
const cmpId = (a, b) => {
  const pa = String(a).split('.'), pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] == null) return -1; if (pb[i] == null) return 1;
    const na = Number(pa[i]), nb = Number(pb[i]);
    const c = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : pa[i].localeCompare(pb[i]);
    if (c) return c;
  }
  return 0;
};

export function buildGraph(meta) {
  const flat = flatSkills(meta.skills);
  const byId = new Map(flat.map(s => [s.id, s]));
  const tops = meta.skills || [];
  const branchOf = new Map();
  tops.forEach((t, i) => (function walk(n) { branchOf.set(n.id, i); (n.children || []).forEach(walk); })(t));
  const leavesOf = id => flat.filter(s => !s.children?.length && (s.id === id || ancestors(s).includes(id))).map(s => s.id);
  function ancestors(s) { const out = []; let p = s.parent; while (p) { out.push(p); p = byId.get(p)?.parent; } return out; }

  const nodes = new Map(), missing = new Set();
  for (const f of meta.foundations || []) {
    if (!f?.id || nodes.has(f.id)) continue;
    nodes.set(String(f.id), { id: String(f.id), kind: 'f', name: f.name || f.id, level: f.level == null ? null : Number(f.level), f, bi: -1, needs: [], deps: [] });
  }
  const leaves = flat.filter(s => !s.children?.length);
  for (const s of leaves) nodes.set(s.id, { id: s.id, kind: 's', name: s.name || s.id, level: levelOf(s.node), s, bi: branchOf.get(s.id) ?? 0, needs: [], deps: [] });
  for (const s of leaves) {
    const n = nodes.get(s.id);
    const raw = [...(s.needs || []), ...ancestors(s).flatMap(a => byId.get(a)?.needs || [])].map(String);
    const out = new Set();
    for (const id of raw) {
      if (nodes.get(id)?.kind === 'f' || (nodes.get(id)?.kind === 's')) out.add(id);
      else if (byId.has(id)) leavesOf(id).forEach(x => out.add(x));
      else missing.add(id);
    }
    out.delete(s.id);
    n.needs = [...out];
  }
  for (const n of nodes.values()) for (const m of n.needs) nodes.get(m).deps.push(n.id);
  const hasNeeds = [...nodes.values()].some(n => n.needs.length);

  // rank: foundations -1, skills without (skill) needs 0, else 1 + max rank of needs
  const rank = new Map(), visiting = new Set();
  const rk = id => {
    if (rank.has(id)) return rank.get(id);
    const n = nodes.get(id);
    if (n.kind === 'f') { rank.set(id, -1); return -1; }
    if (visiting.has(id)) return 0;   // cycle guard
    visiting.add(id);
    const r = n.needs.length ? 1 + Math.max(...n.needs.map(rk)) : 0;
    visiting.delete(id);
    rank.set(id, Math.max(0, r));
    return rank.get(id);
  };
  for (const id of nodes.keys()) rk(id);

  // readiness
  const lvOfNeed = m => nodes.get(m).level;
  for (const n of nodes.values()) {
    n.rank = rank.get(n.id);
    n.weak = n.needs.filter(m => (lvOfNeed(m) ?? 0) < READY);
    n.state = n.kind === 'f' ? 'fnd' : n.level >= MASTERED ? 'mastered' : n.weak.length ? 'early' : 'ready';
  }
  return { nodes, tops, hasNeeds, missing: [...missing], focus: meta.focus ? String(meta.focus) : null };
}

// Columns + coordinates. Barycentre sweeps reorder each column; positions are the isotonic (PAV)
// fit of "mean neighbour y" under the no-overlap constraint, so cards sit near what they connect to.
function layout(G) {
  const all = [...G.nodes.values()];
  const fnd = all.filter(n => n.kind === 'f');
  const skills = all.filter(n => n.kind === 's');
  const cols = [];   // { key, label, sub, nodes, kind, bi }
  if (fnd.length) cols.push({ key: 'f', label: 'Foundations', sub: 'external', nodes: fnd, kind: 'f' });
  if (G.hasNeeds) {
    const maxR = Math.max(0, ...skills.map(n => n.rank));
    for (let r = 0; r <= maxR; r++) {
      const ns = skills.filter(n => n.rank === r).sort((a, b) => a.bi - b.bi || cmpId(a.id, b.id));
      cols.push({ key: 't' + r, label: `Tier ${r + 1}`, sub: r === 0 ? 'starting points' : `${ns.length} skill${ns.length === 1 ? '' : 's'}`, nodes: ns, kind: 't' });
    }
  } else {
    G.tops.forEach((t, i) => {
      const ns = skills.filter(n => n.bi === i).sort((a, b) => cmpId(a.id, b.id));
      if (ns.length) cols.push({ key: 'b' + i, label: `${t.id} ${t.name || ''}`.trim(), sub: `${ns.length} skill${ns.length === 1 ? '' : 's'}`, nodes: ns, kind: 'b', bi: i });
    });
  }
  const y = new Map();
  cols.forEach(c => c.nodes.forEach((n, i) => y.set(n.id, i * RH)));
  if (G.hasNeeds) {
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const sweep = (dir, order) => {
      for (const ci of order) {
        const col = cols[ci].nodes;
        const d = new Map(col.map(n => {
          const ns = dir === 'f' ? n.needs : dir === 'b' ? n.deps : [...n.needs, ...n.deps];
          return [n.id, ns.length ? mean(ns.map(m => y.get(m))) : y.get(n.id)];
        }));
        col.sort((a, b) => d.get(a.id) - d.get(b.id) || a.bi - b.bi || cmpId(a.id, b.id));
        pav(col.map(n => d.get(n.id)), RH).forEach((v, i) => y.set(col[i].id, v));
      }
    };
    const fwd = cols.map((_, i) => i), bwd = [...fwd].reverse();
    for (let it = 0; it < 6; it++) sweep(it % 2 ? 'b' : 'f', it % 2 ? bwd : fwd);
    for (let it = 0; it < 3; it++) sweep('both', it % 2 ? bwd : fwd);
    const minY = Math.min(...y.values());
    for (const [k, v] of y) y.set(k, v - minY);
  }
  let maxY = 0;
  cols.forEach((c, ci) => {
    c.x = PAD + ci * (NW + CG);
    for (const n of c.nodes) { n.x = c.x; n.y = PAD + HH + 10 + Math.round(y.get(n.id)); maxY = Math.max(maxY, n.y + NH); }
  });
  return { cols, W: PAD * 2 + cols.length * (NW + CG) - CG, H: maxY + PAD + 8 };
}
function pav(d, gap) {   // min Σ(y_i - d_i)² s.t. y_{i+1} - y_i ≥ gap
  const blocks = [];
  d.forEach((v, i) => {
    blocks.push({ s: v - i * gap, n: 1 });
    while (blocks.length > 1 && blocks.at(-2).s / blocks.at(-2).n > blocks.at(-1).s / blocks.at(-1).n) {
      const b = blocks.pop(); blocks.at(-1).s += b.s; blocks.at(-1).n += b.n;
    }
  });
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.s / b.n + out.length * gap);
  return out;
}

// ---------------------------------------------------------------- zoom
function setZoom(z) {
  if (!ui) return;
  z = Math.max(0.3, Math.min(2.5, z));
  store.set(ZKEY, z);
  ui.sizer.style.width = ui.W * z + 'px';
  ui.sizer.style.height = ui.H * z + 'px';
  ui.stage.style.transform = `scale(${z})`;
  if (ui.zl) ui.zl.textContent = Math.round(z * 100) + '%';
  closePop();
}
const zoomBy = f => setZoom(store.get(ZKEY, 1) * f);
function zoomFit() {
  if (!ui) return;
  const bw = ui.body.clientWidth - 2 * 16, bh = ui.body.clientHeight - 2 * 16;
  setZoom(Math.min(bw / ui.W, bh / ui.H, 1.5));
}
function scrollToNode(id, smooth = false) {
  const n = ui?.nodes.get(id);
  if (!n) return;
  const z = store.get(ZKEY, 1), b = ui.body, s = ui.sizer;
  const left = s.offsetLeft + (n.x + NW / 2) * z - b.clientWidth / 2, top = s.offsetTop + (n.y + NH / 2) * z - b.clientHeight / 2;
  b.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

// ---------------------------------------------------------------- drawing
function draw(center, app, keep = false) {
  if (!center || !app?.topic) return;
  const meta = app.topic.meta || {};
  if (branchSlug !== app.topic.slug) { branchSlug = app.topic.slug; branchHl = ''; }
  const G = buildGraph(meta);
  const body = h('div', { class: 'view-body tree-body' });
  const counts = { ready: 0, early: 0, mastered: 0 };
  for (const n of G.nodes.values()) if (n.kind === 's') {
    if (n.state === 'ready' && n.level <= 1 && n.needs.length) counts.ready++;
    else if (n.state !== 'ready') counts[n.state]++;
  }
  const zl = h('span', { class: 'lvl', id: 'treeZoomLvl' });
  const brSel = h('select', { class: 'tree-select', title: 'Highlight one branch', onchange: e => { branchHl = e.target.value; applyBranch(); } },
    h('option', { value: '', text: 'All branches' }),
    ...G.tops.map((t, i) => h('option', { value: String(i), text: `${t.id} ${t.name || ''}`, selected: branchHl === String(i) })));
  const bar = h('div', { class: 'view-bar tree-bar' },
    h('h1', { text: 'Skill tree' }),
    h('span', { class: 'zoom' },
      h('button', { class: 'icon-btn', title: 'Zoom out', text: '−', onclick: () => zoomBy(1 / 1.15) }),
      zl,
      h('button', { class: 'icon-btn', title: 'Zoom in', text: '+', onclick: () => zoomBy(1.15) }),
      h('button', { class: 'btn btn-tiny', text: 'Fit', title: 'Fit the whole tree in the window', onclick: zoomFit }),
      h('button', { class: 'btn btn-tiny', text: '100%', onclick: () => setZoom(1) })),
    G.focus && G.nodes.has(G.focus) ? h('button', { class: 'btn btn-tiny', text: 'Now', title: `Scroll to the current skill (${G.focus})`, onclick: () => scrollToNode(G.focus, true) }) : null,
    G.tops.length > 1 ? brSel : null,
    h('span', { class: 'spacer' }),
    h('span', { class: 'tree-legend' },
      !G.hasNeeds ? null : h('span', { class: 'tree-key', title: 'Not learned yet, and every prerequisite is at level 2+: a good next step' }, h('span', { class: 'tree-mark ready', text: 'ready' }), String(counts.ready)),
      !G.hasNeeds ? null : h('span', { class: 'tree-key', title: 'Some prerequisite is still below level 2 (you can still study it: prerequisites are soft)' }, h('span', { class: 'tree-mark early' }, warnIcon()), `early ${counts.early}`),
      h('span', { class: 'tree-key mastered', title: 'Level 4+ (independent)' }, h('i'), `mastered ${counts.mastered}`),
      !(meta.foundations || []).length ? null : h('span', { class: 'tree-key fnd', title: 'Knowledge from outside this topic' }, h('i'), 'foundation'),
      !G.hasNeeds ? null : h('span', { class: 'tree-key edges', title: 'Hover or select a skill: blue = what it needs, purple = what it unlocks' }, h('b', { class: 'up' }), 'needs', h('b', { class: 'down' }), 'unlocks')),
    levelScale());
  const hints = [];
  if (!G.hasNeeds) hints.push(h('div', { class: 'tree-hint' }, 'No prerequisites recorded yet: the tutor adds ', h('code', { text: 'needs' }), ' to topic.json. Showing one column per branch.'));
  if (G.missing.length) hints.push(h('div', { class: 'tree-hint warn' }, `Unknown prerequisite id${G.missing.length > 1 ? 's' : ''} in needs (not a skill or foundation): `, h('code', { text: G.missing.join(', ') })));
  center.replaceChildren(h('div', { class: 'view tree-view' }, bar, hints.length ? h('div', { class: 'tree-hints' }, ...hints) : null, body));
  if (!G.nodes.size || ![...G.nodes.values()].some(n => n.kind === 's')) {
    ui = null;
    body.append(h('div', { class: 'empty', text: 'No skills in topic.json yet. The tutor builds the skill tree as the topic takes shape.' }));
    return;
  }

  const L = layout(G);
  const stage = h('div', { class: 'tree-stage', style: { width: L.W + 'px', height: L.H + 'px' } });
  const sizer = h('div', { class: 'tree-sizer' }, stage);
  body.append(h('div', { class: 'tree-canvas' }, sizer));
  ui = { stage, sizer, body, W: L.W, H: L.H, nodes: G.nodes, zl, edges: [], G, popover: null };

  // lanes (column backgrounds) with headers
  L.cols.forEach((c, ci) => {
    const br = c.kind === 'b' ? `var(--r${c.bi % 6})` : null;
    stage.append(h('div', { class: `tree-lane ${c.kind === 'f' ? 'fnd' : ''} ${ci % 2 ? 'odd' : ''}`, style: { left: c.x - LANE + 'px', top: PAD - 8 + 'px', width: NW + 2 * LANE + 'px', height: L.H - PAD + 'px', ...(br ? { '--br': br } : {}) } },
      h('div', { class: 'tree-lane-h' + (br ? ' br' : ''), title: c.label + ' · ' + c.sub },
        h('span', { class: 'tree-lane-t', text: c.label }), h('span', { class: 'tree-lane-s', text: c.sub }))));
  });

  // edges
  const svg = d3.select(stage).append('svg').attr('class', 'tree-edges').attr('width', L.W).attr('height', L.H).attr('viewBox', `0 0 ${L.W} ${L.H}`);
  const defs = svg.append('defs');
  for (const k of ['base', 'up', 'down']) defs.append('marker').attr('id', 'tree-arr-' + k).attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto').append('path').attr('d', 'M0,1 L10,5 L0,9 z').attr('class', 'tree-ah ' + k);
  // spread ports: outgoing sorted by target y on the right side, incoming by source y on the left
  const outPort = new Map(), inPort = new Map();
  const port = (list, i) => list.length < 2 ? NH / 2 : NH * 0.22 + (NH * 0.56) * i / (list.length - 1);
  for (const n of G.nodes.values()) {
    const outs = [...n.deps].sort((a, b) => G.nodes.get(a).y - G.nodes.get(b).y);
    outs.forEach((d, i) => outPort.set(n.id + '>' + d, port(outs, i)));
    const ins = [...n.needs].sort((a, b) => G.nodes.get(a).y - G.nodes.get(b).y);
    ins.forEach((m, i) => inPort.set(m + '>' + n.id, port(ins, i)));
  }
  const eg = svg.append('g');
  for (const n of G.nodes.values()) for (const m of n.needs) {
    const a = G.nodes.get(m), k = m + '>' + n.id;
    const x1 = a.x + NW, y1 = a.y + outPort.get(k), x2 = n.x - 2, y2 = n.y + inPort.get(k);
    const c = Math.max(30, Math.min(110, (x2 - x1) / 2));
    const weak = (a.level ?? 0) < READY;
    const p = eg.append('path').attr('d', `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`)
      .attr('class', 'tree-edge' + (a.kind === 'f' ? ' fnd' : '') + (weak ? ' weak' : ''));
    ui.edges.push({ from: m, to: n.id, el: p.node() });
  }

  // nodes
  const nameOf = id => { const x = G.nodes.get(id); return x ? (x.kind === 'f' ? x.name : `${x.id} ${x.name}`) : id; };
  const lvTxt = id => { const x = G.nodes.get(id); return x.level == null ? 'not estimated' : `level ${fmtLevel(x.level)}`; };
  for (const n of G.nodes.values()) {
    const isF = n.kind === 'f', lv = n.level ?? 0, fog = !isF && lv === 0;
    const cls = ['tree-node', isF ? 'fnd' : '', lvClass(lv), fog ? 'fog' : '', 'st-' + n.state, n.id === G.focus ? 'now' : '', isF && n.level == null ? 'unest' : ''].filter(Boolean).join(' ');
    const weakTip = n.weak.length ? 'Prerequisites below level 2:\n' + n.weak.map(m => `• ${nameOf(m)} (${lvTxt(m)})`).join('\n') : '';
    const needTip = n.needs.length ? '\nNeeds: ' + n.needs.join(', ') : '';
    const title = isF
      ? `${n.name}\nFoundation (outside this topic) · ${n.level == null ? 'level not estimated' : `level ${fmtLevel(lv)}/5 · ${LEVEL_NAMES[Math.round(lv)]}`}\nNeeded by: ${n.deps.join(', ') || 'nothing yet'}`
      : `${n.id} ${n.name}\nlevel ${fmtLevel(lv)}/5 · ${LEVEL_NAMES[Math.round(lv)]}${needTip}\n${n.state === 'early' ? weakTip : n.state === 'ready' && n.needs.length ? 'Ready: every prerequisite is at level 2+' : ''}`.trim();
    const marks = [];
    if (n.id === G.focus) marks.push(h('span', { class: 'tree-mark now', text: 'now', title: 'Current focus skill' }));
    if (!isF && n.state === 'early') marks.push(h('span', { class: 'tree-mark early', title: weakTip }, warnIcon(), String(n.weak.length)));
    else if (!isF && n.state === 'ready' && lv <= 1 && n.needs.length) marks.push(h('span', { class: 'tree-mark ready', text: 'ready', title: 'Every prerequisite is at level 2+: a good next step' }));
    if (isF && n.f.topic) marks.push(h('span', { class: 'tree-mark topic', text: 'topic', title: `Has its own topic: ${n.f.topic}` }));
    const el = h('button', {
      class: cls, 'data-id': n.id, title,
      style: { left: n.x + 'px', top: n.y + 'px', width: NW + 'px', height: NH + 'px', ...(isF ? {} : { '--br': `var(--r${n.bi % 6})` }) },
      onclick: ev => { ev.stopPropagation(); isF ? openFoundation(n.id) : selectSkill(n.id); },
      onmouseenter: () => hot(n.id), onmouseleave: () => hot(selected),
      onfocus: () => hot(n.id), onblur: () => hot(selected),
    },
      h('span', { class: 'tree-stripe' }),
      h('span', { class: 'tree-n-top' },
        h('span', { class: 'tree-id', text: isF ? 'FND' : n.id }),
        h('span', { class: 'tree-name', text: n.name })),
      h('span', { class: 'tree-n-bot' },
        isF && n.level == null ? h('span', { class: 'lv l0', text: '?', title: 'level not estimated' }) : lvChip(lv),
        h('span', { class: 'tree-lvname', text: isF && n.level == null ? 'not estimated' : SHORT[Math.round(lv)] }),
        ...marks));
    n.el = el;
    stage.append(el);
  }
  stage.addEventListener('click', () => closePop());
  ui.onKey = ev => { if (ev.key === 'Escape') closePop(); };
  body.addEventListener('keydown', ui.onKey);

  setZoom(store.get(ZKEY, 1));
  applyBranch();
  hot(selected);
  if (selected && G.nodes.get(selected)?.kind === 's') markSel(selected);
  if (!keep) requestAnimationFrame(() => {
    const target = selected && G.nodes.has(selected) ? selected : G.focus;
    if (target && G.nodes.has(target)) scrollToNode(target);
    if (selected && G.nodes.get(selected)?.kind === 'f') openFoundation(selected);
    else if (selected && G.nodes.has(selected)) openDock('skill', selected);
  });
}

function warnIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'tree-warn'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.2v3.6M8 11.6v.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
  return s;
}

// highlight the full prerequisite chain (upstream) and everything it unlocks (downstream)
function hot(id) {
  if (!ui) return;
  const G = ui.G, on = !!id && G.nodes.has(id) && G.hasNeeds;
  ui.stage.classList.toggle('hl', on);
  const up = new Set(), down = new Set();
  if (on) {
    const walk = (x, key, set) => { for (const y of G.nodes.get(x)[key]) if (!set.has(y)) { set.add(y); walk(y, key, set); } };
    walk(id, 'needs', up); walk(id, 'deps', down);
  }
  for (const n of G.nodes.values()) {
    n.el.classList.toggle('self', on && n.id === id);
    n.el.classList.toggle('up', up.has(n.id));
    n.el.classList.toggle('down', down.has(n.id));
  }
  for (const e of ui.edges) {
    const u = on && (up.has(e.from) && (e.to === id || up.has(e.to)));
    const d = on && ((e.from === id || down.has(e.from)) && down.has(e.to));
    e.el.classList.toggle('up', u); e.el.classList.toggle('down', d);
    e.el.setAttribute('marker-end', `url(#tree-arr-${u ? 'up' : d ? 'down' : 'base'})`);
  }
}
function applyBranch() {
  if (!ui) return;
  const on = branchHl !== '';
  ui.stage.classList.toggle('brf', on);
  for (const n of ui.G.nodes.values()) n.el.classList.toggle('inb', on && String(n.bi) === branchHl);
  for (const e of ui.edges) e.el.classList.toggle('inb', on && [e.from, e.to].some(x => String(ui.G.nodes.get(x).bi) === branchHl));
}
function markSel(id) { for (const n of ui.G.nodes.values()) n.el.classList.toggle('sel', n.id === id); }

function selectSkill(id) {
  closePop();
  selected = id;
  markSel(id);
  hot(id);
  const slug = appRef?.topic?.slug;
  if (slug && location.hash.startsWith(`#/${slug}/tree`)) history.replaceState(null, '', `#/${slug}/tree/${encodeURIComponent(id)}`);
  openDock('skill', id);
}

// ---------------------------------------------------------------- foundation popover
function closePop() { if (ui?.popover) { ui.popover.remove(); ui.popover = null; } }
function openFoundation(id) {
  if (!ui) return;
  closePop();
  const n = ui.G.nodes.get(id);
  if (!n) return;
  selected = id; markSel(id); hot(id);
  const f = n.f, z = store.get(ZKEY, 1);
  const lv = n.level;
  const go = f.topic
    ? h('button', { class: 'btn btn-primary', text: 'Open topic', title: `Go to the “${f.topic}” topic`, onclick: () => { location.hash = '#/' + f.topic; } })
    : h('button', { class: 'btn btn-primary', text: 'Learn this as a topic', title: 'Start a new topic for this foundation', onclick: () => { location.hash = '#/new?goal=' + encodeURIComponent(f.name || f.id); } });
  const pop = h('div', { class: 'tree-pop', style: { left: (n.x + NW + 12) * z + 'px', top: Math.max(0, n.y * z - 6) + 'px' }, onclick: ev => ev.stopPropagation() },
    h('div', { class: 'tree-pop-h' },
      h('span', { class: 'tree-pop-k', text: 'Foundation · outside this topic' }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Close  Esc', text: '×', onclick: () => { closePop(); selected = null; markSel(null); hot(null); } })),
    h('div', { class: 'tree-pop-b' },
      h('div', { class: 'tree-pop-name', text: f.name || f.id }),
      h('div', { class: 'tree-pop-lv' },
        lv == null ? h('span', { class: 'lv l0', text: '?' }) : lvChip(lv),
        h('span', { text: lv == null ? 'level not estimated yet' : `estimated ${fmtLevel(lv)} / 5 · ${LEVEL_NAMES[Math.round(lv)]}` })),
      f.why ? h('p', { class: 'tree-pop-why', text: f.why }) : h('p', { class: 'tree-pop-why muted', text: 'No note yet on why this topic builds on it.' }),
      n.deps.length ? h('div', { class: 'tree-pop-deps' }, h('span', { class: 'muted small', text: 'Needed by' }),
        ...n.deps.slice().sort(cmpId).map(d => { const s = ui.G.nodes.get(d); return h('button', { class: 'chip chip-btn ' + lvClass(s.level), title: s.name, onclick: () => selectSkill(d) }, h('b', { text: d }), ' ', s.name.length > 26 ? s.name.slice(0, 25) + '…' : s.name); })) : null,
      h('div', { class: 'tree-pop-act' }, go)));
  ui.sizer.append(pop);
  ui.popover = pop;
}
