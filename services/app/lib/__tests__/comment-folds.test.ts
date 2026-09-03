/**
 * THE FOLD STORE — per viewer, per artifact, and nowhere near the wire.
 *
 * Two properties are worth a test each: what it remembers (round-trip, keyed by
 * artifact, toggled) and what it does when it CANNOT remember. The second is
 * the one that breaks in the wild — a private window, a blocked store, a value
 * some other tab wrote — and every one of those must read as "nothing folded"
 * rather than take the rail down with it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FOLD_LINES, FOLD_STORAGE_KEY, foldFromMeasure, isFolded, readFolds, toggleFold, unfold,
} from '@/lib/comment-folds';

/** A minimal store: the four members this module may touch, and nothing else. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    read: () => map.get(FOLD_STORAGE_KEY) ?? null,
  };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal('localStorage', store);
});
afterEach(() => vi.unstubAllGlobals());

describe('the fold store round-trips', () => {
  it('remembers a folded comment and a folded thread, keyed by artifact', () => {
    toggleFold('doc1', 'comments', 'ann_2');
    toggleFold('doc1', 'threads', 'ann_1');
    expect(readFolds('doc1')).toEqual({ threads: ['ann_1'], comments: ['ann_2'] });

    // Another artifact's rail knows nothing about this one's.
    expect(readFolds('doc2')).toEqual({ threads: [], comments: [] });
    toggleFold('doc2', 'comments', 'ann_9');
    expect(readFolds('doc1')).toEqual({ threads: ['ann_1'], comments: ['ann_2'] });
    expect(readFolds('doc2').comments).toEqual(['ann_9']);

    // ONE key, shaped { [artifactId]: { threads, comments } } — nothing else.
    expect(JSON.parse(store.read()!)).toEqual({
      doc1: { threads: ['ann_1'], comments: ['ann_2'] },
      doc2: { threads: [], comments: ['ann_9'] },
    });
  });

  it('toggling folds and then unfolds the same id', () => {
    const folded = toggleFold('doc1', 'comments', 'ann_2');
    expect(isFolded(folded, 'comments', 'ann_2')).toBe(true);
    expect(isFolded(folded, 'threads', 'ann_2')).toBe(false);

    const open = toggleFold('doc1', 'comments', 'ann_2');
    expect(isFolded(open, 'comments', 'ann_2')).toBe(false);
    expect(readFolds('doc1').comments).toEqual([]);
  });

  it('unfold opens a thread and its newest comment in one write', () => {
    toggleFold('doc1', 'threads', 'ann_1');
    toggleFold('doc1', 'comments', 'ann_7');
    toggleFold('doc1', 'comments', 'ann_8');

    const after = unfold('doc1', { threads: ['ann_1'], comments: ['ann_8'] });
    expect(after).toEqual({ threads: [], comments: ['ann_7'] });
    expect(readFolds('doc1')).toEqual({ threads: [], comments: ['ann_7'] });

    // Unfolding what was never folded changes nothing and writes no garbage.
    expect(unfold('doc1', { threads: ['nope'] })).toEqual({ threads: [], comments: ['ann_7'] });
  });
});

describe('a store it cannot use reads as nothing folded', () => {
  it('a garbled value, a wrong shape and a foreign type all read empty', () => {
    for (const value of ['{oops', 'null', '"a string"', '[1,2]', '{"doc1":7}', '{"doc1":{"threads":"ann_1"}}']) {
      vi.stubGlobal('localStorage', fakeStorage({ [FOLD_STORAGE_KEY]: value }));
      expect(readFolds('doc1')).toEqual({ threads: [], comments: [] });
    }
  });

  it('non-string entries inside a well-shaped list are dropped', () => {
    vi.stubGlobal('localStorage', fakeStorage({
      [FOLD_STORAGE_KEY]: JSON.stringify({ doc1: { threads: ['ann_1', 7, null], comments: ['ann_2'] } }),
    }));
    expect(readFolds('doc1')).toEqual({ threads: ['ann_1'], comments: ['ann_2'] });
  });

  it('no store at all is not an error', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readFolds('doc1')).toEqual({ threads: [], comments: [] });
    expect(() => toggleFold('doc1', 'comments', 'ann_2')).not.toThrow();
    expect(toggleFold('doc1', 'comments', 'ann_2')).toEqual({ threads: [], comments: ['ann_2'] });
  });

  it('a store whose accessor THROWS — the private-window shape — is not an error', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(readFolds('doc1')).toEqual({ threads: [], comments: [] });
    expect(toggleFold('doc1', 'threads', 'ann_1')).toEqual({ threads: ['ann_1'], comments: [] });
  });
});

describe('the auto-fold verdict comes from the layout, not the characters', () => {
  it('a body taller than ten lines folds, and says how many lines it has', () => {
    const verdict = foldFromMeasure(800, 20);
    expect(verdict.overflowing).toBe(true);
    expect(verdict.lines).toBe(40);
    expect(verdict.maxHeight).toBe(FOLD_LINES * 20);
  });

  it('ten lines exactly is not folded, and neither is an unmeasurable body', () => {
    expect(foldFromMeasure(FOLD_LINES * 20, 20).overflowing).toBe(false);
    expect(foldFromMeasure(201, 20).overflowing).toBe(true);
    // A sub-pixel overshoot is the browser's rounding, not an eleventh line.
    expect(foldFromMeasure(200.4, 20).overflowing).toBe(false);
    for (const [h, lh] of [[0, 20], [800, 0], [800, Number.NaN]]) {
      expect(foldFromMeasure(h, lh).overflowing).toBe(false);
    }
  });
});
