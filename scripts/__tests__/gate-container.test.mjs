/**
 * The pure half of the gate-container runner: what it accepts, what it refuses, and the
 * `docker run` line whose shape carries its promises — a read-only worktree, a quota, one named
 * cache volume and nothing published on the host.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import {
  BUILD_OUTPUTS, BUILD_VOLUME, CONTAINER_REFUSALS, DEFAULT_CPUS, DEFAULT_MEMORY, INSIDE,
  buildCacheKey, checkGates, containerName, depsVolume, dockerfile, dockerRunArgs, imageTag, parseArgs,
} from '../lib/gate-container.mjs';
import { gateNamesOnDisk } from '../gates.manifest.mjs';

const SCRIPTS = path.resolve(import.meta.dirname, '..');

describe('parseArgs', () => {
  it('defaults to one CI runner’s shape: 4 CPUs, 8g, two servers', () => {
    expect(parseArgs(['hydration'])).toEqual({ cpus: DEFAULT_CPUS, memory: DEFAULT_MEMORY, servers: 2, gates: ['hydration'], inside: false });
    expect(DEFAULT_CPUS).toBe(4);
  });

  it('reads both flag spellings, derives servers from CPUs, and accepts gate file names', () => {
    expect(parseArgs(['--cpus', '6', '--memory=12g', 'scripts/gates/gate-fonts.mjs', 'gate-web-assets', 'fonts']))
      .toMatchObject({ cpus: 6, memory: '12g', servers: 3, gates: ['fonts', 'web-assets'] });
    expect(parseArgs(['--cpus=1', 'a']).servers).toBe(1);
    expect(parseArgs(['--servers', '4', 'a']).servers).toBe(4);
    expect(parseArgs(['--inside', '--servers', '2', 'a', 'b'])).toMatchObject({ inside: true, gates: ['a', 'b'] });
    expect(parseArgs(['--inside', '--build-key', 'a'.repeat(32), 'a']).buildKey).toBe('a'.repeat(32));
    expect(() => parseArgs(['--build-key', 'nope', 'a'])).toThrow(/--build-key/);
  });

  it('refuses no gates, unknown options and malformed quotas', () => {
    expect(() => parseArgs([])).toThrow(/at least one gate/);
    expect(() => parseArgs(['--all'])).toThrow(/unknown option --all/);
    expect(() => parseArgs(['--cpus', '0', 'a'])).toThrow(/--cpus/);
    expect(() => parseArgs(['--memory', 'lots', 'a'])).toThrow(/--memory/);
    expect(() => parseArgs(['--servers', '0', 'a'])).toThrow(/--servers/);
    expect(() => parseArgs(['--cpus'])).toThrow(/needs a value/);
  });
});

describe('checkGates', () => {
  const known = gateNamesOnDisk(readdirSync(path.join(SCRIPTS, 'gates')));

  it('accepts real gates and names every unknown one at once', () => {
    expect(() => checkGates(['editor-path', 'inplace-edit'], known)).not.toThrow();
    expect(() => checkGates(['editor-path', 'nope', 'nada'], known)).toThrow(/unknown gate\(s\): nope, nada/);
    expect(() => checkGates(['container'], known)).toThrow(/unknown gate/);
  });

  it('refuses a gate that needs the host’s Docker, with the reason, and only gates that exist', () => {
    expect(() => checkGates(['data-journey'], known)).toThrow(/data-journey cannot run in a gate container: it starts its own Postgres/);
    for (const name of Object.keys(CONTAINER_REFUSALS)) expect(known).toContain(name);
  });
});

describe('image and dependency volume', () => {
  it('builds on the official Playwright image for the pinned version, with Node 22 and bubblewrap', () => {
    const file = dockerfile('1.62.1');
    expect(file).toContain('FROM mcr.microsoft.com/playwright:v1.62.1-noble');
    expect(file).toContain('FROM node:22-bookworm-slim AS node');
    expect(file).toMatch(/apt-get install[^\n]*bubblewrap/);
    expect(imageTag('1.62.1')).toMatch(/^afbin-gate:pw1\.62\.1-[0-9a-f]{12}$/);
    expect(imageTag('1.62.1')).not.toBe(imageTag('1.63.0'));
  });

  it('the image pins the Playwright the lockfile pins', () => {
    const lock = JSON.parse(readFileSync(path.join(SCRIPTS, '..', 'package-lock.json'), 'utf8'));
    const version = lock.packages['node_modules/playwright-core'].version;
    expect(dockerfile(version)).toContain(`playwright:v${version}-noble`);
  });

  it('keys the volume on every input that decides the installed bytes', () => {
    const base = { lock: 'L', copyAssets: 'C', preparePty: 'P', image: 'I' };
    const key = depsVolume(base);
    expect(key).toMatch(/^afbin-gate-deps-[0-9a-f]{16}$/);
    expect(depsVolume({ ...base })).toBe(key);
    for (const field of Object.keys(base)) expect(depsVolume({ ...base, [field]: 'changed' }), field).not.toBe(key);
  });

  it('keys the cached build on CI’s build key, the working tree’s changed build inputs and the dependencies', () => {
    const base = { buildKey: 'B', changes: 'C', deps: 'D' };
    const key = buildCacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(buildCacheKey({ ...base })).toBe(key);
    for (const field of Object.keys(base)) expect(buildCacheKey({ ...base, [field]: 'changed' }), field).not.toBe(key);
  });

  it('caches exactly what a CI gate shard restores and runs on without building', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(SCRIPTS, '..', '.github/workflows/ci.yml'), 'utf8'));
    const restore = jobs.gates.steps.find((step) => step.id === 'build-cache');
    expect([...BUILD_OUTPUTS].sort()).toEqual(restore.with.path.trim().split('\n').map((line) => line.trim()).sort());
  });

  it('builds only what the gates read, as CI’s gate shards do, and restores before building', () => {
    const runner = readFileSync(path.join(SCRIPTS, 'gate-container.mjs'), 'utf8');
    expect(runner).toContain("run('node', ['scripts/build/build-gate-inputs.mjs'])");
    expect(runner).not.toMatch(/run\('npm', \['run', 'build'/);
    expect(runner.indexOf('[ -f ${entry}/ready ] || exit 3')).toBeLessThan(runner.indexOf('build-gate-inputs.mjs\'])'));
  });
});

describe('dockerRunArgs', () => {
  const args = dockerRunArgs({
    name: containerName('/Users/me/projects/Proof Tree_A', 4242), image: 'afbin-gate:pw1-abc', volume: 'afbin-gate-deps-1', buildKey: 'b'.repeat(32),
    worktree: '/Users/me/projects/tree', cpus: 4, memory: '8g', servers: 2, gates: ['hydration', 'fonts'],
  });
  const value = (flag) => args[args.indexOf(flag) + 1];

  it('names the container per runner process', () => {
    expect(value('--name')).toBe('afbin-gate-proof-tree_a-4242');
  });

  it('mounts the worktree read-only, and the dependency and build caches as the two named volumes', () => {
    const mounts = args.filter((_, i) => args[i - 1] === '-v');
    expect(mounts).toEqual([`/Users/me/projects/tree:${INSIDE.src}:ro`, `afbin-gate-deps-1:${INSIDE.deps}`, `${BUILD_VOLUME}:${INSIDE.builds}`]);
  });

  it('applies the quota, removes itself, keeps stdin open and publishes no port', () => {
    expect(value('--cpus')).toBe('4');
    expect(value('--memory')).toBe('8g');
    expect(value('--memory-swap')).toBe('8g');
    expect(args).toContain('--rm');
    expect(args).toContain('-i');
    expect(args.some((arg) => arg === '-p' || arg.startsWith('--publish') || arg === '--network=host' || arg === 'host')).toBe(false);
  });

  it('runs the inside half with CI’s gate environment and the chosen gates', () => {
    expect(args.slice(args.indexOf('afbin-gate:pw1-abc') + 1)).toEqual(['node', `${INSIDE.src}/scripts/gate-container.mjs`, '--inside', '--servers', '2', '--build-key', 'b'.repeat(32), 'hydration', 'fonts']);
    expect(args.filter((_, i) => args[i - 1] === '-e')).toEqual(['DATASET__ALLOW_PRIVATE_NETWORKS=true']);
  });

});
