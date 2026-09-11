// Disposable real-stack browser -> loopback -> CLI credential -> HTTP probe.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'afbin-auth-probe-'));
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const reservation = createServer(); const port = await listen(reservation); await new Promise(r => reservation.close(r));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, [resolve('dist/proxy-server.mjs')], {
  cwd: resolve('services/app'), stdio: ['ignore', 'ignore', 'inherit'],
  env: { PATH: process.env.PATH, NODE_ENV: 'production', APP__PORT: String(port), APP__PUBLIC_BASE_URL: base,
    AUTH__SECRET: randomBytes(32).toString('hex'), DATABASE_URL: 'pglite://memory',
    OBJECT_STORE__LOCAL_DIR: join(scratch, 'objects'), EMAIL__DEV_OUTBOX_PATH: join(scratch, 'outbox.jsonl'),
    PROXY__RATE_LIMIT_CONFIG_FILE: resolve('services/proxy/dev_rate_limits.yml'), ARTIFACTS__ALLOW_PUBLIC: '1' },
});
process.on('exit', () => child.kill());
process.on('SIGTERM', () => process.exit());
for (let i = 0; ; i++) {
  try { if ((await fetch(base)).status < 500) break; } catch {}
  if (i > 100 || child.exitCode !== null) throw Error('stack did not boot');
  await new Promise(r => setTimeout(r, 200));
}
const state = randomBytes(24).toString('hex'), verifier = randomBytes(32).toString('base64url');
let tokens, tokenId, approved = false;
const infoPath = join(scratch, 'info.json');
async function info(extra) { await writeFile(infoPath, JSON.stringify({ base, scratch, ...extra }, null, 2)); }
async function token(body) { return fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }); }
const callback = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/check-revoked') {
      const r = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ markup: '<p>Must not publish after revoke</p>' }) });
      assert.equal(r.status, 401);
      const refresh = await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token });
      assert.equal(refresh.status, 400);
      await info({ phase: 'passed', checks: ['browser callback/state', 'PKCE exchange and replay refusal', '0600 credentials', 'HTTP create/read', 'refresh rotation', 'browser token revoke', 'revoked HTTP/refresh refused'] });
      res.end('All browser-to-CLI checks passed.'); console.log('AUTH_PROBE_PASSED'); return;
    }
    if (url.pathname !== '/cb' || url.searchParams.get('state') !== state || approved) { res.writeHead(400).end('Invalid or repeated callback'); return; }
    approved = true;
    const body = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirect, code_verifier: verifier, code: url.searchParams.get('code') };
    const exchange = await token(body); assert.equal(exchange.status, 200); tokens = await exchange.json();
    assert.equal((await token(body)).status, 400);
    const dir = join(scratch, '.artifactbin'); await mkdir(dir, { mode: 0o700 });
    await writeFile(join(dir, '.env'), `ARTIFACTBIN_URL=${base}\nARTIFACTBIN_TOKEN=${tokens.access_token}\n`, { mode: 0o600 });
    const headers = { Authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ title: 'Disposable CLI pairing probe', markup: '<p>Browser to CLI to HTTP</p>' }) });
    assert.equal(created.status, 201); const doc = await created.json();
    assert.equal((await fetch(`${base}/api/artifacts/${doc.id}`, { headers })).status, 200);
    const rotated = await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token });
    assert.equal(rotated.status, 200); const previous = tokens; tokens = await rotated.json();
    await writeFile(join(dir, '.env'), `ARTIFACTBIN_URL=${base}\nARTIFACTBIN_TOKEN=${tokens.access_token}\n`, { mode: 0o600 });
    assert.equal((await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: previous.refresh_token })).status, 400);
    // actor_token_id is the LAST WRITER, not the reader. Write with the rotated token.
    const fresh = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ markup: '<p>Rotated token identity</p>' }) });
    assert.equal(fresh.status, 201); tokenId = (await fresh.json()).actor_token_id;
    await info({ phase: 'revoke', tokenId, checkUrl: `http://127.0.0.1:${callbackPort}/check-revoked` });
    res.end('CLI received the token, published/read through HTTP, and refreshed. Revoke the disposable token to finish.');
    console.log('AUTH_READY_REVOKE', infoPath);
  } catch (error) { console.error('AUTH_PROBE_FAILED', error.message); res.writeHead(500).end('Probe failed; inspect assertions'); }
});
const callbackPort = await listen(callback), redirect = `http://127.0.0.1:${callbackPort}/cb`;
const registration = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'CLI planning probe', redirect_uris: [redirect] }) })).json();
const clientId = registration.client_id; assert.ok(clientId);
const authUrl = `${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state })}`;
await info({ phase: 'login', authUrl, email: `mxmx_test_cli_${Date.now()}@example.com` });
console.log('AUTH_PROBE_INFO', infoPath);
