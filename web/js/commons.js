// Wikimedia Commons file names, shared by the UI (md.js: show a downloaded copy instead of a
// hotlinked Commons image) and `bin/learn image` (app/media.js, via require). No DOM.

// The Commons file name ("DNA replication en.svg") in any of: "File:X", a bare "X.svg", a
// commons.wikimedia.org/wiki/File:X page, an upload.wikimedia.org or thumb.wikimedia.org image
// URL (original or thumbnail). null if it isn't one.
export function commonsName(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  const dec = x => { try { return decodeURIComponent(x); } catch { return x; } };
  if (/^https?:\/\//i.test(s)) {
    let u; try { u = new URL(s); } catch { return null; }
    if (!/(^|\.)(wikimedia|wikipedia)\.org$/i.test(u.hostname)) return null;
    const p = u.pathname;
    let m = p.match(/\/wiki\/(?:File|Image):(.+)$/i);
    if (m) s = dec(m[1]);
    else if ((m = p.match(/\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//i))) s = dec(m[1]);
    else if ((m = p.match(/\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)$/i))) s = dec(m[1]);
    else return null;
  } else s = s.replace(/^(File|Image):/i, '');
  if (!/\.[a-z0-9]{2,5}$/i.test(s)) return null;
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s[0].toUpperCase() + s.slice(1);   // Commons titles start with a capital
}
