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
async function serverUp() { try { await api('GET', '/api/ping'); return true; } catch { return false; } }

module.exports = { api, serverUp };
