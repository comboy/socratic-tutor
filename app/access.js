// Access from other machines: `bin/learn --host <ip>` (docs/setup.md, "Running on a server").
//
// What the browser sends reaches agents that run shell commands, so a server other machines can
// reach must not answer them without a secret: anyone who could would come close to running
// commands on this machine. Requests from this machine (a loopback socket: the CLI, a local
// browser, an SSH tunnel) work as before; any other request needs the access token, kept in
// <data home>/.access-token (gitignored, created on first need). The link `http://<host>:<port>/?token=…`
// sets an HttpOnly, SameSite=Lax cookie; the CLI sends it as a bearer token.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const S = require('./store');

const TOKEN_FILE = path.join(S.ROOT, '.access-token');
const RECORD = path.join(S.STATE, 'server.json');
const COOKIE = `learn-${S.PORT}`;
const isLoopback = a => /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/i.test(String(a || ''));
const isWildcard = h => h === '0.0.0.0' || h === '::';
// The server can be reached from other machines (so it needs the token). LEARN_TEST_REMOTE: the
// acceptance tests' stand-in for another machine (every request counts as remote), since binding a
// real network address there would ask the learner's firewall for permission.
const OPEN = !isLoopback(S.HOST) || !!process.env.LEARN_TEST_REMOTE;

// The token, created (once) when `create`; null when there's none.
function token(create = OPEN) {
  const read = () => { const t = S.readText(TOKEN_FILE, '').trim(); return t || null; };
  let t = read();
  if (t || !create) return t;
  ignoreInGit();
  try { fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }   // another process made it first: use theirs
  return read();
}
// The data home is a git repo the jobs commit to: the token must never be in it.
function ignoreInGit() {
  const gi = path.join(S.ROOT, '.gitignore');
  const g = S.readText(gi, null) ?? 'state/\n.DS_Store\n';   // (what S.ensureHome() would write)
  if (!/^\/?\.access-token$/m.test(g)) fs.writeFileSync(gi, g + (g && !g.endsWith('\n') ? '\n' : '') + '.access-token\n');
}
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
function valid(t) {
  const k = token();
  return !!(k && t) && crypto.timingSafeEqual(digest(t), digest(k));
}

// ---------- server side ----------
const fromThisMachine = req => !process.env.LEARN_TEST_REMOTE && isLoopback(req.socket.remoteAddress);
// How a request from another machine proved it has the token: 'cookie' (a browser), 'bearer' (the
// CLI), or null.
function credential(req) {
  const auth = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (auth && valid(auth[1])) return 'bearer';
  const c = String(req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
  if (c && valid(decodeURIComponent(c.slice(COOKIE.length + 1)))) return 'cookie';
  return null;
}
// The cookie that keeps a browser in. SameSite=Lax, not Strict: a Strict cookie is withheld from a
// tab that got here by a link on another page (a start page, a web chat, a note), and the learner
// was asked for the token again in a browser that already had it. Lax still keeps it out of
// everything another site can do except a top-level GET, which changes nothing here (and whose
// answer that site can't read); a change must come from the app's own origin (refused() in server.js).
const setCookie = () => `${COOKIE}=${encodeURIComponent(token())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}`;
// A page opened with the cookie gets it again: the 400 days (the most browsers keep) count from the
// last visit, not the first, and a cookie from before the change above becomes a Lax one.
function keep(req, res) {
  if (!OPEN || req.method !== 'GET' || fromThisMachine(req) || !/\btext\/html\b/.test(String(req.headers.accept || ''))) return;
  if (credential(req) === 'cookie') res.setHeader('set-cookie', setCookie());
}
// `?token=` on a visit: a cookie for the next requests, and a redirect that takes the token out of
// the address bar (and so out of history and bookmarks). -> true when it answered the request.
function tokenVisit(req, res, url) {
  if (!OPEN || !url.searchParams.has('token')) return false;
  if (!valid(url.searchParams.get('token'))) { denied(res); return true; }
  url.searchParams.delete('token');
  res.writeHead(302, {
    'set-cookie': setCookie(),
    location: url.pathname + (url.search || ''), 'cache-control': 'no-store',
  });
  res.end();
  return true;
}
function denied(res) {
  res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`This learn server can be reached from other machines, so it needs its access link.

On the server, run \`bin/learn status\`: it prints the link (http://…/?token=…). Open it once in
this browser and a cookie keeps you in. (The token is in the data home, .access-token.)
`);
}

// ---------- where the CLI finds the server ----------
// A server bound to one network address (a VPN IP) doesn't answer on 127.0.0.1, and a command typed
// in another terminal may not have been given --host: the server leaves its address in
// state/server.json for them.
function record() {
  if (isWildcard(S.HOST) || isLoopback(S.HOST)) { try { if (S.readJSON(RECORD, null)?.pid !== process.pid) fs.unlinkSync(RECORD); } catch {} return; }
  try { S.ensureDir(S.STATE); S.writeJSON(RECORD, { host: S.HOST, port: S.PORT, pid: process.pid }); } catch {}
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function connectHost() {
  let r = null; try { r = S.readJSON(RECORD, null); } catch {}
  const h = r && r.port === S.PORT && r.pid && alive(r.pid) ? r.host : S.HOST;
  return isWildcard(h) ? '127.0.0.1' : h;
}
// Headers for a CLI request to `host`: the token when the server won't see it as this machine.
function clientHeaders(host) {
  if (isLoopback(host) && !process.env.LEARN_TEST_REMOTE) return {};
  const t = token(false);
  return t ? { authorization: `Bearer ${t}` } : {};
}

// ---------- the links to print ----------
const hostPart = h => h.includes(':') ? `[${h}]` : h;
function addresses(host) {
  if (!isWildcard(host)) return [host];
  const all = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.family === 'IPv4' && !i.address.startsWith('169.254.'));
  return all.length ? [...new Set(all.map(i => i.address))] : ['<this machine\'s address>'];
}
// The address for a browser on this machine (localhost, unless bound to one network address only).
const localUrl = (host = S.HOST) => `http://${isWildcard(host) || isLoopback(host) ? 'localhost' : hostPart(host)}:${S.PORT}`;
// Lines for the startup log and `bin/learn status`: the link to open from another machine, and why
// it matters how you get there.
function remoteLines(host = S.HOST) {
  const t = token(true);   // (only called for a server that's open)
  if (!t) return [];
  return [
    ...addresses(host).map(a => `open from another machine: http://${hostPart(a)}:${S.PORT}/?token=${t}`),
    `(plain HTTP: anyone on the network path can read that token. Use a VPN address such as Tailscale's, or an SSH tunnel: ssh -L ${S.PORT}:localhost:${S.PORT} <server>, which needs no --host.)`,
  ];
}

module.exports = { OPEN, TOKEN_FILE, token, isLoopback, isWildcard, fromThisMachine, credential, tokenVisit, keep, denied, record, connectHost, clientHeaders, localUrl, remoteLines };
