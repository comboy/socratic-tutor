// Markdown rendering with the workspace extensions:
//   $math$ / $$math$$ (KaTeX, with \k{key}{tex} highlight keys)
//   {{text|key}} linked-highlight spans
//   :::question / :::note / :::recap / :::insight / :::warn / :::details Title  containers
//   :::fog  what's beyond what the learner has covered, drawn faded ("Not covered yet")
//   ```viz <type>``` visualization blocks (mounted after insertion via mountViz)
//   [x](msg:ID) [x](term:T) [x](skill:ID) [x](map:NODE) [x](wiki:PAGE) internal links (spaces allowed)
//   [x](tip:a note for this message) per-message hover note (spaces and one level of (…) allowed)
//   ![caption](media:file.png) a downloaded image from the topic's media/ folder, with its credit
/* global marked, katex */
import { commonsName } from './commons.js';

const KATEX_OPTS = {
  throwOnError: false,
  strict: false,
  trust: ctx => ctx.command === '\\htmlData' || ctx.command === '\\htmlClass',
  macros: { '\\k': '\\htmlData{k=#1}{#2}' },
};

export function renderMath(tex, display) {
  try { return katex.renderToString(tex, { ...KATEX_OPTS, displayMode: display }); }
  catch (e) { return `<code class="math-error">${esc(tex)}</code>`; }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CONTAINERS = new Set(['question', 'note', 'recap', 'insight', 'warn', 'details', 'example', 'tip', 'fog']);
const LABELS = { question: 'Question', note: 'Note', recap: 'Recap', insight: 'Insight', warn: 'Careful', example: 'Example', tip: 'Tip', fog: 'Not covered yet' };

// Turn ::: containers into HTML blocks marked will pass through (markdown inside still parsed).
function containers(src) {
  const lines = src.split('\n');
  const out = [];
  const stack = [];
  let fence = null;
  for (const line of lines) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (!fence) fence = f[1]; else if (line.trim().startsWith(fence)) fence = null;
      out.push(line); continue;
    }
    if (fence) { out.push(line); continue; }
    const open = line.match(/^:::\s*([a-z]+)\s*(.*)$/);
    if (open && CONTAINERS.has(open[1])) {
      const type = open[1], title = open[2].trim();
      stack.push(type);
      if (type === 'details') out.push('', `<details class="callout callout-details"><summary>${esc(title || 'More')}</summary><div class="callout-body">`, '');
      else out.push('', `<div class="callout callout-${type}"><div class="callout-label">${esc(title || LABELS[type])}</div><div class="callout-body">`, '');
      continue;
    }
    if (/^:::\s*$/.test(line) && stack.length) {
      const type = stack.pop();
      out.push('', type === 'details' ? '</div></details>' : '</div></div>', '');
      continue;
    }
    out.push(line);
  }
  while (stack.length) { const t = stack.pop(); out.push('', t === 'details' ? '</div></details>' : '</div></div>', ''); }
  return out.join('\n');
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

// Downloaded images (topics/<slug>/media/, `bin/learn image`): set per topic by rich.configure.
let media = { slug: null, index: {}, lookup: new Map() };
export function setMedia(slug, index = {}) {
  const lookup = new Map();
  for (const [file, m] of Object.entries(index || {})) {
    for (const u of m.from || []) lookup.set(u, file);
    const n = commonsName(m.title || '');
    if (n) lookup.set(n, file);
  }
  media = { slug, index: index || {}, lookup };
}
// media:<file>, or a hotlinked Commons URL whose file was downloaded -> { src, info }
function localImage(href) {
  if (!media.slug) return null;
  const m = href.match(/^media:(.+)$/);
  const file = m ? decodeURIComponentSafe(m[1]).trim()
    : /^https?:/i.test(href) ? media.lookup.get(href.replace(/[?#].*$/, '')) || media.lookup.get(commonsName(href)) : null;
  return file ? { src: `/media/${media.slug}/${encodeURIComponent(file)}`, info: media.index[file] || null } : null;
}

let vizSeq = 0;
export const vizSpecs = new Map(); // id -> {type, src}

function makeRenderer() {
  const r = new marked.Renderer();
  r.code = (code, info) => {
    const lang = (info || '').trim();
    const m = lang.match(/^viz\s+([a-z0-9_-]+)/i);
    if (m) {
      const id = 'v' + (++vizSeq);
      vizSpecs.set(id, { type: m[1].toLowerCase(), src: code });
      return `<div class="viz viz-${esc(m[1])}" data-viz="${id}"></div>`;
    }
    return `<pre><code${lang ? ` class="lang-${esc(lang.split(/\s/)[0])}"` : ''}>${esc(code)}</code></pre>`;
  };
  // marked has already escaped the alt text and title
  r.image = (href, title, text) => {
    const loc = localImage(String(href || ''));
    if (!loc) return marked.Renderer.prototype.image.call(r, href, title, text);
    const i = loc.info, cap = text || title || '';
    const credit = i ? [i.author, i.license].filter(Boolean).map(esc).join(' · ') + (i.source ? ` · <a href="${esc(i.source)}" target="_blank" rel="noopener">source</a>` : '') : '';
    return `<span class="media-fig"><img src="${loc.src}" alt="${text}" loading="lazy"><span class="media-cap">${cap ? `<span class="media-cap-text">${cap}</span>` : ''}${credit ? `<span class="media-credit">${credit}</span>` : ''}</span></span>`;
  };
  r.link = (href, title, text) => {
    const m = String(href || '').match(/^(msg|term|skill|map|wiki|tip):(.+)$/);
    if (m && m[1] === 'tip') return `<span class="tipref" data-tip="${esc(decodeURIComponentSafe(m[2]))}">${text}</span>`;
    if (m) return `<button type="button" class="ref ref-${m[1]}" data-ref="${m[1]}" data-id="${esc(decodeURIComponentSafe(m[2]))}">${text}</button>`;
    return `<a href="${esc(href)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
  };
  return r;
}
let renderer = null;

// Main entry: markdown string -> HTML string
export function md(src, { inline = false } = {}) {
  if (!renderer) renderer = makeRenderer();
  src = String(src || '');
  const slots = [];
  const slot = html => `\u0001${slots.push(html) - 1}\u0002`;
  // protect code, extract math + {{links}}
  src = src.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?!\d)|\\\((.+?)\\\)|\{\{([^{}|\n]+?)(?:\|([^{}\n]+?))?\}\}|\]\((msg|term|skill|map|wiki|tip):((?:[^()\n]|\([^()\n]*\))+)\)/g,
    (all, code, dm, dm2, im, im2, lkText, lkKey, refType, refId) => {
      if (code) return code;
      // internal links may contain spaces ("term:learning rate") and tips parentheses, which markdown link syntax doesn't allow
      if (refType) return `](${refType}:${encodeURIComponent(decodeURIComponentSafe(refId.trim())).replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
      if (dm != null || dm2 != null) return '\n\n' + slot(renderMath((dm ?? dm2).trim(), true)) + '\n\n';
      if (im != null || im2 != null) return slot(renderMath(im ?? im2, false));
      if (lkText != null) {
        const key = (lkKey || lkText).trim();
        const inner = /\$/.test(lkText) ? lkText.replace(/\$([^$]+)\$/g, (_, t) => renderMath(t, false)) : marked.parseInline(lkText);
        return slot(`<span class="lk" data-k="${esc(key)}">${inner}</span>`);
      }
      return all;
    });
  if (!inline) src = containers(src);
  let html = inline ? marked.parseInline(src, { renderer, gfm: true }) : marked.parse(src, { renderer, gfm: true });
  // restore slots (may be wrapped in <p> when display math stood alone — unwrap)
  html = html.replace(/<p>\s*\u0001(\d+)\u0002\s*<\/p>/g, (_, i) => slots[+i])
             .replace(/\u0001(\d+)\u0002/g, (_, i) => slots[+i]);
  return html;
}

// Extract the text of the :::question block (for the pending-question banner)
export function questionText(src) {
  const m = String(src || '').match(/^:::question[^\n]*\n([\s\S]*?)^:::\s*$/m);
  return m ? m[1].trim() : null;
}

// Plain text preview of markdown (for lists / search results)
export function plain(src, n = 200) {
  const t = String(src || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' [formula] ')
    .replace(/\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?!\d)/g, '$1')
    .replace(/\{\{([^|}]+)(\|[^}]*)?\}\}/g, '$1')
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))+\)/g, '$1')
    .replace(/^:::.*$/gm, '')
    .replace(/[*_#>`|]/g, '')
    .replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
