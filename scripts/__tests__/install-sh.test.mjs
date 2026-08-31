// THE INSTALLER'S CONTRACT (node S2): Docker as the only dependency, one
// container, one mounted data dir, every question delegated to setup.mjs
// inside the image. Driven with a FAKE docker/curl/uname on PATH that record
// their argv. Seeded RED by the orchestrator.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'services', 'app', 'public', 'install.sh');

let tmp; let bin; let home; let log;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-sh-'));
  bin = path.join(tmp, 'bin'); home = path.join(tmp, 'home'); log = path.join(tmp, 'docker.log');
  fs.mkdirSync(bin); fs.mkdirSync(home);
  // fake docker: records argv; `run --rm … setup.mjs --out <p>` writes a plausible .env at the mounted path; `run -d` prints an id
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
echo "docker $*" >> "${log}"
case "$1" in
  info) [ -n "\${FAKE_DOCKER_DOWN:-}" ] && exit 1; exit 0;;
  pull) echo "fake pull progress"; exit 0;;
  rm) exit 0;;
  run)
    if printf '%s\\n' "$@" | grep -q 'setup.mjs'; then
      mount=$(printf '%s\\n' "$@" | grep -A0 -E '^[^:]+:/work$' | head -1 | cut -d: -f1)
      port=3030; for a in "$@"; do case "$prev" in --port) port="$a";; esac; prev="$a"; done
      printf 'AUTH__SECRET=fakefakefakefakefakefakefakefakefakefake\\nADMIN__SECRET=fake\\nCONTRACT__ACTOR_SECRET=fake\\nAPP__PORT=%s\\nAPP__PUBLIC_BASE_URL=http://localhost:%s\\n' "$port" "$port" > "$mount/.env"; chmod 600 "$mount/.env"; exit 0
    fi
    echo fakecontainerid; exit 0;;
  logs) echo "fake logs"; exit 0;;
  *) exit 0;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
echo "curl $*" >> "${log}"
[ -n "\${FAKE_HEALTH_DOWN:-}" ] && exit 22
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/bash
echo "\${FAKE_ARCH:-x86_64}"
`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run = (args = [], env = {}) => spawnSync('bash', [SCRIPT, ...args], {
  cwd: home, encoding: 'utf8',
  env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...env },
});
const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];

describe('install.sh', () => {
  it('is valid bash and serves from the app\'s public dir', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.readFileSync(SCRIPT, 'utf8').startsWith('#!')).toBe(true);
    expect(spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' }).status).toBe(0);
  });

  it('fails cleanly when docker is not running, before touching anything', () => {
    const r = run(['--no-interview', '--port=5211'], { FAKE_DOCKER_DOWN: '1' });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/docker/i);
    expect(fs.existsSync(path.join(home, 'artifact-bin'))).toBe(false);
  });

  it('fresh install: setup inside the image once, then one detached container with the mounted data dir', () => {
    const r = run(['--no-interview', '--port=5211']);
    expect(r.status, r.stderr).toBe(0);
    const c = calls();
    const setup = c.filter((l) => l.includes('setup.mjs'));
    expect(setup).toHaveLength(1);
    expect(setup[0]).toMatch(/docker run --rm .*-v \S+\/artifact-bin:\/work .*node scripts\/setup\.mjs --out \/work\/\.env/);
    expect(setup[0]).toMatch(/--yes/);
    expect(setup[0]).toMatch(/--no-next/);
    expect(setup[0]).toMatch(/--port 5211|--port=5211/);
    const detached = c.find((l) => /^docker run -d /.test(l));
    expect(detached).toBeDefined();
    expect(detached).toMatch(/--name artifact-bin /);
    expect(detached).toMatch(/--restart unless-stopped/);
    expect(detached).toMatch(/-p 127\.0\.0\.1:5211:3000/);
    expect(detached).toMatch(/-e APP__PORT=3000/);
    expect(detached).toMatch(/-v \S+\/artifact-bin\/data:\/app\/data/);
    expect(detached).toMatch(/--env-file \S+\/artifact-bin\/\.env/);
    expect(c.some((l) => /^docker pull /.test(l))).toBe(true);
    expect(r.stdout).toContain('fake pull progress');
    expect(c.some((l) => /^curl .*127\.0\.0\.1:5211\/health/.test(l))).toBe(true);
    expect(fs.existsSync(path.join(home, 'artifact-bin', 'data'))).toBe(true);
    expect(r.stdout).toMatch(/http:\/\/localhost:5211/);
    // nothing outside the target dir
    expect(fs.readdirSync(home)).toEqual(['artifact-bin']);
  });

  it('second run is an upgrade: no setup, pull + rm + run again, data kept', () => {
    expect(run(['--no-interview', '--port=5211']).status).toBe(0);
    fs.writeFileSync(path.join(home, 'artifact-bin', 'data', 'keep.txt'), 'x');
    fs.rmSync(log);
    const r = run(['--no-interview', '--port=5211']);
    expect(r.status, r.stderr).toBe(0);
    const c = calls();
    expect(c.some((l) => l.includes('setup.mjs'))).toBe(false);
    expect(c.some((l) => /^docker pull /.test(l))).toBe(true);
    expect(c.some((l) => /^docker rm -f artifact-bin/.test(l))).toBe(true);
    expect(c.some((l) => /^docker run -d /.test(l))).toBe(true);
    expect(fs.existsSync(path.join(home, 'artifact-bin', 'data', 'keep.txt'))).toBe(true);
    expect(r.stdout).toMatch(/upgrad/i);
  });

  it('on arm64 every docker command carries --platform linux/amd64', () => {
    expect(run(['--no-interview', '--port=5211'], { FAKE_ARCH: 'arm64' }).status).toBe(0);
    for (const l of calls().filter((l) => /^docker (pull|run) /.test(l))) expect(l).toMatch(/--platform linux\/amd64/);
  });

  it('a failed health gate prints the container logs and exits 1', () => {
    const r = run(['--no-interview', '--port=5211'], { FAKE_HEALTH_DOWN: '1', ARTIFACT_BIN_HEALTH_TIMEOUT: '2' });
    expect(r.status).toBe(1);
    expect(calls().some((l) => /^docker logs /.test(l))).toBe(true);
  });

  it('refuses a directory outside $HOME unless told otherwise', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    const r = spawnSync('bash', [SCRIPT, '--no-interview', '--port=5211'], { cwd: outside, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home } });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/HOME|shared/i);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
