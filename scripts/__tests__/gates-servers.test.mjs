/**
 * HOW MANY SERVERS A LOCAL GATE RUN BOOTS, AND WHY IT BOOTS ANY.
 *
 * `npm run test:gates` used to mean "drive whatever is listening on :3040" — a DEV server. That is not what
 * CI runs, and the difference is not cosmetic: the dev server's Vite HMR websocket lives on a second port,
 * the app's CSP is a fixed `connect-src 'self'`, and the browser therefore refuses the socket and the SPA
 * never mounts. Twenty-six gates fail on a checkout where nothing is wrong. CI has never seen it, because CI
 * builds and boots the bundle (`.github/workflows/ci.yml`: `npm run build` then `gates.mjs --servers=4`).
 *
 * So the DEFAULT is the CI shape: boot the production bundle, one server per core (capped), and fan the set
 * out over them. An explicit base URL still wins — driving a server you already have is the whole point of
 * `npm run test:gates -- <base>` — and an explicit `--servers=N` still wins over the derived count.
 */
import { describe, it, expect } from 'vitest';
import { resolveServers, runSecret, SERVER_CAP } from '../gates.servers.mjs';

describe('resolveServers', () => {
  it('defaults to one server per core, capped, when neither a base URL nor --servers is given', () => {
    expect(resolveServers({ args: [], bases: [], cpus: 4 })).toEqual({ servers: 4, source: 'default' });
    expect(resolveServers({ args: ['--only=fork'], bases: [], cpus: 2 })).toEqual({ servers: 2, source: 'default' });
    expect(resolveServers({ args: [], bases: [], cpus: 1 })).toEqual({ servers: 1, source: 'default' });
  });

  it(`never boots more than ${SERVER_CAP} of them, however many cores the machine has`, () => {
    expect(SERVER_CAP).toBe(6);
    expect(resolveServers({ args: [], bases: [], cpus: 16 })).toEqual({ servers: SERVER_CAP, source: 'default' });
    expect(resolveServers({ args: [], bases: [], cpus: 128 }).servers).toBe(SERVER_CAP);
  });

  it('an explicit --servers=N wins, including --servers=0 (drive the default base and boot nothing)', () => {
    expect(resolveServers({ args: ['--servers=2'], bases: [], cpus: 16 })).toEqual({ servers: 2, source: 'flag' });
    expect(resolveServers({ args: ['--servers=9'], bases: [], cpus: 2 }), 'the cap is a default, not a ceiling on the flag').toEqual({ servers: 9, source: 'flag' });
    expect(resolveServers({ args: ['--servers=0'], bases: [], cpus: 8 })).toEqual({ servers: 0, source: 'flag' });
  });

  it('a base URL means DRIVE THAT SERVER: nothing is booted, and no default applies', () => {
    expect(resolveServers({ args: [], bases: ['http://localhost:6601'], cpus: 8 })).toEqual({ servers: 0, source: 'bases' });
    expect(resolveServers({ args: ['--only=fork'], bases: ['http://a', 'http://b'], cpus: 8 })).toEqual({ servers: 0, source: 'bases' });
  });

  it('a base URL AND --servers=N together is a refusal, not a guess', () => {
    expect(() => resolveServers({ args: ['--servers=2'], bases: ['http://localhost:6601'], cpus: 8 }))
      .toThrow(/base URLs or --servers/);
  });

  it('a --servers that is not a non-negative integer is a refusal naming what was given', () => {
    for (const bad of ['--servers=x', '--servers=-1', '--servers=', '--servers=1.5']) {
      expect(() => resolveServers({ args: [bad], bases: [], cpus: 4 }), bad).toThrow(/--servers/);
    }
  });

  it('an unusable core count still boots one server rather than none', () => {
    expect(resolveServers({ args: [], bases: [], cpus: 0 })).toEqual({ servers: 1, source: 'default' });
    expect(resolveServers({ args: [], bases: [], cpus: undefined })).toEqual({ servers: 1, source: 'default' });
  });
});

describe('runSecret', () => {
  it('uses the environment\'s AUTH__SECRET when there is one — a gate run is only as honest as its environment', () => {
    expect(runSecret({ AUTH__SECRET: 'from-dot-env' })).toBe('from-dot-env');
  });

  it('otherwise mints ONE per run, because a production-mode server refuses to boot without it', () => {
    // `.github/workflows/ci.yml` hands the gates job `AUTH__SECRET: gates-ci-${{ github.run_id }}` — one
    // value for the whole run. Locally nothing does, and the bundle refuses: "[boot] AUTH__SECRET is
    // required in production". A throwaway server with in-memory PGLite has nothing to survive a restart
    // FOR, so minting one is the faithful local copy of what CI supplies.
    const a = runSecret({});
    expect(a).toMatch(/^gates-local-[0-9a-f]{32}$/);
    expect(runSecret({ AUTH__SECRET: '' }), 'empty is unset').toMatch(/^gates-local-/);
    expect(runSecret({})).not.toBe(a);
  });
});
