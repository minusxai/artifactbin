import { describe, expect, it } from 'vitest';
import { sourceEdits } from '../source-edits';
import { resolveEditBatch } from '@/lib/story/edit-batch';
import { SourceHistory, sourceChanges } from '../history';
import { applySplice } from '@/lib/story/splice';
const a = '<div><p id="a">one</p><p id="b">two</p><p id="c">three</p></div>';
const b = a.replace('one', 'longer one').replace('three', '3');
describe('one source history across editor operations', () => {
  it('lowers disjoint edits and inverts post-transaction coordinates', () => {
    const h = new SourceHistory();
    h.record(a, b);
    const changes = sourceChanges(a, b);
    expect(changes).toHaveLength(2);
    expect([...changes].reverse().reduce((s, c) => applySplice(s, c.splice), a)).toBe(b);
    expect(h.undo(b)).toEqual({ ok: true, source: a });
    expect(h.redo(a)).toEqual({ ok: true, source: b });
  });
  it('undo/redo preserve unrelated remote edits between changed nodes', () => {
    const h = new SourceHistory();
    h.record(a, b);
    const remote = b.replace('two', 'remote two');
    const undone = a.replace('two', 'remote two');
    expect(h.undo(remote)).toEqual({ ok: true, source: undone });
    expect(h.redo(undone)).toEqual({ ok: true, source: remote });
  });
  it('refuses an overlapping inverse without consuming history or changing the draft', () => {
    const h = new SourceHistory();
    h.record(a, b);
    expect(h.undo(b.replace('longer one', 'remote one'))).toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect(h.canUndo).toBe(true);
    expect(h.undo(b)).toEqual({ ok: true, source: a });
  });
  it('orders different operations and drops redo after a new edit', () => {
    const h = new SourceHistory();
    h.record(a, b);
    const c = b.replace('two', 'TWO');
    h.record(b, c);
    expect(h.undo(c)).toEqual({ ok: true, source: b });
    expect(h.undo(b)).toEqual({ ok: true, source: a });
    h.record(a, a.replace('one', 'new'));
    expect(h.canRedo).toBe(false);
  });
});

describe('source batch transport', () => {
  it('creates uniquely anchored edits for separate paragraphs', () => {
    const edits = sourceEdits(a, b);
    expect(edits).toHaveLength(2);
    expect(resolveEditBatch(a, edits)).toMatchObject({ ok: true, source: b });
  });
});

it('groups contiguous typing but keeps paste and structure as separate undo steps', () => {
  const h = new SourceHistory();
  const b = a.replace('one', 'onex'),
    c = a.replace('one', 'onexy'),
    d = a.replace('one', 'pasted');
  h.record(a, b, 'typing:p');
  h.record(b, c, 'typing:p');
  h.record(c, d);
  expect(h.undo(d)).toEqual({ ok: true, source: c });
  expect(h.undo(c)).toEqual({ ok: true, source: a });
});

it('returns the pre-edit selection for undo and the post-edit selection for redo', () => {
  const h = new SourceHistory();
  const before = {
      anchor: { id: 'a', offset: 1 },
      head: { id: 'a', offset: 3 },
    },
    after = { anchor: { id: 'a', offset: 2 }, head: { id: 'a', offset: 2 } };
  h.record('<p id="a">abcd</p>', '<p id="a">aXd</p>', undefined, before, after);
  const undo = h.undo('<p id="a">aXd</p>');
  expect(undo).toMatchObject({ ok: true, bookmark: before });
  expect(h.redo('<p id="a">abcd</p>')).toMatchObject({
    ok: true,
    bookmark: after,
  });
});
