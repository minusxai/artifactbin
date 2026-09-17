import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ACTOR_HEADER } from '../../services/contracts/src/index.ts';
import { signActor } from '../../services/utils/src/index.ts';

const root = path.resolve(import.meta.dirname, '../..');

it.each(['AUTH__SECRET', 'CONTRACT__ACTOR_SECRET'])('app-only startup accepts proxy identity signed with %s', async (setting) => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const secret = 'app-only-test-transport-secret';
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts'), '--app-only'], {
    cwd: path.join(root, 'services/app'),
    env: {
      ...process.env,
      NODE_ENV: 'production', DATABASE_URL: 'pglite://memory',
      APP__PORT: String(port), APP__PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      AUTH__SECRET: setting === 'AUTH__SECRET' ? secret : 'different-login-secret',
      CONTRACT__ACTOR_SECRET: setting === 'CONTRACT__ACTOR_SECRET' ? secret : '',
      SQL__SERVICE_URL: '', BROWSER__SERVICE_URL: '', EVENTS__SERVICE_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Boot timed out: ${logs}`)), 30000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Boot exited ${code}: ${logs}`)); });
      child.stdout.on('data', chunk => {
        logs += chunk;
        if (logs.includes('[boot] app-only on')) { clearTimeout(timer); resolve(); }
      });
    });
    const actor = { credential: 'session', userId: 'app-only-test-user', email: 'app-only-test@example.com' };
    const session = async key => {
      const response = await fetch(`http://127.0.0.1:${port}/api/page/session`, {
        headers: { [ACTOR_HEADER]: signActor(actor, key) },
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await session(secret)).toMatchObject({ kind: 'account', user: { id: actor.userId } });
    expect(await session('wrong-secret')).toMatchObject({ user: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
  }
}, 45000);
