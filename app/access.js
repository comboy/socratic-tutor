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
  if (!valid(url.searchParams.get('token'))) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page('learn: wrong token', '<h1>That access token is not the right one</h1><p>On the machine that runs the tutor, <code>bin/learn status</code> prints the link with the current token. <a style="color:#6ea4ea" href="/">Back</a>, to be let in with <code>bin/learn allow</code> instead.</p>'));
    return true;
  }
  url.searchParams.delete('token');
  res.writeHead(302, {
    'set-cookie': setCookie(),
    location: url.pathname + (url.search || ''), 'cache-control': 'no-store',
  });
  res.end();
  return true;
}
// ---------- a browser asking to be let in ----------
// A browser from another machine without the cookie used to get a 401 and a hint to find the link
// with `bin/learn status`: copying a long link between devices. Now it waits on that page, and the
// person lets it in from a terminal on this machine: `bin/learn allow` (the newest one waiting, or
// the one whose code they name). Who may approve is the point: the person, by a command they
// type. Not a tab that is already in (it is likely on another device, out of reach when a new one
// asks; the learner's call, 2026-11-26), and never an agent on its own judgment: an agent that can
// admit browsers is a way in for whoever can talk to the agent. So the server takes an approval
// only from this machine or the CLI's bearer token, and the command wants a terminal.
//
// The waiting browser holds a secret of its own in a cookie; the page shows a short code made from
// it, the same one `allow` prints, so the person can see that the browser they let in is theirs.
// An approval is good for a few minutes and for one use. All of it lives in memory: after a server
// restart a waiting page simply asks again, with the same code.
const ASK = `${COOKIE}-ask`;
const asks = new Map();   // secret -> { code, addr, browser, at, seen, polls, allowed }
let lastAskLog = 0;
const WAITING_MS = 20e3, ASK_TTL = 15 * 60e3, ALLOW_TTL = 3 * 60e3, ASK_MAX = 30;
const codeOf = secret => crypto.createHash('sha256').update('learn-ask:' + secret).digest('base64url').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
function browserName(ua) {
  ua = String(ua || '');
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl\//.test(ua) ? 'curl' : 'a browser';
  const o = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} on ${o}` : b;
}
function pruneAsks(now = Date.now()) {
  for (const [k, a] of asks) if (now - a.seen > ASK_TTL || (a.allowed && now - a.allowed > ALLOW_TTL)) asks.delete(k);
  // too many: one that asked once and never came back goes first (a flood of requests must not push out
  // a browser that is really waiting), one already let in last
  const rank = a => (a.allowed ? 2 : a.polls > 1 ? 1 : 0);
  while (asks.size > ASK_MAX) asks.delete([...asks].sort((x, y) => rank(x[1]) - rank(y[1]) || x[1].seen - y[1].seen)[0][0]);
}
// -> { entry, secret, fresh }
function noteAsk(req) {
  const now = Date.now();
  pruneAsks(now);
  const c = String(req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(ASK + '='));
  let secret = c ? c.slice(ASK.length + 1) : '';
  if (!/^[\w-]{24,64}$/.test(secret)) secret = crypto.randomBytes(24).toString('base64url');
  let entry = asks.get(secret);
  // (new, or back after it stopped waiting: "the last request wins" counts from when it came back)
  const fresh = !entry || now - entry.seen > WAITING_MS;
  if (!entry) asks.set(secret, entry = { code: codeOf(secret), addr: String(req.socket.remoteAddress || '?').replace(/^::ffff:/, ''), browser: browserName(req.headers['user-agent']), at: now, seen: now, polls: 0, allowed: 0 });
  if (fresh) entry.at = now;
  entry.seen = now; entry.polls++;
  return { entry, secret, fresh };
}
// Browsers on the waiting page right now, newest first: [{ code, addr, browser, at }]
function waiting() {
  const now = Date.now();
  pruneAsks(now);
  return [...asks.values()].filter(a => !a.allowed && now - a.seen <= WAITING_MS).sort((x, y) => y.at - x.at).map(({ code, addr, browser, at }) => ({ code, addr, browser, at }));
}
// Let one in: the one with this code, or, without a code, the only one waiting. With several
// waiting the code is required: "the newest" is whoever asked last, and anyone who can reach the port
// can make sure that is them (a request every few seconds), to be let in when the person types the
// command for their own phone. The code on their screen is what tells theirs apart.
// -> { code, addr, browser, at } | null (nobody, no such code, or several and no code)
function allow(code) {
  const now = Date.now(), want = code ? String(code).toUpperCase() : null;
  const live = [...asks.values()].filter(a => !a.allowed && now - a.seen <= WAITING_MS && (!want || a.code === want)).sort((x, y) => y.at - x.at);
  const pick = want || live.length === 1 ? live[0] : null;
  if (!pick) return null;
  pick.allowed = now;
  return { code: pick.code, addr: pick.addr, browser: pick.browser, at: pick.at };
}
const page = (title, body, refresh) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}<title>${title}</title>
<style>body { font: 16px/1.5 -apple-system, "Segoe UI", sans-serif; background: #1f2227; color: #cfd3da; margin: 0; display: grid; place-items: center; min-height: 100vh; }
main { max-width: 520px; padding: 24px; } h1 { font-size: 20px; color: #e6e8ec; margin: 0 0 12px; } code, .code { font: 600 15px ui-monospace, Menlo, Consolas, monospace; background: #2a2e35; border: 1px solid #3a404a; border-radius: 5px; padding: 1px 6px; color: #e6e8ec; }
.code { font-size: 22px; letter-spacing: .12em; padding: 3px 10px; } p { margin: 10px 0; } .muted { color: #949baa; font-size: 14px; } details { margin-top: 22px; } summary { cursor: pointer; color: #949baa; font-size: 14px; }
input { font: 14px ui-monospace, monospace; width: 100%; box-sizing: border-box; margin: 8px 0; padding: 7px 9px; background: #22262c; color: #e6e8ec; border: 1px solid #3a404a; border-radius: 5px; } button { font: 600 14px sans-serif; padding: 6px 14px; border-radius: 5px; border: 1px solid #3f5c85; background: #2b3b52; color: #e6e8ec; cursor: pointer; }</style></head><body><main>${body}</main></body></html>`;
// The answer to a request without the token. A page (a browser asking for HTML) waits to be let
// in; anything else gets the plain 401. `log(text)`: the server's log, once per browser that starts waiting.
function denied(req, res, log = () => {}) {
  const html = req && req.method === 'GET' && /\btext\/html\b/.test(String(req.headers.accept || ''));
  if (!html) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`This learn server can be reached from other machines, so it needs its access link.

On the server, run \`bin/learn status\`: it prints the link (http://…/?token=…). Open it once in
this browser and a cookie keeps you in. (The token is in the data home, .access-token.)
Or open this address in the browser and let it in from the server with \`bin/learn allow\`.
`);
    return;
  }
  const { entry, secret, fresh } = noteAsk(req);
  if (entry.allowed && Date.now() - entry.allowed <= ALLOW_TTL) {
    asks.delete(secret);
    // (a path on this server, whatever the request line was: //other.host/x must not become a redirect there)
    const u = new URL(req.url, 'http://x');
    res.writeHead(302, { 'set-cookie': [setCookie(), `${ASK}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`], location: u.pathname.replace(/^[/\\]+/, '/') + u.search, 'cache-control': 'no-store' });
    res.end();
    log(`access: the browser ${entry.code} at ${entry.addr} (${entry.browser}) was let in with bin/learn allow`);
    return;
  }
  if (fresh && Date.now() - lastAskLog > 10e3 && (lastAskLog = Date.now())) log(`access: a browser at ${entry.addr} (${entry.browser}) has no access cookie and is waiting, code ${entry.code}. To let it in, type in a terminal on this machine: bin/learn allow`);
  res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `${ASK}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ASK_TTL / 1000}` });
  res.end(page('learn: waiting to be let in', `<h1>This browser isn't known here yet</h1>
<p>In a terminal on the machine that runs the tutor, type:</p>
<p><code>bin/learn allow</code></p>
<p>It lets this browser in. If several are waiting it asks for the code; this one is <span class="code">${entry.code}</span></p>
<p class="muted">This page checks every few seconds and opens the app by itself once it is let in. A cookie then keeps this browser in.</p>
<details><summary>Or paste the access token</summary><form method="get" action="/"><input name="token" autocomplete="off" placeholder="the token from bin/learn status (the part after ?token=)"><button>Open</button></form></details>`, 4));
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

module.exports = { OPEN, TOKEN_FILE, token, isLoopback, isWildcard, fromThisMachine, credential, tokenVisit, keep, denied, waiting, allow, record, connectHost, clientHeaders, localUrl, remoteLines };
