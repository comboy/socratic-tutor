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
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${new URL(url).host}`);
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

// Download a Commons file (any form commonsName() understands) at up to `width` px. SVGs and
// big images come as Commons' rendered PNG/JPEG thumbnail, which every browser shows.
async function addCommons(slug, input, { name, width = 1280 } = {}) {
  const file = commonsName(input);
  if (!file) throw new Error(`not a Wikimedia Commons file or URL: ${input}`);
  const j = await query({ action: 'query', titles: 'File:' + file, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width) });
  const page = j.query?.pages?.[0];
  if (!page || page.missing || !page.imageinfo?.[0]) throw new Error(`no file "File:${file}" on Commons (search: bin/learn image search "…")`);
  const ii = page.imageinfo[0], meta = ii.extmetadata || {};
  const useThumb = ii.thumburl && (ii.mime === 'image/svg+xml' || !EXT[ii.mime] || ii.width > width);
  const { bytes, type } = await get(useThumb ? ii.thumburl : ii.url, 'bytes');
  const ext = EXT[type] || path.extname(new URL(useThumb ? ii.thumburl : ii.url).pathname).toLowerCase() || '.png';
  const title = page.title;
  const from = [...new Set([/^https?:/.test(input) ? input : null, ii.url, ii.thumburl].filter(Boolean).map(u => u.replace(/\?.*$/, '')))];
  return save(slug, localName(slug, name, file, ext, title), bytes, {
    title, author: text(meta.Artist, 160) || text(meta.Credit, 160) || 'unknown', license: text(meta.LicenseShortName, 80) || 'see source',
    licenseUrl: text(meta.LicenseUrl, 300) || null, source: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    description: text(meta.ImageDescription), width: useThumb ? ii.thumbwidth : ii.width, height: useThumb ? ii.thumbheight : ii.height, from,
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
