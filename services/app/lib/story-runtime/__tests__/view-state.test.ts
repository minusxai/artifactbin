import { afterEach, describe, expect, it } from 'vitest';
import { COMMENT_VALUES_KEY } from '../../../../contracts/src/comment-view-state';
import { commentStateSlot, registerCommentState, renderedCommentState } from '../comment-state';
import { pendingCommentState, restoreCommentState, viewCommentState, withPendingCommentState } from '../comment-state-io';

const RENDERING = Symbol.for('artifactbin.comment-state.render');
afterEach(() => { delete (globalThis as Record<symbol, unknown>)[RENDERING]; });
const part = (initial: unknown) => { let value = initial; return { get: () => value, set: (next: unknown) => { value = next; }, read: () => value }; };

describe('commentStateSlot', () => {
  it('is one slot per document-like owner, shared by every bundle through a global symbol', () => {
    const owner = {}, other = {};
    expect(commentStateSlot(owner)).toBe(commentStateSlot(owner));
    expect(commentStateSlot(owner)).not.toBe(commentStateSlot(other));
    expect(Object.getOwnPropertySymbols(owner)).toEqual([Symbol.for('artifactbin.comment-state.v2')]);
    expect(Object.keys(owner)).toEqual([]);
  });
});

describe('renderedCommentState', () => {
  it('answers the server render’s starting value for a key, and undefined outside a render or for other keys', () => {
    expect(renderedCommentState('tab')).toBeUndefined();
    (globalThis as Record<symbol, unknown>)[RENDERING] = { tab: 'billing', none: null };
    expect(renderedCommentState('tab')).toBe('billing');
    expect(renderedCommentState('none')).toBeNull();
    expect(renderedCommentState('toString')).toBeUndefined();
    expect(renderedCommentState('missing')).toBeUndefined();
  });
});

describe('viewCommentState', () => {
  it('is every registered part but the declared Values, leaving out values that are not plain JSON', () => {
    const owner = {};
    registerCommentState(owner, COMMENT_VALUES_KEY, part({ region: 'north' }));
    registerCommentState(owner, 'n1:tab', part('billing'));
    registerCommentState(owner, 'n2:open', part(true));
    registerCommentState(owner, 'n3:when', part(new Date(0)));
    registerCommentState(owner, 'n4:fn', part(() => 1));
    registerCommentState(owner, 'n5:nan', part(Number.NaN));
    expect(viewCommentState(owner)).toEqual({ 'n1:tab': 'billing', 'n2:open': true });
    expect(viewCommentState({})).toEqual({});
  });

  it('is empty when the whole exceeds the contract bounds', () => {
    const owner = {};
    registerCommentState(owner, 'n1:big', part('x'.repeat(200_000)));
    expect(viewCommentState(owner)).toEqual({});
  });
});

describe('withPendingCommentState', () => {
  it('starts parts registered inside the run at the given state, then restores the last restore’s pending values', () => {
    const owner = {};
    restoreCommentState(owner, { v: 2, state: { 'n1:tab': 'saved', 'n2:open': false } });
    const tab = part('default'), open = part(true);
    const answer = withPendingCommentState(owner, { 'n1:tab': 'fragment' }, () => {
      registerCommentState(owner, 'n1:tab', tab);
      registerCommentState(owner, 'n2:open', open);
      return 'drawn';
    });
    expect(answer).toBe('drawn');
    expect(tab.read()).toBe('fragment');
    expect(open.read()).toBe(false);
    expect(pendingCommentState(owner, 'n1:tab')).toBe('saved');
  });

  it('restores the pending values even when the run throws', () => {
    const owner = {};
    expect(() => withPendingCommentState(owner, { k: 1 }, () => { throw new Error('mount failed'); })).toThrow('mount failed');
    expect(pendingCommentState(owner, 'k')).toBeUndefined();
  });
});
