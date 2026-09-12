/**
 * ONE OWNER PER TABLE (CORE TEST 8). Each package declares its own tables and
 * nobody declares anybody else's: the app owns `app.*` (its DDL in
 * lib/schema.ts), the proxy owns `auth.*` (its DDL in its own schema module),
 * with no duplicated table concept across the boundary: app one-time codes
 * are `app.codes`; auth lifecycle state is `auth.credentials`; and the events
 * service owns `events.*` — the app reads that log through a grant and never
 * declares it.
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
const declared = (): Record<string, 'app' | 'proxy' | 'events'> => renderedSchema().tables;


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

  // DROPPED: 'the declared set is exactly the literal'. By its own case name, re-adding a table
  // means touching this test — it asserted that the fixture list above matches itself, and failed
  // for every schema change rather than for any wrong one. The ownership rules below are the test.

  it('rate_limit_hits is declared by NOBODY', () => {
    // The shared-counter backend died with the split's role model; the table
    // is a harmless orphan on deployments that already have it, and a fresh
    // database never creates it.
    const names = Object.keys(declared());
    expect(names.filter((n) => n.endsWith('.rate_limit_hits'))).toEqual([]);
  });
});

it('keeps editor annotation receipts beside app-owned atomic source edits',()=>{
 expect(declared()['app.artifact_edits']).toBe('app');
 expect(renderedSchema().schema).toContain('annotation_changes');
});

it('sharing revision belongs to app artifact state',()=>{expect(renderedSchema().schema).toMatch(/sharing_revision/);});
