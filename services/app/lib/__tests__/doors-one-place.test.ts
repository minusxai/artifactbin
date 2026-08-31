/**
 * A DOOR IS ENFORCED IN EXACTLY ONE PLACE (P2 §H).
 *
 * The proxy's `doorFor()` decides which door a request opens, and its limiter
 * counts it BEFORE the request is forwarded. An app-side helper counting the
 * SAME door in the same co-hosted process halves the configured ceiling — a
 * live bug this wave found: ANON_MINT, MUTATE and PUBLISH were each counted
 * twice. So the app's `lib/auth` may make NO limiter call that names a door
 * the proxy maps — the app keeps only its own QUOTAS (web-ingest, counted per
 * URL inside one publish, which no proxy can see).
 *
 * Source-text, the way lib/__tests__/env-namespacing.test.ts reads config.ts:
 * the proxy's `doorFor()` is the vocabulary of record, read as text (never
 * imported — the app tree imports nothing from the proxy package).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');

/** Every door the proxy's doorFor() can name, read from its source. */
function proxyDoorNames(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'services/proxy/src/parts.ts'), 'utf8');
  const body = src.slice(src.indexOf('export function doorFor'));
  const names = new Set<string>();
  for (const m of body.matchAll(/'([A-Z_]+)'/g)) names.add(m[1]!);
  return [...names];
}

/** Every `limiter().limit(...)` (or `.limit('DOOR', ...)`) call in a file's text, as door names. */
function limiterDoorCalls(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const names: string[] = [];
  for (const m of src.matchAll(/\.limit\(\s*'([A-Z_]+)'/g)) names.push(m[1]!);
  return names;
}

describe('a door is enforced in exactly one place', () => {
  it('no door is counted twice — none the proxy\'s doorFor() names appears in an app-side lib limiter call', () => {
    const proxyDoors = proxyDoorNames();
    expect(proxyDoors.length).toBeGreaterThan(0); // the vocabulary was read, not guessed
    const offenders: string[] = [];
    for (const door of limiterDoorCalls(path.join(ROOT, 'services/app/lib/auth.ts'))) {
      if (proxyDoors.includes(door)) offenders.push(`lib/auth.ts counts ${door}, which the proxy already counts`);
    }
    // Stronger and simpler than the name-by-name rule: after P2 §H the app's
    // auth helpers make no limiter call AT ALL — anything that returns needs a
    // door only the app can see (a quota), and that is not a door doorFor maps.
    expect(offenders).toEqual([]);
    expect(limiterDoorCalls(path.join(ROOT, 'services/app/lib/auth.ts'))).toEqual([]);
  });

  it('the app\'s anonymous mint route carries no limiter call — the proxy counts the ANON_MINT door', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/app/app/api/tokens/anonymous/route.ts'), 'utf8');
    expect(src).not.toMatch(/\.limit\(/);
    expect(src).not.toMatch(/anonMintRateLimited|mutationRateLimited|rateLimited/);
  });
});
