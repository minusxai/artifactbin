/**
 * The comment task's `changed` predicate and its thread reading.
 *
 * The module is `lib/score/kinds/comment` rather than the spike's
 * `lib/score/comment`: the kind OWNS its predicates, its setup and its check
 * names in one file, and a re-export existing only to keep an old test path
 * alive is a second address for one topic.
 *
 * The two document fixtures are REAL served documents from this product
 * (`GET /a/<id>/raw?chrome=0`), not hand-written HTML: `product.ts` carries the
 * scar from a hand-written island fixture that made a working function return 0
 * for two documents whose queries had run perfectly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { paragraphWords, splitAcrossParagraphs, splitVerbatim, threadMetrics } from '../lib/score/kinds/comment';

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', `comment-${name}.html`), 'utf8');

/** The paragraph the task's comment is anchored to, exactly as the seed publishes it. */
const SEEDED =
  'The support team closed 1,284 tickets last quarter. Median first response was three hours, and the backlog fell by half.';

describe('splitAcrossParagraphs — the task\'s `changed` check', () => {
  it('is FALSE for the seed as published (one paragraph)', () => {
    expect(splitAcrossParagraphs(fixture('seed'), SEEDED)).toBe(false);
  });

  it('is TRUE once the paragraph reads across two <p> elements', () => {
    expect(splitAcrossParagraphs(fixture('split'), SEEDED)).toBe(true);
  });

  it('is FALSE when the split lost words', () => {
    const lossy = fixture('split').replace(', and the backlog fell by half.', '.');
    expect(splitAcrossParagraphs(lossy, SEEDED)).toBe(false);
  });

  it('is FALSE when the halves were re-ordered', () => {
    const words = paragraphWords(fixture('split'));
    expect(words.length).toBe(4); // the served document really has four <p>s
    const reordered = fixture('split')
      .replace('The support team closed 1,284 tickets last quarter.', '@@A@@')
      .replace('Median first response was three hours, and the backlog fell by half.', 'The support team closed 1,284 tickets last quarter.')
      .replace('@@A@@', 'Median first response was three hours, and the backlog fell by half.');
    expect(splitAcrossParagraphs(reordered, SEEDED)).toBe(false);
  });

  // The near misses. A CI gate that fails a CORRECT split is how a gate gets turned off, and
  // exact word equality fails both of the first two — measured against the real fixture before
  // the predicate was relaxed. Punctuation at the seam, and the capital that follows a new
  // sentence boundary, are the agent writing English rather than the agent losing words.
  it('is TRUE when the first half drops its terminal period', () => {
    const h = fixture('split').replace('tickets last quarter.</p>', 'tickets last quarter</p>');
    expect(splitAcrossParagraphs(h, SEEDED)).toBe(true);
    expect(splitVerbatim(h, SEEDED)).toBe(false);
  });

  it('is TRUE when the second half is re-capitalised', () => {
    const h = fixture('split').replace('>Median first', '>median first');
    expect(splitAcrossParagraphs(h, SEEDED)).toBe(true);
    expect(splitVerbatim(h, SEEDED)).toBe(false);
  });

  it('still refuses a changed NUMBER — 1,284 is not 1284', () => {
    const h = fixture('split').replace('1,284', '1284');
    expect(splitAcrossParagraphs(h, SEEDED)).toBe(false);
  });

  it('splitVerbatim is TRUE for the split the real agent wrote', () => {
    expect(splitVerbatim(fixture('split'), SEEDED)).toBe(true);
  });

  it('ignores the annotation anchor and the ast stamps', () => {
    const stripped = fixture('split').replace(/ data-(mx-ast|annotation-anchor)="[^"]*"/g, '');
    expect(splitAcrossParagraphs(stripped, SEEDED)).toBe(true);
  });
});

describe('threadMetrics — `responded` and `resolved`', () => {
  const human = { author: { kind: 'human', label: null, transport: 'browser' } };
  const agent = { author: { kind: 'agent', label: 'Claude Code', transport: 'http' } };

  it('an untouched open thread answers neither', () => {
    expect(threadMetrics([{ status: 'open', thread: [human] }])).toEqual({
      responded: false, resolved: false, agentLabel: '',
    });
  });

  it('a resolved thread with an agent reply answers both, and names the agent', () => {
    expect(threadMetrics([{ status: 'resolved', thread: [human, agent] }])).toEqual({
      responded: true, resolved: true, agentLabel: 'Claude Code (http)',
    });
  });

  it('a resolve with no reply is resolved but NOT responded — the two checks are independent', () => {
    expect(threadMetrics([{ status: 'resolved', thread: [human] }])).toEqual({
      responded: false, resolved: true, agentLabel: '',
    });
  });

  it('a HUMAN second comment is not a response — the check is about the agent', () => {
    const m = threadMetrics([{ status: 'open', thread: [human, human] }]);
    expect(m.responded).toBe(false);
  });

  it('no annotations at all answers false rather than throwing', () => {
    expect(threadMetrics([])).toEqual({ responded: false, resolved: false, agentLabel: '' });
  });
});
