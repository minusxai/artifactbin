/**
 * HOW MANY SERVERS A GATE RUN BOOTS — the pure half, so it can be tested without booting one.
 *
 * The runner has always been able to boot its own servers (`--servers=N`), and that is what CI does:
 * `npm run build`, then `node scripts/gates.mjs --servers=4`. Locally the default was the opposite —
 * one dev server, discovered at `http://localhost:3040` — and the two runs did not mean the same thing:
 *
 *  - A DEV server serves the SPA through Vite, whose HMR websocket lives on a second port. The app's CSP is
 *    a fixed `connect-src 'self'` (services/app/server/app.ts), so the browser refuses that socket, the SPA
 *    never mounts, and every gate that waits for the artifact iframe or a chart's marks times out. MEASURED
 *    on a clean checkout: 26 of 42 gates failed, and the SAME 26 failed on a commit that had changed
 *    nothing — an environment mismatch wearing a product bug's clothes.
 *  - A dev server is also ONE server, so the set runs one gate at a time: ~25 minutes rather than ~3.
 *
 * So the default is now the CI shape: boot the production bundle, one server per core. `--servers=N` still
 * wins (0 included, for a caller who wants the old "drive :3040" behaviour), and passing base URLs still
 * means DRIVE THOSE — which is the whole point of `npm run test:gates -- <base>`.
 *
 * The CAP is not about the machine's patience but about the gates': each server is a full app process with
 * its own PGLite and its own Chromium work landing on it, and past half a dozen the wall-clock stops falling
 * while the flake rate starts rising. An explicit `--servers=N` is not capped — the caller measured.
 */

import { randomBytes } from 'node:crypto';

/** The most servers the DERIVED default will boot, however many cores the machine reports. */
export const SERVER_CAP = 6;

/**
 * `{ servers, source }` — how many to boot and why, so the runner can say so.
 *   `bases`   base URLs were given: boot nothing, drive those.
 *   `flag`    `--servers=N` was given: boot exactly N (0 = boot nothing and fall back to the default base).
 *   `default` neither: one per core, capped at SERVER_CAP, never fewer than one.
 * Both a base URL and `--servers` is a refusal — the two say different things about where the gates run.
 */
export function resolveServers({ args = [], bases = [], cpus } = {}) {
  const flag = args.find((a) => a.startsWith('--servers='));
  if (flag !== undefined && bases.length > 0) {
    throw new Error('Pass base URLs or --servers=N, not both.');
  }
  if (flag !== undefined) {
    const raw = flag.slice('--servers='.length);
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0) {
      throw new Error(`bad --servers: ${JSON.stringify(raw)} (expected a non-negative whole number)`);
    }
    return { servers: n, source: 'flag' };
  }
  if (bases.length > 0) return { servers: 0, source: 'bases' };
  const cores = Number.isInteger(cpus) && cpus > 0 ? cpus : 1;
  return { servers: Math.min(SERVER_CAP, cores), source: 'default' };
}

/**
 * THE SECRET A BOOTED SERVER NEEDS. The servers this runner boots are PRODUCTION-mode (that is the point —
 * the dev server's stylesheet once compiled to zero rules in the build alone), and a production boot refuses
 * without `AUTH__SECRET`. CI hands its gates job one per run
 * (`.github/workflows/ci.yml`: `AUTH__SECRET: gates-ci-${{ github.run_id }}`); locally nothing did, so the
 * default that boots its own servers would have died at the first one.
 *
 * The environment's value wins — a run is only as honest as the environment it runs against, and a `.env`
 * that names one is naming it deliberately. Otherwise ONE is minted for the whole run, which is exactly what
 * CI's shape means: every server in the run shares it, and a throwaway server with in-memory PGLite has
 * nothing to survive a restart for.
 */
export function runSecret(env = process.env) {
  return env.AUTH__SECRET || `gates-local-${randomBytes(16).toString('hex')}`;
}
