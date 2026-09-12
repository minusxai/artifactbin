// /install.sh is a shell script and must be served as one (S5). Seeded RED by the orchestrator.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';

const publicDir = path.resolve(__dirname, '..', 'public');
const script = fs.readFileSync(path.join(publicDir, 'chat', 'install.sh'), 'utf8');
const pinned = script.match(/^ {2}version=(\S+)$/m)![1];
const GITHUB = 'https://github.com/minusxai/artifactbin/releases/download/afbin-v$version';
const app = (cliReleaseDir?: string) => createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>', publicDir, cliReleaseDir });
const payload = '#!/bin/sh\necho local build\n';
let dirs: string[] = [];
/** What `npm run build:binary -w services/cli` leaves in dist: the executable, its manifest and the checksum list. */
const localBuild = (version = pinned) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afbin-local-release-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'afbin-darwin-arm64'), payload);
  fs.writeFileSync(path.join(dir, 'afbin-darwin-arm64.manifest.json'), JSON.stringify({ version, platform: 'darwin', arch: 'arm64' }));
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${createHash('sha256').update(payload).digest('hex')}  afbin-darwin-arm64\n`);
  return dir;
};
afterEach(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe('GET /install.sh', () => {
  it('serves the installer as text/x-shellscript', async () => {
    const res = await app().request('/install.sh');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^text\/x-shellscript/);
    expect((await res.text()).startsWith('#!')).toBe(true);
  });
});

describe('GET /chat/*.sh', () => {
  it.each(['/chat/install.sh', '/chat/uninstall.sh'])('serves %s as a briefly cached shell script for `curl … | sh`', async (route) => {
    const res = await app().request(route);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^text\/x-shellscript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await res.text()).startsWith('#!/bin/sh')).toBe(true);
  });
  it('serves the installer byte for byte, pointing at GitHub, when this server has no CLI build', async () => {
    const body = await (await app(path.join(os.tmpdir(), 'afbin-no-such-dir')).request('/chat/install.sh')).text();
    expect(body).toBe(script);
    expect(body).toContain(`release="${GITHUB}"`);
  });
  it('points the installer at its own origin when a local CLI build matches the pinned version', async () => {
    const server = app(localBuild());
    const body = await (await server.request('/chat/install.sh')).text();
    expect(body).toContain('release="http://localhost/chat/releases/afbin-v$version"');
    expect(body).not.toContain('github.com');
    expect(body.replace('http://localhost/chat/releases/afbin-v$version', GITHUB)).toBe(script);
    const forwarded = await (await server.request('/chat/install.sh', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artifacts.example.test' } })).text();
    expect(forwarded).toContain('release="https://artifacts.example.test/chat/releases/afbin-v$version"');
  });
  it('keeps GitHub when the local build is another version than the installer pins', async () => {
    expect(await (await app(localBuild('9.9.9')).request('/chat/install.sh')).text()).toBe(script);
  });
});

describe('GET /chat/releases', () => {
  it('serves the local build for its own version only, by plain file names, uncached', async () => {
    const server = app(localBuild());
    const binary = await server.request(`/chat/releases/afbin-v${pinned}/afbin-darwin-arm64`);
    expect(binary.status).toBe(200);
    expect(binary.headers.get('content-length')).toBe(String(Buffer.byteLength(payload)));
    expect(binary.headers.get('cache-control')).toBe('no-store');
    expect(await binary.text()).toBe(payload);
    const sums = await server.request(`/chat/releases/afbin-v${pinned}/SHA256SUMS`);
    expect(sums.status).toBe(200);
    expect(await sums.text()).toMatch(/^[0-9a-f]{64} {2}afbin-darwin-arm64\n$/);
    for (const route of [`/chat/releases/afbin-v9.9.9/afbin-darwin-arm64`, `/chat/releases/afbin-v${pinned}/missing`, `/chat/releases/afbin-v${pinned}/..%2Fafbin-darwin-arm64`, `/chat/releases/other/afbin-darwin-arm64`, `/chat/releases/afbin-v${pinned}/.hidden`]) {
      expect((await server.request(route)).status, route).toBe(404);
    }
    expect((await app(path.join(os.tmpdir(), 'afbin-no-such-dir')).request(`/chat/releases/afbin-v${pinned}/afbin-darwin-arm64`)).status).toBe(404);
  });
});
