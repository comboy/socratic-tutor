// Tiny JSON client for the local server (used by bin/learn, the launcher and the job runner).
'use strict';
const http = require('http');
const S = require('./store');

function api(method, p, body, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port: S.PORT, path: p, method, timeout,
      headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, res => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 400) { let m = buf; try { m = JSON.parse(buf).error || buf; } catch {} return reject(new Error(m || res.statusCode)); }
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}
// The server on our port, if it serves this data home: { ok, home, pid } | null. Another learn
// server on the port (a demo or test run, another checkout) is { foreign: true, home }: never
// post into it, its data isn't ours.
async function serverInfo() {
  let r;
  try { r = await api('GET', '/api/ping'); } catch { return null; }
  if (r && r.home && r.home !== S.realish(S.ROOT)) return { foreign: true, home: r.home };
  return r || { ok: true };
}
async function serverUp() { const r = await serverInfo(); return !!r && !r.foreign; }
// Through the server when it's up (it tells the browsers), else straight to the files. A request
// the server never received (connection refused: it was restarting) also goes to the files; any
// other failure is an error, since the server may have saved it.
async function viaServer(method, p, body, direct) {
  if (!(await serverUp())) return direct();
  try { return await api(method, p, body, 5000); }
  catch (e) { if (e.code === 'ECONNREFUSED') return direct(); throw e; }
}

// Open a URL in the default browser (macOS open, Windows start, else xdg-open). -> whether it worked.
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { require('child_process').execFileSync(cmd, args, { stdio: 'ignore', timeout: 10000 }); return true; } catch { return false; }
}

module.exports = { api, serverInfo, serverUp, viaServer, openBrowser };
