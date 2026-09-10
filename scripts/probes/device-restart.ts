/** Manual persistence gate: build first, then npx tsx scripts/probes/device-restart.ts. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverEnv, startServer, type RunningServer } from '../../evals/lib/server';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(path.join(tmpdir(), 'afbin-device-restart-'));
const socket = net.createServer();
await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = (socket.address() as net.AddressInfo).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const env = serverEnv({
  base: process.env, ports: { server: port, proxy: port }, dataDir: root, repoRoot,
  extra: { DATABASE_URL: `pglite://${root}/db`, APP__PUBLIC_BASE_URL: base },
});
let running: RunningServer | undefined;
const post = async (endpoint: string, body: unknown) => {
  const response = await fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
try {
  running = await startServer({ repoRoot, env, logPath: path.join(root, 'first.log') });
  const created = await post('/oauth/device', {});
  assert.equal(created.status, 200);
  assert.equal(typeof created.body.device_code, 'string');
  const request = { device_code: created.body.device_code };
  const before = await post('/oauth/device/token', request);
  assert.deepEqual(before, { status: 400, body: { error: 'authorization_pending' } });
  await running.stop();
  running = undefined;
  running = await startServer({ repoRoot, env, logPath: path.join(root, 'second.log') });
  const after = await post('/oauth/device/token', request);
  assert.deepEqual(after, before, 'Pending approval must survive a process restart');
  assert.equal((await post('/oauth/device', {})).status, 200);
  console.log('Device pairing persists across restart; new pairing remains available.');
} finally {
  await running?.stop();
  await rm(root, { recursive: true, force: true });
}
