/** Served installers prepare Node and launch the sole npm package on this origin. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';

const publicDir = path.resolve(__dirname, '..', 'public');
const app = (dir = publicDir) => createAppServer({ indexHtml: async () => '<div>SPA</div>', publicDir: dir });
const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artifacts.example.test' };
const directories: string[] = [];
afterEach(() => { for (const dir of directories) fs.rmSync(dir, { recursive: true, force: true }); directories.length = 0; });
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afbin served npm ')); directories.push(dir); return dir; };

describe('served npm installer compatibility URLs', () => {
  it.each(['/install.sh', '/chat/install.sh'])('prepares Node and selects this origin through the actual served shell: %s', async route => {
    const response = await app().request(route, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/x-shellscript');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const script = await response.text();
    const dir = temporary(), bin = path.join(dir, 'tools'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) output="$2"; shift;; http*) printf '%s\\n' "$1" > "$AFBIN_PROBE/helper-url";; esac; shift; done\nprintf ':\\n' > "$output"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$AFBIN_PROBE/npm-args"\n', { mode: 0o755 });
    const run = spawnSync('sh', [], { input: script, encoding: 'utf8', cwd: dir, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, AFBIN_PROBE: dir }, timeout: 10000 });
    expect(run.status, run.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'helper-url'), 'utf8')).toBe('https://artifacts.example.test/chat/ensure-node.sh\n');
    expect(fs.readFileSync(path.join(dir, 'npm-args'), 'utf8')).toBe('--yes\n@afbin/cli@latest\nsetup\n--server\nhttps://artifacts.example.test\n');
    expect(script).not.toContain('releases/download');
  });
  it('serves both shell aliases identically', async () => {
    const server = app();
    expect(await (await server.request('/install.sh', { headers })).text()).toBe(await (await server.request('/chat/install.sh', { headers })).text());
  });
  it('serves PowerShell with its selected origin and npm cmd shim', async () => {
    const response = await app().request('/chat/install.ps1', { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const script = await response.text();
    expect(script).toContain("$Origin = 'https://artifacts.example.test'");
    expect(script).toContain('"$Origin/chat/ensure-node.ps1"');
    expect(script).toContain('npx.cmd --yes @afbin/cli@latest setup --server $Origin');
    expect(script).not.toMatch(/Set-ExecutionPolicy|ReleaseRoot|afbin-windows/);
  });
  it('retires binary release assets even if old files remain in public storage', async () => {
    const dir = temporary(), release = path.join(dir, 'chat/releases/afbin-v0.4.0'); fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, 'afbin-darwin-arm64'), '#!/bin/sh\necho retired\n');
    const server = app(dir);
    for (const route of ['/chat/releases/afbin-v0.4.0/afbin-darwin-arm64', '/chat/releases/afbin-v0.4.0/SHA256SUMS', '/chat/releases/afbin-v0.4.0/missing']) expect((await server.request(route)).status, route).toBe(404);
  });
});
