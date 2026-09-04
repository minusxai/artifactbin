/**
 * `npm ci` MUST NOT ASK THE REGISTRY FOR AN AUDIT — the install is the
 * install, and the advisory call is a THIRD-PARTY OUTAGE ON THE CRITICAL PATH.
 *
 * Every `npm ci` ends by POSTing the whole lockfile to npm's advisory
 * endpoint and WAITING for the answer, then retrying twice (`fetch-retries=2`)
 * when it fails. On 2026-09-04 that endpoint degraded — 50–220s per call, or a
 * 120s hang answered 503 — and each install went from ~15s to 1–7 minutes.
 * Measured on this repo's own lockfile, npm 10.9.8, same version the node:22
 * image ships:
 *
 *     npm ci --ignore-scripts --omit=dev              421s
 *     npm ci --ignore-scripts --omit=dev --no-audit     3s
 *
 * The `image` job runs `npm ci` ten times across five Dockerfiles, so it paid
 * that stall ten times over and was CANCELLED at its 30-minute cap; the `test`
 * roll-up went red with no test having failed. The other jobs escaped only
 * because they restore `node_modules` from the Actions cache and skip the
 * install entirely.
 *
 * The audit buys nothing here: `npm ci` installs a PINNED lockfile, so the
 * answer cannot change what is installed, and no job reads the verdict. Run
 * `npm audit` on its own if you want the signal.
 *
 * TWO PLACES, because they cover disjoint ground and neither covers both:
 *  - `.npmrc` at the repo root is checked out, so it reaches local dev and
 *    every runner-side `npm ci` with nothing to remember.
 *  - a Dockerfile's build context does NOT include it (nothing copies it), and
 *    a COPY would need repeating per STAGE — a stage anyone forgets stalls
 *    silently, which is the `proxy.ts` failure class this directory already
 *    has a test about. So the flag rides the COMMAND, where it cannot be out
 *    of order and cannot be half-applied.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../../..');

/** Every Dockerfile in the repo, DISCOVERED — a new service image joins by existing. */
function dockerfiles(): string[] {
  const found: string[] = [];
  if (existsSync(path.join(ROOT, 'Dockerfile'))) found.push('Dockerfile');
  const services = path.join(ROOT, 'services');
  for (const entry of readdirSync(services, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = path.join('services', entry.name, 'Dockerfile');
    if (existsSync(path.join(ROOT, rel))) found.push(rel);
  }
  return found;
}

/** The `npm ci` invocations of one Dockerfile, as `[line number, text]`. */
function npmCiLines(rel: string): [number, string][] {
  return readFileSync(path.join(ROOT, rel), 'utf8')
    .split('\n')
    .map((text, i): [number, string] => [i + 1, text])
    // The invocation, never the prose about it: a `#` comment is not a command.
    .filter(([, text]) => /(^|\s)npm ci(\s|$)/.test(text) && !text.trimStart().startsWith('#'));
}

describe('every npm ci in every image', () => {
  const files = dockerfiles();

  it('finds the five images (the scan is not vacuous)', () => {
    expect(files).toContain('Dockerfile');
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.flatMap(npmCiLines).length).toBeGreaterThanOrEqual(9);
  });

  it.each(files)('%s passes --no-audit to every npm ci', (rel) => {
    for (const [line, text] of npmCiLines(rel)) {
      expect(
        text,
        `${rel}:${line} runs npm ci without --no-audit — one npm advisory-endpoint outage stalls this build for minutes`,
      ).toContain('--no-audit');
    }
  });
});

describe('the repo .npmrc', () => {
  const npmrcPath = path.join(ROOT, '.npmrc');

  it('exists, so local dev and every CI runner inherit it', () => {
    expect(existsSync(npmrcPath), '.npmrc is missing at the repo root').toBe(true);
  });

  it('turns the install-time audit and funding calls off', () => {
    const text = readFileSync(npmrcPath, 'utf8');
    expect(text).toMatch(/^audit\s*=\s*false$/m);
    expect(text).toMatch(/^fund\s*=\s*false$/m);
  });

  it('carries no credential — it is committed, and read by every install', () => {
    const text = readFileSync(npmrcPath, 'utf8');
    for (const secret of ['_auth', '_authToken', '_password', 'registry.npmjs.org/:'])
      expect(text, `.npmrc must never carry ${secret}`).not.toContain(secret);
  });
});
