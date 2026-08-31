/**
 * THE PAGINATION WRAPPER, TAKEN BACK APART. `runOne` re-derives the author's
 * own SQL from the `SELECT * FROM (…) AS _q … LIMIT n OFFSET m` form
 * `pagedQuery` builds — once to count the whole result, once to retry without
 * an ORDER BY the result cannot satisfy. Its input is AUTHOR SQL of any size,
 * so this is a hot, untrusted string: the unwrap has to be linear.
 *
 * The cases below are the ones where a careless rewrite diverges — greedy
 * choice among several `) AS _q`, a ` LIMIT ` inside the ORDER BY clause, an
 * empty inner query, a wrapper with no valid tail — followed by the ReDoS
 * regression the whole rewrite exists for.
 */
import { describe, expect, it } from 'vitest';
import { unwrapPaged } from '../src/engine';

describe('unwrapPaged', () => {
  it('returns the author SQL from the two forms pagedQuery builds', () => {
    expect(unwrapPaged('SELECT * FROM (select a from t) AS _q LIMIT 50 OFFSET 0')).toBe('select a from t');
    expect(unwrapPaged('SELECT * FROM (select a from t) AS _q ORDER BY "b" DESC NULLS LAST LIMIT 50 OFFSET 100')).toBe('select a from t');
    expect(unwrapPaged('SELECT * FROM (a\nb) AS _q ORDER BY "c" ASC NULLS LAST LIMIT 000 OFFSET 007')).toBe('a\nb');
    expect(unwrapPaged('SELECT * FROM () AS _q LIMIT 1 OFFSET 0')).toBe('');
  });

  it('takes the LAST wrapper, so an inner query that ends in `) AS _q` survives', () => {
    expect(unwrapPaged('SELECT * FROM (select * from (select 1) AS _q) AS _q LIMIT 5 OFFSET 5')).toBe('select * from (select 1) AS _q');
    expect(unwrapPaged('SELECT * FROM (a) AS _q ORDER BY (b) AS _q LIMIT 1 OFFSET 0')).toBe('a) AS _q ORDER BY (b');
  });

  it('cuts at the LIMIT/OFFSET that ends the string, not at one quoted inside the sort', () => {
    expect(unwrapPaged('SELECT * FROM (x) AS _q ORDER BY "a LIMIT 3 OFFSET 1" LIMIT 2 OFFSET 0')).toBe('x');
    expect(unwrapPaged('SELECT * FROM (a) AS _q ORDER BY b LIMIT 1 OFFSET 0 LIMIT 2 OFFSET 3')).toBe('a');
  });

  it('hands back anything that is not a wrapper, unchanged', () => {
    for (const sql of [
      'select a from t',
      'SELECT * FROM (select 1) AS _q',
      'SELECT * FROM (select 1) AS _q LIMIT 5',
      'SELECT * FROM (select 1) AS _q LIMIT 5 OFFSET x',
      // ` ORDER BY ` carries its own trailing space; without it there is no clause here.
      'SELECT * FROM (select 1) AS _q ORDER BY LIMIT 1 OFFSET 0',
    ]) expect(unwrapPaged(sql)).toBe(sql);
  });

  /**
   * NO BACKTRACKING, AT ANY LENGTH (CodeQL js/polynomial-redos). The pattern
   * this replaced cost time in the SQUARE of the input — a 50 KB chain of
   * near-wrappers measured 28 ms, 100 KB 107 ms, 200 KB 417 ms — and the input
   * is a document author's SQL. Five passes, because one pass of the old shape
   * still fit inside a 50 ms budget on a fast laptop: the budget has to be
   * crossed by the FAULT, not by the machine.
   */
  it('finishes a 50 KB pathological wrapper chain in well under 50ms', () => {
    const sql = 'SELECT * FROM (' + ') AS _q ORDER BY  LIMIT 111111111111111x'.repeat(1250);
    expect(sql.length).toBeGreaterThan(50_000);
    const started = performance.now();
    for (let i = 0; i < 5; i++) expect(unwrapPaged(sql)).toBe(sql);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
