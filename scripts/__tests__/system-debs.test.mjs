/**
 * NO WORKFLOW STEP DEPENDS ON THE APT MIRROR WHEN A CACHE COULD SERVE IT. Main run 43061010909 lost all nine gate shards
 * to one mirror DNS outage: apt installs of bubblewrap and of Firefox/WebKit's libraries. Every system package a
 * workflow installs goes through scripts/ci/system-debs.mjs, whose cache dir a `warm-caches` step on main writes under
 * the very path and key the gate shards read; and its planner installs exactly the cached packages missing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { ONLINE_BOUND_MS, debsToInstall, failureSummary, installedFrom, packageOfDeb, parseArgs, recoverDpkg } from '../ci/system-debs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflows = readdirSync(path.join(root, '.github/workflows')).filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({ file, jobs: yaml.parse(readFileSync(path.join(root, '.github/workflows', file), 'utf8')).jobs ?? {} }));
const SYSTEM_INSTALL = /apt-get|apt install|dpkg|install-deps|--with-deps/;

describe('the planner', () => {
  it('reads the package from apt archive names, epochs and +dfsg included', () => {
    expect(packageOfDeb('bubblewrap_0.9.0-1ubuntu0.3_amd64.deb')).toBe('bubblewrap');
    expect(packageOfDeb('/x/librsvg2-2_2.58.0%2bdfsg-1ubuntu0.1_amd64.deb')).toBe('librsvg2-2');
    expect(packageOfDeb('libsoup-3.0-common_3.4.4-5ubuntu0.9_all.deb')).toBe('libsoup-3.0-common');
    expect(packageOfDeb('libgl1_1%3a1.7.0-1build1_amd64.deb')).toBe('libgl1');
    expect(packageOfDeb('notes.txt')).toBeNull();
  });

  it('counts only fully installed packages', () => {
    expect([...installedFrom('libc6 ii \nbubblewrap rc \nlibcap2 ii\n\n')]).toEqual(['libc6', 'libcap2']);
  });

  it('installs every cached package not already present, and refuses a set that is not one closure', () => {
    const cached = ['libsoup-3.0-0_3.4.4-5ubuntu0.9_amd64.deb', 'libc6_2.39-0ubuntu8_amd64.deb', 'bubblewrap_0.9.0-1ubuntu0.3_amd64.deb'];
    expect(debsToInstall(cached, new Set(['libc6']))).toEqual(['bubblewrap_0.9.0-1ubuntu0.3_amd64.deb', 'libsoup-3.0-0_3.4.4-5ubuntu0.9_amd64.deb']);
    expect(debsToInstall(cached, new Set(['libc6', 'bubblewrap', 'libsoup-3.0-0']))).toEqual([]);
    expect(() => debsToInstall([...cached, 'bubblewrap_0.8.0-2_amd64.deb'], new Set())).toThrow(/two cached versions of bubblewrap/);
    expect(() => debsToInstall(['partial.deb'], new Set())).toThrow(/not named/);
  });

  it('takes a cache dir, an optional file the install must leave, and the online command after --', () => {
    expect(parseArgs(['/c', '--provides', '/usr/bin/bwrap', '--', 'sh', '-c', 'x'])).toEqual({ cacheDir: '/c', provides: '/usr/bin/bwrap', online: ['sh', '-c', 'x'] });
    expect(parseArgs(['/c', '--', 'npx', 'playwright', 'install-deps', 'webkit']).online).toEqual(['npx', 'playwright', 'install-deps', 'webkit']);
    expect(() => parseArgs(['/c'])).toThrow(/usage/);
    expect(() => parseArgs(['/c', '--provides', '--', 'x'])).toThrow(/usage/);
  });
});

// THE ONLINE COMMAND IS BOUNDED (its process behaviour, timers and real child processes, is system-debs-online.test.mjs,
// kept out of this guard file's pr fast runner): one minute an attempt, and one line that says why it failed.
describe('the online install', () => {
  it('allows each attempt a minute', () => {
    expect(ONLINE_BOUND_MS).toBe(60_000);
  });

  // A dpkg that outlived its stopped attempt holds the lock: the retry waits for it, then has dpkg finish what it began.
  it('waits for a dpkg that outlived the stopped attempt before the retry, and for nothing else', async () => {
    const locked = { status: 2, errors: ['dpkg: error: dpkg frontend lock was locked by another process with pid 3409'] };
    const answers = (...results) => { const calls = []; return { calls, run: async (command, args) => { calls.push([command, ...args].join(' ')); return results[Math.min(calls.length - 1, results.length - 1)]; } }; };
    const freed = answers(locked, locked, { status: 0, errors: [] });
    expect((await recoverDpkg(freed.run, { boundMs: 5_000, pauseMs: 0 })).status).toBe(0);
    expect(freed.calls).toHaveLength(3);
    expect(freed.calls[0]).toMatch(/(^|sudo )dpkg --configure -a$/);
    const broken = answers({ status: 1, errors: ['dpkg: error processing package x (--configure)'] });
    expect((await recoverDpkg(broken.run, { boundMs: 5_000, pauseMs: 0 })).status).toBe(1);
    expect(broken.calls).toHaveLength(1);
    const held = answers(locked);
    expect((await recoverDpkg(held.run, { boundMs: 30, pauseMs: 10 })).status).toBe(2);
    expect(held.calls.length).toBeLessThanOrEqual(4);
  });

  it('sums a failure up in one line: each attempt, then apt\'s last errors, else its last output', () => {
    const hung = { status: null, timedOut: true, errors: [], last: '0% [Connecting to azure.archive.ubuntu.com (52.252.75.106)]' };
    expect(failureSummary(['sh', '-c', 'sudo apt-get update'], [hung, { ...hung, status: 100, timedOut: false }])).toBe(
      '::error::system-debs: `sh -c sudo apt-get update` failed twice (1: timed out after 60s, 2: exit 100); last output: 0% [Connecting to azure.archive.ubuntu.com (52.252.75.106)]');
    const broken = { status: 100, timedOut: false, errors: ['E: Failed to fetch a', 'E: Unable to fetch some archives'], last: 'E: Unable to fetch some archives' };
    expect(failureSummary(['npx', 'playwright', 'install-deps', 'webkit'], [broken, { ...broken, errors: ['E: Unable to fetch some archives', 'W: mixed mirror'] }])).toBe(
      '::error::system-debs: `npx playwright install-deps webkit` failed twice (1: exit 100, 2: exit 100); apt said: E: Failed to fetch a | E: Unable to fetch some archives | W: mixed mirror');
    expect(failureSummary(['x'], [{ status: null, timedOut: false, errors: [] }, { status: 3, timedOut: false, errors: [] }])).toBe('::error::system-debs: `x` failed twice (1: did not start, 2: exit 3)');
  });
});

describe('the workflows', () => {
  const steps = workflows.flatMap(({ file, jobs }) => Object.entries(jobs).flatMap(([job, { steps = [] }]) => steps.map((step) => ({ where: `${file} ${job}`, step }))));

  it('install system packages only through scripts/ci/system-debs.mjs, never with --with-deps', () => {
    const direct = steps.flatMap(({ where, step }) => (step.run ?? '').split('\n')
      .filter((line) => SYSTEM_INSTALL.test(line) && !line.trimStart().startsWith('#'))
      .filter((line) => line.includes('--with-deps') || !line.includes('node scripts/ci/system-debs.mjs'))
      .map((line) => `${where}: ${line.trim()}`));
    expect(direct).toEqual([]);
  });

  it('read every system-debs cache from a step whose path and key a main warm-caches step writes', () => {
    const ci = workflows.find(({ file }) => file === 'ci.yml').jobs;
    const warmWriters = ci['warm-caches'].steps.filter((step) => step.uses?.startsWith('actions/cache@'));
    const dirs = new Set(steps.flatMap(({ step }) => [...(step.run ?? '').matchAll(/node scripts\/ci\/system-debs\.mjs "\$HOME\/([^"]+)"/g)].map((match) => match[1])));
    expect([...dirs].sort()).toEqual(['browser-debs', 'session-debs']);
    for (const dir of dirs) {
      const writer = warmWriters.find((step) => step.with?.path === `~/${dir}`);
      expect(writer, `warm-caches writes ~/${dir}`).toBeDefined();
      const reader = ci.gates.steps.find((step) => step.uses?.startsWith('actions/cache') && step.with?.path === `~/${dir}`);
      expect(reader, `the gate shards restore ~/${dir}`).toBeDefined();
      expect(reader.with.key, dir).toBe(writer.with.key);
    }
    // A shard running one engine would freeze part of the all-engine closure under the shared key.
    expect(ci.gates.steps.find((step) => step.with?.path === '~/browser-debs').uses).toMatch(/^actions\/cache\/restore@/);
  });
});
