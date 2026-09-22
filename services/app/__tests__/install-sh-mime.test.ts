// Both installer entrypoints share the current CLI download and origin contract.
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
/** The script as served: the only change on a server with no CLI build is the origin it names. */
const addressed = (origin: string) => script.replace("  origin=''", `  origin='${origin}'`);
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
  it.each([false, true])('matches the CLI installer for a custom origin (local build: %s)', async (local) => {
    const server = app(local ? localBuild() : path.join(os.tmpdir(), 'afbin-no-such-dir'));
    const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artifacts.example.test' };
    const canonical = await server.request('/chat/install.sh', { headers });
    const alias = await server.request('/install.sh', { headers });
    expect(alias.status).toBe(200);
    const body = await alias.text();
    expect(body).toBe(await canonical.text());
    expect(body).toContain("  origin='https://artifacts.example.test'");
    expect(body).not.toContain('docker');
    for (const header of ['content-type', 'cache-control', 'x-content-type-options']) {
      expect(alias.headers.get(header)).toBe(canonical.headers.get(header));
    }
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
    expect(body).toBe(addressed('http://localhost'));
    expect(body).toContain(`release="${GITHUB}"`);
  });
  it('points the installer at its own origin when a local CLI build matches the pinned version', async () => {
    const server = app(localBuild());
    const body = await (await server.request('/chat/install.sh')).text();
    expect(body).toContain('release="http://localhost/chat/releases/afbin-v$version"');
    expect(body).not.toContain('github.com');
    expect(body.replace('http://localhost/chat/releases/afbin-v$version', GITHUB)).toBe(addressed('http://localhost'));
    const forwarded = await (await server.request('/chat/install.sh', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artifacts.example.test' } })).text();
    expect(forwarded).toContain('release="https://artifacts.example.test/chat/releases/afbin-v$version"');
  });
  // The CLI installed from a local origin published its first dataset to
  // artifactbin.dev, anonymously, because nothing had told it where it came from.
  it('tells the installer the origin it was served from, so afbin adopts it at setup', async () => {
    expect(script).toContain("  origin=''");
    expect(script).toContain('[ -z "$origin" ] || server="--server=$origin"');
    expect(script).toContain('setup --yes $server');
    const forwarded = await (await app().request('/chat/install.sh', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artifacts.example.test' } })).text();
    expect(forwarded).toContain("  origin='https://artifacts.example.test'");
    expect(forwarded).not.toContain("origin=''");
  });
  it('keeps GitHub when the local build is another version than the installer pins', async () => {
    expect(await (await app(localBuild('9.9.9')).request('/chat/install.sh')).text()).toBe(addressed('http://localhost'));
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

describe('GET /chat/install.ps1',()=>{
 it.each([false,true])('serves Windows installation for this origin (local build: %s)',async local=>{
  const response=await app(local?localBuild():path.join(os.tmpdir(),'afbin-no-such-dir')).request('/chat/install.ps1',{headers:{'x-forwarded-proto':'https','x-forwarded-host':'artifacts.example.test'}});
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const body=await response.text();
  expect(body).toContain("$Origin = 'https://artifacts.example.test'");
  expect(body).toContain(`$Version = '${pinned}'`);
  expect(body).toContain(`$ReleaseRoot = '${local?'https://artifacts.example.test/chat/releases':'https://github.com/minusxai/artifactbin/releases/download'}'`);
 });
});
