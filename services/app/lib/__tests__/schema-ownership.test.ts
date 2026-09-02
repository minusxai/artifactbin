/**
 * ONE OWNER PER TABLE (CORE TEST 8). Each package declares its own tables and
 * nobody declares anybody else's: the app owns `app.*` (its DDL in
 * lib/schema.ts), the proxy owns `auth.*` (its DDL in its own schema module),
 * with no duplicated table concept across the boundary: app one-time codes
 * are `app.codes`; auth lifecycle state is `auth.credentials`.
 *
 * The declared set is read through the schema renderer — the ONE resolver of what is declared, the same one
 * __tests__/schema-sql-fresh.test.ts uses — so this test and the freshness
 * test can never disagree about what the two packages declare.
 *
 * `rate_limit_hits` is declared by NOBODY (P2 §G.2: the two-role model grants
 * the proxy nothing but SELECT on app.tokens, and a postgres limiter needs
 * INSERT/DELETE — the table has no writer, so it has no owner either). At the
 * wave-2c base this is RED on purpose: both sides still declare it, and the
 * proxy still declares `tokens`. That red is this test doing its job — it is
 * the message to the app wave (delete RATE_LIMIT_HITS from lib/schema.ts) and
 * the proxy wave (keep the proxy's declarations inside its own `auth` schema).
 */
import { describe, expect, it } from 'vitest';
import { renderedSchema } from '@/__tests__/rendered-schema';

/** The declared tables, keyed "<schema>.<table>" → the owning package. */
const declared = (): Record<string, 'app' | 'proxy'> => renderedSchema().tables;

/** The seed test's literal (CORE TEST 9) — the declared set, one owner each. */
const DECLARED_SET = [
  'app.annotations',
  'app.artifact_edits',
  'app.artifact_shares',
  'app.artifact_versions',
  'app.artifacts',
  'app.analytics_events',
  'app.codes',
  'app.tokens',
  'app.users',
  'app.webfonts',
  'auth.clients',
  'auth.credentials',
];

describe('table ownership', () => {
  it('every declared table has exactly one owner and no table concept is duplicated across schemas', () => {
    const tables = declared();
    const byName = new Map<string, Set<string>>();
    for (const [qualified, owner] of Object.entries(tables)) {
      const name = qualified.slice(qualified.indexOf('.') + 1);
      const sides = byName.get(name) ?? new Set<string>();
      sides.add(owner);
      byName.set(name, sides);
    }
    const shared = [...byName.entries()].filter(([, sides]) => sides.size > 1).map(([name]) => name);
    expect(shared).toEqual([]);
    expect(tables['auth.credentials']).toBe('proxy');
    expect(tables['app.codes']).toBe('app');
  });

  it('the declared set is exactly the literal (re-adding a table means touching this test)', () => {
    expect(Object.keys(declared()).sort()).toEqual([...DECLARED_SET].sort());
  });

  it('rate_limit_hits is declared by NOBODY', () => {
    // The shared-counter backend died with the split's role model; the table
    // is a harmless orphan on deployments that already have it, and a fresh
    // database never creates it.
    const names = Object.keys(declared());
    expect(names.filter((n) => n.endsWith('.rate_limit_hits'))).toEqual([]);
  });
});
