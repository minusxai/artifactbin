/**
 * HOW MANY SERVERS A LOCAL GATE RUN BOOTS, AND WHY IT BOOTS ANY.
 *
 * `npm run test:gates` used to mean "drive whatever is listening on :3040" — a DEV server. That is not what
 * CI runs, and the difference is not cosmetic: the dev server's Vite HMR websocket lives on a second port,
 * the app's CSP is a fixed `connect-src 'self'`, and the browser therefore refuses the socket and the SPA
 * never mounts. Twenty-six gates fail on a checkout where nothing is wrong. CI has never seen it, because CI
 * builds and boots the bundle.
 *
 * So the DEFAULT is the CI shape: boot the production bundle, one server per core (capped), and fan the set
 * out over them. An explicit base URL still wins — driving a server you already have is the whole point of
 * `npm run test:gates -- <base>` — and an explicit `--servers=N` still wins over the derived count.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { resolveServers, runSecret, SERVER_CAP } from '../gates.servers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('resolveServers', () => {
  it('is never serial and never past the cap for any core count — the two ends of the derived default', () => {
    // Stated as the RULE rather than as a handful of examples: a serial run must be something a person
    // asked for, and no core count may talk the default past the cap. One core, and none reported at
    // all, are the degenerate ends: still one server, never zero.
    for (let cores = 2; cores <= 64; cores++) {
      const { servers, source } = resolveServers({ args: [], bases: [], cpus: cores });
      expect(source, `${cores} cores`).toBe('default');
      expect(servers, `${cores} cores must not run serially`).toBeGreaterThan(1);
      expect(servers, `${cores} cores must not exceed the cap`).toBeLessThanOrEqual(SERVER_CAP);
    }
    expect(resolveServers({ args: [], bases: [], cpus: 1 })).toEqual({ servers: 1, source: 'default' });
    expect(resolveServers({ args: [], bases: [], cpus: undefined })).toEqual({ servers: 1, source: 'default' });
  });

  it('an explicit --servers=N wins over the default, and the cap does not bind it', () => {
    expect(resolveServers({ args: ['--servers=2'], bases: [], cpus: 16 })).toEqual({ servers: 2, source: 'flag' });
    expect(resolveServers({ args: ['--servers=9'], bases: [], cpus: 2 })).toEqual({ servers: 9, source: 'flag' });
    // 0 boots nothing; base URLs must then supply the targets, or the runner refuses.
    expect(resolveServers({ args: ['--servers=0'], bases: [], cpus: 8 })).toEqual({ servers: 0, source: 'flag' });
  });

  it('a base URL means DRIVE THAT SERVER, and asking for both is a refusal rather than a guess', () => {
    expect(resolveServers({ args: [], bases: ['http://localhost:6601'], cpus: 8 })).toEqual({ servers: 0, source: 'bases' });
    expect(() => resolveServers({ args: ['--servers=2'], bases: ['http://localhost:6601'], cpus: 8 }))
      .toThrow(/base URLs or --servers/);
    for (const bad of ['--servers=x', '--servers=-1', '--servers=', '--servers=1.5']) {
      expect(() => resolveServers({ args: [bad], bases: [], cpus: 4 }), bad).toThrow(/--servers/);
    }
  });
});

describe('runSecret and the npm script', () => {
  it('takes AUTH__SECRET from the environment, else mints ONE per run', () => {
    // A production-mode server refuses to boot without it ("[boot] AUTH__SECRET is required in
    // production"). CI hands the gates job one value for the whole run; locally nothing does, and a
    // throwaway server with in-memory PGLite has nothing to survive a restart FOR.
    expect(runSecret({ AUTH__SECRET: 'from-dot-env' })).toBe('from-dot-env');
    const minted = runSecret({});
    expect(minted).toMatch(/^gates-local-[0-9a-f]{32}$/);
    expect(runSecret({ AUTH__SECRET: '' }), 'empty is unset').toMatch(/^gates-local-/);
    expect(runSecret({})).not.toBe(minted);
  });

  it('bakes no server count into any script, so a bare run gets the derived default', () => {
    // A pinned count in package.json would silently outrank the rule above and nothing else here would
    // notice: the resolver would still be right and every local run still serial.
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:gates']).toBe('node scripts/gates.mjs');
    expect(Object.entries(pkg.scripts).filter(([, cmd]) => /gates\.mjs[^\n]*--servers=\d/.test(cmd))).toEqual([]);
  });
});
