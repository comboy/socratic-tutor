// `bin/learn viz-check`: draw a message's (or a markdown file's) viz blocks in headless Chrome, the
// way the app draws them, in the light and the dark theme; report what can be measured (JS errors,
// error boxes, text over text, text under a shape, text that can't be read against its background
// in one theme, text cut off at the drawing's edge, tiny text, a drawing wider than the message) and save PNGs for the tutor to look at.
//
// Why: `post` only parses a drawing. One evening four drawings went out wrong (hidden labels, a
// helix running the wrong way, a colour that meant something else, a "collision" that didn't
// touch) and each was caught only by a subagent rendering a copy by hand. Half of those a machine
// can measure; the other half need eyes, which is what the PNGs are for. The learner prefers a
// fast reply that is checked right after and corrected in place (`post --corrects`) over a slower
// one checked first, so this is made to run in the background after posting.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const S = require('./store');

const WEB = path.join(S.CODE, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*viz[ \t]+([A-Za-z0-9_-]+)[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm;

// The page: the app's own styles and renderer around one message, nothing else.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/vendor/katex/katex.min.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/tree.css">
<script src="/vendor/d3.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/katex/katex.min.js"></script>
<style>html, body { height: auto; overflow: visible; } body { display: block; } .thread { margin: 0; }</style></head>
<body><div class="thread"><article class="msg msg-tutor kind-message hl-scope"><div class="md msg-body" id="body"></div></article></div>
<script type="module">
  const theme = new URLSearchParams(location.search).get('theme');
  if (theme) document.documentElement.dataset.theme = theme;
  try {
    const { configure, renderInto } = await import('/js/rich.js');
    const d = await (await fetch('/__data')).json();
    configure({ terms: d.glossary, media: { slug: d.slug || 'x', index: d.media || {} }, legend: d.legend || [] });
    renderInto(document.getElementById('body'), d.text, { scope: false });
    await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    await document.fonts?.ready;
  } catch (e) { window.__failed = String(e.stack || e); }
  window.__done = true;
</script></body></html>`;

// Runs in the page. -> [{ type, w, h, rect: [x, y, w, h], problems: [{ kind, text }], notes: [...] }]
// Thresholds are deliberately loose: a false alarm costs the tutor a look at a PNG it should look
// at anyway; a miss costs the learner a wrong drawing.
function analyse() {
  const body = document.getElementById('body');
  const style = document.createElement('style');
  // text is found by hit-testing, and drawings often switch pointer events off on labels
  style.textContent = '#body .viz, #body .viz * { pointer-events: auto !important; }';
  document.head.append(style);
  const short = s => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > 40 ? s.slice(0, 39) + '…' : s; };
  const opacityOf = el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentNode) o *= Number(getComputedStyle(n).opacity) || 0; return o; };
  const rgba = c => { const m = String(c).match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(Number); return p.length >= 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2], p[3] ?? 1] : null; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = [];
  for (const viz of body.querySelectorAll('.viz')) {
    if (viz.parentElement.closest('.viz')) continue;   // a drawing inside a drawing (viz steps): its parent covers it
    const box = viz.getBoundingClientRect();
    const r = { type: [...viz.classList].find(c => c.startsWith('viz-') && c !== 'viz-error')?.slice(4) || '?', rect: [box.x + scrollX, box.y + scrollY, box.width, box.height], problems: [], notes: [] };
    out.push(r);
    const bad = (kind, text) => { if (!r.problems.some(p => p.kind === kind && p.text === text)) r.problems.push({ kind, text }); };
    if (viz.classList.contains('viz-error')) { bad('error', viz.querySelector('.viz-err-msg')?.textContent || 'error box'); continue; }
    if (box.height < 8 || !viz.querySelector('svg, canvas, img, div, table, span')) { bad('empty', 'the drawing is empty (nothing was appended to el)'); continue; }
    if (viz.scrollWidth > viz.clientWidth + 2) bad('wide', `the drawing is ${viz.scrollWidth}px wide in a ${viz.clientWidth}px column: it scrolls or is cut off (use a viewBox with width 100%)`);
    // every piece of text a reader sees: SVG <text>, and text nodes of the HTML parts
    const texts = [];
    for (const t of viz.querySelectorAll('svg text')) {
      const s = t.textContent.trim(); if (!s) continue;
      if (!t.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || opacityOf(t) < 0.05) continue;
      const b = t.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
      const m = t.getScreenCTM(), scale = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
      texts.push({ el: t, s, b, px: parseFloat(getComputedStyle(t).fontSize) * scale, svg: t.ownerSVGElement });
    }
    const walker = document.createTreeWalker(viz, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode, p = n.parentElement, s = n.nodeValue.trim();
      if (!s || p.closest('svg, details, script, style, button, input, select, .katex-mathml')) continue;
      if (!p.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const b = range.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
      texts.push({ el: p, s, b, px: parseFloat(getComputedStyle(p).fontSize), html: true, katex: !!p.closest('.katex') });
    }
    // glyphs fill roughly the middle of their line box: compare those, so neighbouring lines don't count
    const ink = t => { const pad = Math.min(t.b.height * 0.22, 5); return { l: t.b.left, r: t.b.right, t: t.b.top + pad, b: t.b.bottom - pad }; };
    for (const t of texts) {
      // can it be read against what's behind it? (black text is the SVG default: gone in the dark theme)
      const fg = rgba(t.html ? getComputedStyle(t.el).color : getComputedStyle(t.el).fill);
      if (fg && fg[3] > 0.05) {
        const k = ink(t), x = (k.l + k.r) / 2, y = (k.t + k.b) / 2;
        let bg = null;
        for (const u of document.elementsFromPoint(x, y)) {
          if (u === t.el || t.el.contains(u) || u.closest('text') === t.el || u.tagName === 'text' || u.tagName === 'tspan') continue;
          const cs = getComputedStyle(u), c = rgba(u.closest('svg') && u.tagName !== 'svg' ? cs.fill : cs.backgroundColor);
          if (c && c[3] * (u.closest('svg') && u.tagName !== 'svg' ? Number(cs.fillOpacity || 1) * opacityOf(u) : 1) >= 0.5) { bg = c; break; }
        }
        if (bg) {
          const cr = contrast(fg, bg);
          if (cr < 1.6) bad('faint', `"${short(t.s)}" is ${cr < 1.25 ? 'invisible' : 'barely visible'} against what is behind it (contrast ${cr.toFixed(1)}; draw text with fill var(--fg) or var(--muted), not a fixed black or white)`);
          else if (cr < 2.2 && !r.notes.some(x => x.startsWith('low contrast'))) r.notes.push(`low contrast: "${short(t.s)}" against what is behind it (${cr.toFixed(1)}; 3 or more reads comfortably)`);
        }
      }
      if (!t.katex && t.px < 9.5) bad('tiny', `"${short(t.s)}" is drawn at ${t.px.toFixed(1)}px (hard to read; keep text at 11px or more on screen)`);
      if (t.svg) {
        const sb = t.svg.getBoundingClientRect(), o = getComputedStyle(t.svg).overflow;
        const cut = Math.max(sb.left - t.b.left, t.b.right - sb.right, sb.top - t.b.top - 2, t.b.bottom - sb.bottom - 2);
        if (o !== 'visible' && cut > 2) bad('cut', `"${short(t.s)}" runs ${Math.round(cut)}px past the edge of the drawing and is cut off`);
      }
      const vb = viz.getBoundingClientRect();
      if (t.b.right > vb.right + 2 || t.b.left < vb.left - 2) bad('cut', `"${short(t.s)}" sticks out of the drawing's box`);
      // is something painted over it? hit-test a grid of points on the text: a shape drawn after a
      // label hides it whole or in part (a thin line through one spot is normal and not counted)
      if (!t.katex) {
        const k = ink(t), covers = new Map();
        let n = 0, hit = 0; const cols = new Set();
        for (let xi = 0; xi < 9; xi++) for (const fy of [0.25, 0.5, 0.75]) {
          const x = k.l + (k.r - k.l) * (xi + 0.5) / 9, y = k.t + (k.b - k.t) * fy;
          n++;
          const top = document.elementFromPoint(x, y);
          if (!top || top === t.el || t.el.contains(top) || top.contains(t.el) || !viz.contains(top)) continue;
          if (top.closest('text') === t.el || (t.html && !top.closest('svg') && getComputedStyle(top).backgroundColor === 'rgba(0, 0, 0, 0)')) continue;
          if (top.tagName.toLowerCase() === 'text' || top.tagName.toLowerCase() === 'tspan' || (!top.closest('svg') && top.textContent.trim())) continue;   // text over text: reported as overlap
          const cs = getComputedStyle(top);
          const inSvg = top.closest('svg') && top.tagName.toLowerCase() !== 'svg';
          // a hit on a stroke-only shape is its line; on a filled one, its fill
          const filled = inSvg && cs.fill !== 'none' && Number(cs.fillOpacity || 1) > 0;
          const alpha = opacityOf(top) * (inSvg ? (filled ? Number(cs.fillOpacity || 1) : Number(cs.strokeOpacity || 1)) : 1);
          if (alpha < 0.55) continue;
          hit++; cols.add(xi); covers.set(top.tagName.toLowerCase(), (covers.get(top.tagName.toLowerCase()) || 0) + 1);
        }
        if (cols.size >= 2 && hit / n >= 0.15) bad('covered', `"${short(t.s)}" is ${hit / n > 0.6 ? 'hidden' : 'partly hidden'} under ${[...covers.keys()].map(x => '<' + x + '>').join(', ')} drawn over it (${Math.round(100 * hit / n)}% of it; move the label clear, or draw labels last)`);
      }
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], c = texts[j];
      if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
      if (a.katex && c.katex) continue;   // KaTeX stacks its own boxes
      const A = ink(a), C = ink(c);
      const w = Math.min(A.r, C.r) - Math.max(A.l, C.l), hgt = Math.min(A.b, C.b) - Math.max(A.t, C.t);
      if (w <= 1.5 || hgt <= 1.5) continue;
      const small = Math.min((A.r - A.l) * (A.b - A.t), (C.r - C.l) * (C.b - C.t));
      if (w * hgt > 0.12 * small) bad('overlap', `"${short(a.s)}" and "${short(c.s)}" overlap`);
    }
    if (viz.querySelector('input[type=range], .steps-bar, button')) r.notes.push('interactive (slider, steps or buttons): only the first state was checked');
  }
  style.remove();
  return out;
}

const LABEL = { error: 'error box', empty: 'empty', wide: 'too wide', tiny: 'tiny text', cut: 'text cut off', covered: 'hidden text', faint: 'unreadable text', overlap: 'overlapping text' };

async function check({ text, topic = null, label = 'check', outDir = null, width = 900, log = () => {} }) {
  const blocks = [...String(text).matchAll(FENCE)].map(m => ({ type: m[2].toLowerCase(), line: text.slice(0, m.index).split('\n').length }));
  if (!blocks.length) return { drawings: [], errors: [], dir: null, none: true };
  const { launch, chromePath } = await import(path.join(S.CODE, 'test', 'lib', 'chrome.mjs'));
  if (!chromePath()) throw new Error('viz-check needs Chrome or Chromium to draw with, and found none (install one, or set CHROME=/path/to/it; `bin/learn doctor` shows where it looks)');
  const meta = topic ? S.loadTopicMeta(topic) : {};
  const data = { text, slug: topic, glossary: topic ? S.readGlossary(topic) : [], legend: Array.isArray(meta.legend) ? meta.legend : [], media: topic ? S.readMedia(topic) : {} };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (code, body, type) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (p === '/__check.html') return send(200, PAGE, MIME['.html']);
    if (p === '/__data') return send(200, JSON.stringify(data), MIME['.json']);
    const mm = p.match(/^\/media\/([a-z0-9][a-z0-9-]*)\/([^/]+)$/);
    let file = mm ? (topic && mm[1] === topic && S.MEDIA_NAME.test(mm[2]) ? path.join(S.mediaDir(topic), mm[2]) : null) : path.normalize(path.join(WEB, p));
    if (!file || (!mm && !file.startsWith(WEB + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'not found', 'text/plain');
    send(200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = outDir || path.join(S.STATE, 'viz-check', label.replace(/[^\w.-]+/g, '-'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let page;
  const drawings = blocks.map((b, i) => ({ n: i + 1, ...b, problems: [], notes: [], png: {} }));
  const errors = [];
  try {
    page = await launch({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.size(width, 900);
      await page.dark(theme === 'dark');
      page.errors.length = 0;
      // (a load that never finishes was seen once in ~40 runs on a busy machine: try again before giving up)
      for (let attempt = 1; ; attempt++) {
        await page.nav(`${base}/__check.html?theme=${theme}&try=${attempt}`, 200);
        try { await page.waitFor('window.__done', { timeout: 12000 }); break; }
        catch (e) { if (attempt >= 3) throw new Error('the check page did not finish loading in headless Chrome (tried 3 times)'); }
      }
      const failed = await page.eval('window.__failed || null');
      if (failed) throw new Error('the check page did not load: ' + failed);
      await new Promise(r => setTimeout(r, 900));   // transitions and entry animations settle
      // everything in view: hit-testing and screenshots only see the viewport
      const height = Math.min(12000, Math.max(300, await page.eval('Math.ceil(document.documentElement.scrollHeight)')));
      await page.size(width, height);
      await new Promise(r => setTimeout(r, 150));
      const found = await page.eval(`(${analyse.toString()})()`);
      for (const e of page.errors) if (!errors.some(x => x.text === e)) errors.push({ text: e, themes: [theme] }); else errors.find(x => x.text === e).themes.push(theme);
      fs.writeFileSync(path.join(dir, `message-${theme}.png`), await page.png());
      found.forEach((f, i) => {
        const d = drawings[i] || (drawings[i] = { n: i + 1, type: f.type, line: null, problems: [], notes: [], png: {} });
        for (const p of f.problems) { const q = d.problems.find(x => x.kind === p.kind && x.text === p.text); if (q) q.themes.push(theme); else d.problems.push({ ...p, themes: [theme] }); }
        for (const n of f.notes) if (!d.notes.includes(n)) d.notes.push(n);
        d.rect = f.rect;
      });
      for (const d of drawings) {
        if (!d.rect) continue;
        const [x, y, w, h] = d.rect, pad = 6;
        const file = path.join(dir, `${d.n}-${theme}.png`);
        fs.writeFileSync(file, await page.png({ x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: Math.min(width, w + 2 * pad), height: Math.min(4000, h + 2 * pad), scale: 2 }));
        d.png[theme] = file;
      }
      // a block the page never drew (inside a fence the renderer treats otherwise): say so, once
      if (theme === 'light') for (const d of drawings) if (!d.rect) d.notes.push('not found on the page (is the block nested in other markup?)');
    }
  } finally {
    try { await page?.close(); } catch {}
    server.close();
  }
  pruneOld(path.dirname(dir), dir);
  return { drawings, errors, dir, width };
}
// state/viz-check keeps the last few checks; older folders go
function pruneOld(root, keep, n = 12) {
  try {
    const all = fs.readdirSync(root).map(f => path.join(root, f)).filter(f => f !== keep && fs.statSync(f).isDirectory()).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const f of all.slice(n - 1)) fs.rmSync(f, { recursive: true, force: true });
  } catch {}
}

function report(r, what) {
  if (r.none) return `${what}: no viz blocks to check.`;
  const lines = [], rel = p => S.shown(p);
  const bad = r.drawings.filter(d => d.problems.length).length;
  lines.push(`viz-check ${what}: ${r.drawings.length} drawing${r.drawings.length > 1 ? 's' : ''}, light and dark, ${r.width}px wide: ${bad || r.errors.length ? `${bad} with problems${r.errors.length ? `, ${r.errors.length} JS error(s)` : ''}` : 'nothing measurable is wrong'}`);
  for (const e of r.errors) lines.push(`  ✗ JS error (${e.themes.join(', ')}): ${String(e.text).split('\n')[0]}`);
  for (const d of r.drawings) {
    lines.push(`#${d.n} viz ${d.type}${d.line ? ` (line ${d.line})` : ''}: ${d.problems.length ? d.problems.length + ' problem(s)' : 'ok'}`);
    // the same fault on many labels (every axis tick too small): the first few say it
    const shown = new Map();
    for (const p of d.problems) {
      const k = shown.get(p.kind) || 0; shown.set(p.kind, k + 1);
      if (k < 3) lines.push(`  ✗ ${LABEL[p.kind] || p.kind}: ${p.text}${p.themes.length < 2 ? ` (${p.themes[0]} theme only)` : ''}`);
    }
    for (const [kind, k] of shown) if (k > 3) lines.push(`  ✗ ${LABEL[kind] || kind}: … and ${k - 3} more like that`);
    for (const n of d.notes) lines.push(`  · ${n}`);
    if (Object.keys(d.png).length) lines.push(`  look: ${Object.values(d.png).map(rel).join('  ')}`);
  }
  lines.push(`whole message: ${rel(path.join(r.dir, 'message-light.png'))}  ${rel(path.join(r.dir, 'message-dark.png'))}`);
  lines.push('Now look at the PNGs (Read shows them): only eyes can tell whether the drawing shows the right thing: directions, what each colour means, things that should touch or line up, labels next to what they name.');
  return lines.join('\n');
}

// bin/learn viz-check [t] <message id | file.md | -> [--width px] [--out dir]
async function cli(f, topicOf, readStdin) {
  const src = f._[f._.length - 1];
  if (!src) throw new Error('usage: viz-check [topic] <message id | file.md | -> [--width 900] [--out dir]   (- reads markdown from stdin)');
  let text, topic, label, what;
  const isFile = src !== '-' && fs.existsSync(src) && fs.statSync(src).isFile();
  if (src === '-' || isFile) {
    f._.pop();
    text = isFile ? fs.readFileSync(src, 'utf8') : readStdin();
    try { topic = topicOf(f); } catch { topic = null; }   // a topic gives its legend, glossary and images
    label = isFile ? path.basename(src).replace(/\.\w+$/, '') : 'stdin';
    what = isFile ? S.shown(path.resolve(src)) : 'stdin';
  } else {
    f._.pop();
    const m = String(src).replace(/^msg:|^#/, '').match(/^(?:([a-z0-9][a-z0-9-]*)\/)?(\d{4}-\d{2}-\d{2}\.\d+)$/);
    if (!m) throw new Error(`${src} is not a file or a message id (like 2026-11-25.38)`);
    if (m[1]) f.topic = m[1];
    topic = topicOf(f);
    const e = S.readJournal(topic).find(x => x.id === m[2]);
    if (!e || typeof e.text !== 'string') throw new Error(`no message ${m[2]} in ${topic}`);
    text = e.text; label = `${topic}-${m[2]}`; what = `${topic}/${m[2]}`;
  }
  const r = await check({ text, topic, label, outDir: f.out ? path.resolve(f.out) : null, width: Math.max(320, Math.min(2400, Number(f.width) || 900)) });
  console.log(report(r, what));
  if (!r.none && (r.errors.length || r.drawings.some(d => d.problems.length))) {
    if (what.includes('/') && /\d{4}-\d{2}-\d{2}\.\d+$/.test(what)) console.log(`Already posted: fix it and put it right in place with \`bin/learn post --corrects ${what.split('/')[1]} --note "what changed"\` (the whole message on stdin).`);
    process.exitCode = 1;
  }
}

module.exports = { check, report, cli };
