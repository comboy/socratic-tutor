// `bin/learn image`: keep real images (micrographs, diagrams) in the topic, so they show offline
// and always carry their credit. Files go to topics/<slug>/media/, their author/licence/source to
// media/index.json; messages show them with ![caption](media:<file>) (docs/formats.md). A
// hotlinked Commons image whose file has been downloaded is shown from the local copy too.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./store');
const { commonsName } = require('../web/js/commons.js');

const API = () => process.env.LEARN_COMMONS_API || 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks automated clients for a descriptive User-Agent; a generic one, no personal data
const UA = 'learn-tutor/1.0 (local learning app; image download for offline use)';
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };

async function get(url, as = 'json') {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'api-user-agent': UA } });
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${r.statusText} from ${new URL(url).host}`), { status: r.status, retryAfter: r.headers.has('retry-after') ? Number(r.headers.get('retry-after')) : NaN });
  return as === 'json' ? r.json() : { bytes: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') || '').split(';')[0] };
}
function query(params) { return get(API() + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params })); }

// Commons metadata values are HTML snippets: keep the text
function text(v, n = 300) {
  const t = String(v?.value ?? v ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function localName(slug, want, base, ext, title) {
  let stem = String(want || base).replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  const index = S.readMedia(slug);
  let name = stem + ext, i = 2;
  // the same source again replaces its file; a different one gets a new name
  while (fs.existsSync(path.join(S.mediaDir(slug), name)) && index[name]?.title !== title) name = `${stem}-${i++}${ext}`;
  return name;
}
function save(slug, name, bytes, info) {
  const d = S.mediaDir(slug);
  S.ensureDir(d);
  fs.writeFileSync(path.join(d, name), bytes);
  const index = S.readMedia(slug);
  index[name] = { ...info, added: S.localDate() };
  S.writeJSON(path.join(d, 'index.json'), index);
  return { name, ...index[name] };
}

// Commons throttles automated downloads of original files and of thumbnails at odd sizes; it asks
// for its standard thumbnail widths. A raster thumbnail at least as wide as the original is served
// as the original, so the width must also stay below the original's.
const STEPS = [120, 250, 330, 500, 960, 1280, 1920];
function thumbWidth(want, ii) {
  const vector = ii.mime === 'image/svg+xml' || !EXT[ii.mime];
  const cap = vector ? want : Math.min(want, (ii.width || Infinity) - 1);
  return [...STEPS].reverse().find(w => w <= cap) || null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Who made it: the Artist field, else the licence's attribution text, else a Credit that names
// someone ("Own work" names the uploader), else the uploader.
function author(meta, user) {
  const credit = text(meta.Credit, 160);
  return text(meta.Artist, 160) || text(meta.Attribution, 160) || (credit && !/^own work\b/i.test(credit) ? credit : '') || (user ? `${user} (uploader)` : '') || 'unknown';
}

// Download a Commons file (any form commonsName() understands) at up to `width` px, as Commons'
// rendered PNG/JPEG thumbnail at a standard width (SVGs too: every browser shows the PNG). When
// Commons throttles it (429), waits and tries the next smaller standard width.
async function addCommons(slug, input, { name, width = 1280 } = {}) {
  const file = commonsName(input);
  if (!file) throw new Error(`not a Wikimedia Commons file or URL: ${input}`);
  const info = w => query({ action: 'query', titles: 'File:' + file, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|user', ...(w ? { iiurlwidth: String(w) } : {}) });
  let j = await info(thumbWidth(width, { mime: 'image/svg+xml' }));
  const page = j.query?.pages?.[0];
  if (!page || page.missing || !page.imageinfo?.[0]) throw new Error(`no file "File:${file}" on Commons (search: bin/learn image search "…")`);
  let ii = page.imageinfo[0];
  const meta = ii.extmetadata || {}, orig = { url: ii.url, width: ii.width, height: ii.height, mime: ii.mime };
  let w = thumbWidth(width, orig), got = null, lastErr = null;
  for (let tries = 0; tries < 3 && !got; tries++) {
    if (w && ii.thumbwidth !== w) ii = (await info(w)).query?.pages?.[0]?.imageinfo?.[0] || ii;
    const url = w && ii.thumburl ? ii.thumburl : orig.url;
    try { got = { ...(await get(url, 'bytes')), url, w: url === orig.url ? null : w }; }
    catch (e) {
      lastErr = e;
      if (![429, 503].includes(e.status)) throw e;
      await sleep(Math.min(10, e.retryAfter >= 0 ? e.retryAfter : 1) * 1000);
      w = w ? STEPS[STEPS.indexOf(w) - 1] || w : w;
    }
  }
  if (!got) throw new Error(`${lastErr.message}: Commons is throttling downloads; try again in a minute, or with --width 500`);
  const ext = EXT[got.type] || path.extname(new URL(got.url).pathname).toLowerCase() || '.png';
  const title = page.title;
  const from = [...new Set([/^https?:/.test(input) ? input : null, orig.url, ii.thumburl].filter(Boolean).map(u => u.replace(/\?.*$/, '')))];
  return save(slug, localName(slug, name, file, ext, title), got.bytes, {
    title, author: author(meta, ii.user), license: text(meta.LicenseShortName, 80) || 'see source',
    licenseUrl: text(meta.LicenseUrl, 300) || null, source: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    description: text(meta.ImageDescription), width: got.w ? ii.thumbwidth : orig.width, height: got.w ? ii.thumbheight : orig.height, from,
  });
}

// A local image file (a figure you made, a screenshot), with the credit given on the command line.
function addLocal(slug, file, { name, author, license, source, title } = {}) {
  const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg');
  if (!Object.values(EXT).includes(ext)) throw new Error(`not an image (png, jpg, gif, webp, svg): ${file}`);
  const t = title || path.basename(file);
  return save(slug, localName(slug, name, path.basename(file), ext, t), fs.readFileSync(file), {
    title: t, author: author || 'unknown', license: license || 'unknown', licenseUrl: null, source: source || null, description: '', from: [],
  });
}

// Commons search, for picking a file: [{ title, width, height, mime, license, author, page }]
async function search(q, n = 8) {
  const j = await query({ action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap|drawing`, gsrnamespace: '6', gsrlimit: String(n), prop: 'imageinfo', iiprop: 'size|mime|extmetadata|url' });
  return (j.query?.pages || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(p => {
    const ii = p.imageinfo?.[0] || {}, meta = ii.extmetadata || {};
    return { title: p.title, width: ii.width, height: ii.height, mime: ii.mime, license: text(meta.LicenseShortName, 60), author: text(meta.Artist, 60), page: ii.descriptionurl, description: text(meta.ImageDescription, 120) };
  });
}

module.exports = { addCommons, addLocal, search, commonsName };
