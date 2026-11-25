/** Gate server selection and port claims, without building an app bundle for the node suite. */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { withHttpServer } from '../../services/test-support/src/net.ts';
import { pagesServer } from '../gates/lib/pages-server.mjs';

vi.mock('node:child_process', { spy: true });
vi.mock('node:fs', { spy: true });

function leaseFile(port) {
  return path.join(os.tmpdir(), `artifact-gates-port-${port}.lock`);
}

beforeEach(() => {
  vi.stubEnv('EMAIL__DEV_OUTBOX_PATH', '');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('reuses a compatible server when the caller accepts it', async () => {
  const given = await withHttpServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
  });
  onTestFinished(given.close);
  const drives = vi.fn().mockResolvedValue(true);

  const pages = await pagesServer(given.base, 'reuse', { drives });
  onTestFinished(pages.stop);
  expect(pages).toMatchObject({ port: given.port, booted: false });
  expect(drives).toHaveBeenCalledWith(pages.app);
  expect(spawn).not.toHaveBeenCalled();
});

it('holds a shared port claim for a private server and forwards the caller settings', async () => {
  vi.mocked(existsSync).mockReturnValueOnce(true);
  vi.mocked(spawn).mockReturnValueOnce({ exitCode: null, kill: vi.fn() });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 })));

  const pages = await pagesServer(null, 'private', { pagesHost: 'localhost', env: { APP__SHELL_FILE: 'custom-shell.html' } });
  onTestFinished(pages.stop);
  expect(pages.booted).toBe(true);
  expect(spawn).toHaveBeenCalledWith(process.execPath, [expect.stringMatching(/dist\/server\.mjs$/)], expect.objectContaining({
    env: expect.objectContaining({
      APP__PORT: String(pages.port),
      APP__PAGES_HOST: 'localhost',
      APP__SHELL_FILE: 'custom-shell.html',
    }),
  }));
  expect(fetch).toHaveBeenCalledWith(`http://localhost:${pages.port}/`, expect.any(Object));
  pages.stop();
  expect(readFileSync(leaseFile(pages.port), 'utf8')).toBe(String(process.pid));
});
