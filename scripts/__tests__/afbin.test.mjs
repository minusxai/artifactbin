/**
 * `npm run afbin` — the branch's CLI against THIS checkout's dev server.
 *
 * The four things that make the local loop safe are asserted here, because
 * every one of them has failed in the field: the port must come from the same
 * resolver `npm run dev` uses (or the CLI talks to somebody else's server), the
 * build must be rebuilt when it is stale (or the branch's change is not what
 * ran), the child must be pointed at a THROWAWAY home with skills switched off
 * (or it rewrites the owner's `~/.artifactbin` and `~/.claude/skills`), and a
 * server that is not up must be said so in one line rather than a stack trace.
 */
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { afbinPort, cliBuildStale, devHome, healthRefusal, runAfbin, serverFlag } from '../lib/afbin-run.mjs';
import { containmentExpectation, containmentObserved } from '../lib/session-containment.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** A checkout-shaped temporary tree: the CLI's sources and its built entry. */
async function fakeCheckout({ distAge = 0, srcAge = 10 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'afbin-run-'));
  await mkdir(path.join(root, 'services', 'cli', 'src'), { recursive: true });
  await mkdir(path.join(root, 'services', 'cli', 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'services', 'cli', 'dist'), { recursive: true });
  const now = Date.now() / 1000;
  await writeFile(path.join(root, 'services', 'cli', 'src', 'index.ts'), 'export {};\n');
  await utimes(path.join(root, 'services', 'cli', 'src', 'index.ts'), now - srcAge, now - srcAge);
  await writeFile(path.join(root, 'services', 'cli', 'scripts', 'build.mjs'), '// build\n');
  await utimes(path.join(root, 'services', 'cli', 'scripts', 'build.mjs'), now - srcAge, now - srcAge);
  await writeFile(path.join(root, 'services', 'cli', 'dist', 'afbin.mjs'), '// built\n');
  await utimes(path.join(root, 'services', 'cli', 'dist', 'afbin.mjs'), now - distAge, now - distAge);
  return root;
}

/** A run that records rather than performs: no child, no build, no network. */
function recorder({ healthy = true } = {}) {
  const spawned = [];
  const builds = [];
  const logged = [];
  return {
    spawned, builds, logged,
    options: {
      fetchImpl: async () => (healthy ? new Response('{"ok":true}', { status: 200 }) : new Response('{"ok":false}', { status: 503 })),
      spawnImpl: (file, args, options) => { spawned.push({ file, args, options }); return 0; },
      build: async (root) => { builds.push(root); },
      log: (line) => { logged.push(line); },
    },
  };
}

describe('npm run afbin', () => {
  it('takes its port from the resolver npm run dev uses: APP__PORT wins, then the public base URL, then 3030', () => {
    expect(afbinPort({ APP__PORT: '7601', APP__PUBLIC_BASE_URL: 'http://localhost:7801' })).toBe(7601);
    expect(afbinPort({ APP__PUBLIC_BASE_URL: 'http://localhost:7801' })).toBe(7801);
    expect(afbinPort({})).toBe(3030);
    // The entry loads `.env` through the same module, so a worktree's own block applies
    // without the caller exporting anything — and an exported APP__PORT still wins.
    const entry = readFileSync(path.join(REPO_ROOT, 'scripts', 'afbin.mjs'), 'utf8');
    expect(entry).toMatch(/loadDotEnv/);
    expect(entry).toMatch(/dev-env\.mjs/);
  });

  it('rebuilds the CLI only when dist is missing or older than a source file', async () => {
    const fresh = await fakeCheckout({ distAge: 0, srcAge: 10 });
    const stale = await fakeCheckout({ distAge: 10, srcAge: 0 });
    const gone = await fakeCheckout();
    try {
      expect(await cliBuildStale(fresh)).toBe(false);
      expect(await cliBuildStale(stale)).toBe(true);
      await rm(path.join(gone, 'services', 'cli', 'dist', 'afbin.mjs'));
      expect(await cliBuildStale(gone)).toBe(true);
    } finally {
      for (const root of [fresh, stale, gone]) await rm(root, { recursive: true, force: true });
    }
  });

  it('execs the branch CLI against this checkout, in a throwaway home, with skills switched off', async () => {
    const root = await fakeCheckout();
    const run = recorder();
    try {
      const code = await runAfbin({
        argv: ['testuser', 'new', '--json'],
        env: { APP__PORT: '7601', HOME: '/home/owner', ARTIFACTBIN_TOKEN: 'production-secret', ARTIFACTBIN_URL: 'https://artifactbin.dev' },
        root,
        home: '/home/owner',
        ...run.options,
      });
      expect(code).toBe(0);
      expect(run.builds).toEqual([]);
      expect(run.spawned).toHaveLength(1);
      const [child] = run.spawned;
      expect(child.args[0]).toBe(path.join(root, 'services', 'cli', 'dist', 'afbin.mjs'));
      expect(child.args.slice(1)).toEqual(['testuser', 'new', '--json', '--server', 'http://localhost:7601']);
      // The one directory this loop is allowed to write. `~/.artifactbin` is never named.
      expect(child.options.env.ARTIFACTBIN_HOME).toBe(devHome(7601, '/home/owner'));
      expect(child.options.env.ARTIFACTBIN_HOME).toBe('/home/owner/.artifactbin-dev/7601');
      expect(child.options.env.ARTIFACTBIN_SKILLS).toBe('off');
      // A production credential exported in the shell must not follow the dev loop.
      expect(child.options.env.ARTIFACTBIN_TOKEN).toBeUndefined();
      expect(child.options.env.ARTIFACTBIN_URL).toBeUndefined();
      expect(child.options.stdio).toBe('inherit');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('leaves a caller\'s own --server alone, in either spelling', async () => {
    const root = await fakeCheckout();
    const run = recorder();
    try {
      for (const chosen of [['--server', 'http://localhost:7701'], ['--server=http://localhost:7701']]) {
        run.spawned.length = 0;
        await runAfbin({ argv: ['status', ...chosen], env: { APP__PORT: '7601' }, root, home: '/home/owner', ...run.options });
        expect(run.spawned[0].args.slice(1)).toEqual(['status', ...chosen]);
        // The throwaway home still follows this checkout's port: only the destination moved.
        expect(run.spawned[0].options.env.ARTIFACTBIN_HOME).toBe(devHome(7601, '/home/owner'));
      }
      expect(serverFlag(['status'], 7601)).toEqual(['--server', 'http://localhost:7601']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('places the dev server before a remote executable and preserves its arguments', async () => {
    const root = await fakeCheckout(); const run = recorder();
    try {
      await runAfbin({argv:['remote','--name','claude2','claude','--server','agent-server'],env:{APP__PORT:'7601'},root,home:'/home/owner',...run.options});
      expect(run.spawned[0].args.slice(1)).toEqual(['remote','--server','http://localhost:7601','--name','claude2','claude','--server','agent-server']);
    } finally { await rm(root,{recursive:true,force:true}); }
  });

  it('builds first when the dist is stale, and forwards the child exit code', async () => {
    const root = await fakeCheckout({ distAge: 10, srcAge: 0 });
    const run = recorder();
    run.options.spawnImpl = (file, args, options) => { run.spawned.push({ file, args, options }); return 3; };
    try {
      const code = await runAfbin({ argv: ['--version'], env: { APP__PORT: '7601' }, root, home: '/home/owner', ...run.options });
      expect(run.builds).toEqual([root]);
      expect(code).toBe(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('refuses in one line naming npm run dev and the port when the server is not answering', async () => {
    const root = await fakeCheckout();
    const run = recorder({ healthy: false });
    try {
      const code = await runAfbin({ argv: ['--version'], env: { APP__PORT: '7601' }, root, home: '/home/owner', ...run.options });
      expect(code).toBe(1);
      expect(run.spawned).toEqual([]);
      expect(run.builds).toEqual([]);
      expect(run.logged).toHaveLength(1);
      expect(run.logged[0]).toBe(healthRefusal(7601));
      expect(run.logged[0]).toMatch(/npm run dev/);
      expect(run.logged[0]).toMatch(/7601/);
      expect(run.logged[0]).not.toMatch(/\n/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

/**
 * The sessions gate asks the SERVER whether it ran the session contained, and drops
 * exactly the two assertions no unsandboxed host can answer — by name, and never by
 * softening the four-fact comparison Linux CI still makes.
 */
describe('session containment on a host with no sandbox', () => {
  it('asserts all four facts by default and skips only the sandbox\'s two, by name', () => {
    const contained = containmentExpectation(undefined);
    expect(contained.expected).toEqual({ checkout: false, network: false, own: 'ok', credentials: [] });
    expect(contained.skipped).toEqual([]);

    const unsandboxed = containmentExpectation('none');
    expect(unsandboxed.expected).toEqual({ own: 'ok', credentials: [] });
    expect(unsandboxed.skipped).toEqual(['filesystem containment (probe.checkout)', 'network containment (probe.network)']);
  });

  it('still fails an unsandboxed host on the facts the parent owns, and on the sandbox\'s facts when it is on', () => {
    const leaky = { checkout: true, network: true, own: 'ok', credentials: [] };
    const unsandboxed = containmentExpectation('none');
    // Reading the checkout is bubblewrap's job, so it is not asked about here...
    expect(containmentObserved(leaky, unsandboxed.expected)).toEqual(unsandboxed.expected);
    // ...but a credential in the worker's environment is OURS, and still fails.
    expect(containmentObserved({ ...leaky, credentials: ['ADMIN__SECRET'] }, unsandboxed.expected)).not.toEqual(unsandboxed.expected);
    // With the sandbox on, the same leaky probe fails on the two facts that were skipped.
    const contained = containmentExpectation(undefined);
    expect(containmentObserved(leaky, contained.expected)).not.toEqual(contained.expected);
  });
});
