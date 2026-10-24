import { expect, it } from 'vitest';
import { draftCommit, normalizeOptions, normalizeSelection, selectKey } from './select-model';
it('normalizes malformed inputs and deduplicates by typed scalar identity', () => {
  for (const value of [null, {}, 'x', 2]) expect(normalizeOptions(value)).toEqual([]);
  expect(normalizeOptions([null, {}, NaN, Infinity, '2', 2, 2, false, { value: '2', label: 'ignored' }]).map(entry => entry.value)).toEqual(['2', 2, false]);
  expect(selectKey('2')).not.toBe(selectKey(2));
  expect(normalizeSelection({}, false)).toBe(null);
  expect(normalizeSelection([2, 2, '2'], true)).toEqual([2, '2']);
});
it('only commits changed accepted drafts against the original current value', () => {
  expect(draftCommit([], [], ['x'], false)).toBe(null);
  expect(draftCommit([], ['external'], ['x'], true)).toBe(null);
  expect(draftCommit(['x'], ['x'], ['x'], true)).toBe(null);
  const draft = ['x']; const committed = draftCommit([], [], draft, true); draft.push('y');
  expect(committed).toEqual(['x']);
});
