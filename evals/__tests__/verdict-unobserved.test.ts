/**
 * A check the driver COULD NOT OBSERVE must not decide a run.
 *
 * `verdictFor` treats a gated check that is not `true` as a failure — absence of
 * evidence is not a pass, and that is right for a check we watched. It is wrong
 * for one we could not watch at all: an agent that reaches the product through
 * its provider's own server-side tool leaves no local traffic, and failing it
 * for "did not read the docs" is a statement about our instrument, not about it.
 */
import { describe, it, expect } from 'vitest';
import { gatedChecks, verdictFor } from '../lib/score/verdict';

const GATED = ['published', 'read_docs_before_write', 'no_unknown_endpoints', 'has_title'];

describe('gatedChecks', () => {
  it('keeps every check when the traffic WAS observed', () => {
    expect(gatedChecks(GATED, { trafficObserved: true })).toEqual(GATED);
  });

  it('drops the ledger-only checks when no traffic was observed, and keeps the product ones', () => {
    expect(gatedChecks(GATED, { trafficObserved: false })).toEqual(['published', 'has_title']);
  });

  it('so a run judged on product evidence alone can still PASS', () => {
    const checks = { published: true, has_title: true, read_docs_before_write: null, no_unknown_endpoints: null };
    expect(verdictFor(checks, gatedChecks(GATED, { trafficObserved: false })).passed).toBe(true);
  });

  it('and still FAILS on the product evidence when the document was never written', () => {
    const checks = { published: false, has_title: false, read_docs_before_write: null, no_unknown_endpoints: null };
    const v = verdictFor(checks, gatedChecks(GATED, { trafficObserved: false }));
    expect(v.passed).toBe(false);
    expect(v.failed).toEqual(['published', 'has_title']);
  });

  it('an unobserved ledger does NOT excuse a check we could watch — that stays gated', () => {
    const checks = { published: true, has_title: false };
    expect(verdictFor(checks, gatedChecks(GATED, { trafficObserved: false })).failed).toEqual(['has_title']);
  });
});
