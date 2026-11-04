/**
 * A live dataset text cell's text (../cells): the raw string in the region root, validated as a plain-text region,
 * three-way revisions from the value the cell last saw, and the smallest splice of an input's new value.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyCellRevision, cellText, cellValue, createCellState, snapshotValue, spliceText, textSplice } from '../cells';
import { validateRegionUpdate } from '../validate';

const replica = (state: Uint8Array, clientID: number) => {
  const doc = new Y.Doc({ gc: false });
  doc.clientID = clientID;
  Y.applyUpdate(doc, state);
  return doc;
};
const edit = (doc: Y.Doc, work: (text: Y.Text) => void) => {
  const before = Y.encodeStateVector(doc);
  work(cellText(doc));
  return Y.encodeStateAsUpdate(doc, before);
};

describe('cell state', () => {
  it('holds the raw value, newlines included, with no terminator', () => {
    const { state, snapshot } = createCellState('line one\nline two');
    const doc = replica(state, 5);
    expect(cellValue(doc)).toBe('line one\nline two');
    expect(snapshotValue(doc, snapshot)).toBe('line one\nline two');
    expect(cellValue(replica(createCellState('').state, 6))).toBe('');
  });

  it('is validated as a plain-text region: characters and newlines pass, a format is refused', () => {
    const { state } = createCellState('a');
    const server = replica(state, 1);
    const client = replica(state, 77);
    const typed = edit(client, (text) => text.insert(1, '\nb'));
    expect(validateRegionUpdate('text', server, typed, 77).duplicate).toBe(false);
    expect(cellValue(server)).toBe('a\nb');
    expect(validateRegionUpdate('text', server, typed, 77).duplicate).toBe(true);
    const bold = edit(client, (text) => text.format(0, 1, { bold: true }));
    expect(() => validateRegionUpdate('text', server, bold, 77)).toThrow(/plain-text/);
  });
});

describe('a three-way revision from the value the cell last saw', () => {
  it('keeps unsaved typing and the other write', () => {
    const { state, snapshot } = createCellState('Fix the login bug');
    const live = replica(state, 10);
    // Someone types, unsaved: an addition at the end.
    edit(live, (text) => text.insert(text.length, ' before Friday'));
    // Meanwhile a GraphQL write, made from the saved value, rewrites a word.
    const revision = applyCellRevision({ live: Y.encodeStateAsUpdate(live), savedSnapshot: snapshot, value: 'Fix the signup bug' });
    expect(revision.base).toBe('Fix the login bug');
    Y.applyUpdate(live, revision.update);
    expect(cellValue(live)).toBe('Fix the signup bug before Friday');
    // The new snapshot is the written value: the next revision forks from it.
    expect(snapshotValue(live, revision.snapshot)).toBe('Fix the signup bug');
    const next = applyCellRevision({ live: Y.encodeStateAsUpdate(live), savedSnapshot: revision.snapshot, value: 'Fix the signup bug!' });
    Y.applyUpdate(live, next.update);
    // Two insertions at one place (the write's "!" and the typing, both after "bug"): both stay, ordered by Yjs.
    expect(['Fix the signup bug! before Friday', 'Fix the signup bug before Friday!']).toContain(cellValue(live));
  });

  it('is nothing when the write left the cell as it was, and refuses a missing or foreign snapshot', () => {
    const { state, snapshot } = createCellState('same');
    const live = replica(state, 11);
    const revision = applyCellRevision({ live: state, savedSnapshot: snapshot, value: 'same' });
    const decoded = Y.decodeUpdate(revision.update);
    expect(decoded.structs).toEqual([]);
    expect(() => applyCellRevision({ live: state, savedSnapshot: null, value: 'x' })).toThrow();
    const stranger = new Y.Doc({ gc: false });
    stranger.clientID = 999;
    cellText(stranger).insert(0, 'other');
    expect(() => applyCellRevision({ live: Y.encodeStateAsUpdate(live), savedSnapshot: Y.encodeSnapshot(Y.snapshot(stranger)), value: 'x' })).toThrow();
  });
});

describe('an input value as the smallest splice', () => {
  it('keeps the common prefix and suffix', () => {
    expect(textSplice('hello world', 'hello brave world')).toEqual({ index: 6, remove: 0, insert: 'brave ' });
    expect(textSplice('abc', 'abc')).toBeNull();
    expect(textSplice('abcdef', 'abXdef')).toEqual({ index: 2, remove: 1, insert: 'X' });
    expect(textSplice('aaa', 'aa')).toEqual({ index: 2, remove: 1, insert: '' });
  });

  it('never splits a surrogate pair', () => {
    const splice = textSplice('a\u{1F600}b', 'a\u{1F601}b')!;
    expect(splice).toEqual({ index: 1, remove: 2, insert: '\u{1F601}' });
  });

  it('applied to a shared text, leaves a concurrent insertion beside the edit', () => {
    const { state } = createCellState('one two three');
    const a = replica(state, 21), b = replica(state, 22);
    const before = Y.encodeStateVector(a);
    spliceText(cellText(a), 'one 2 three');
    const fromA = Y.encodeStateAsUpdate(a, before);
    const fromB = edit(b, (text) => text.insert(text.length, '!'));
    Y.applyUpdate(a, fromB);
    Y.applyUpdate(b, fromA);
    expect(cellValue(a)).toBe('one 2 three!');
    expect(cellValue(b)).toBe('one 2 three!');
  });
});
