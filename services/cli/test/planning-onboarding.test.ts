// Characterization probes for the planning record; not tests of an implemented new CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConnection } from '../src/config';
import { ensureConnection } from '../src/auth';

test('current credential loader does not yet read the proposed state directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'afbin-planning-'));
  try {
    await mkdir(join(home, '.artifactbin'), { mode: 0o700 });
    await writeFile(join(home, '.artifactbin/.env'), 'ARTIFACTBIN_URL=https://example.com\nARTIFACTBIN_TOKEN=fixture_only\n', { mode: 0o600 });
    assert.equal(await loadConnection(undefined, home, {}), null);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('current authentication eagerly validates saved credentials before any operation', async () => {
  let requests = 0;
  const connection = { server: 'https://example.com', token: 'fixture_only' };
  await ensureConnection(connection, undefined, {
    validate: async () => { requests++; },
    authenticate: async () => { throw new Error('unexpected login'); },
    notify: () => {},
  });
  assert.equal(requests, 1, 'new local-first dispatch must avoid this pre-request');
});
