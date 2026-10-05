import { describe, expect, it } from 'vitest';
import { parseCommentViewState } from '../../../contracts/src/comment-view-state';
import { reviewStateFor } from '../story-runtime/review-state';

describe('comment view state', () => {
  it('captures independent local state including defaults and restores without replaying actions', () => {
    const owner = {}, state = reviewStateFor(owner);
    let screen = 'checkout', payment = { tab: 'card', error: false }, attempts = 0;
    state.register({ id: 'screen', get: () => screen, restore: value => { screen = String(value); } });
    state.register({ id: 'payment', get: () => payment, restore: value => { payment = value as typeof payment; } });
    const saved = state.capture()!;
    screen = 'plans'; payment.tab = 'wallet'; payment.error = true; attempts++;
    reviewStateFor(owner).restore(saved);
    expect(screen).toBe('checkout'); expect(payment).toEqual({ tab: 'card', error: false }); expect(attempts).toBe(1);
    payment.error = true;
    expect(saved.components.payment).toEqual({ tab: 'card', error: false });
    expect(reviewStateFor({}).capture()).toBeNull();
  });
  it('refuses incompatible snapshots before changing components, and cleans up registrations', () => {
    const state = reviewStateFor({}); let screen = 'plans';
    const remove = state.register({ id: 'screen', get: () => screen, restore: value => { screen = String(value); } });
    expect(() => state.register({ id: 'screen', get: () => null, restore() {} })).toThrow(/already/);
    expect(() => state.restore({ v: 1, components: { screen: 'checkout', removed: true } })).toThrow(/changed/);
    expect(screen).toBe('plans');
    remove(); expect(state.capture()).toBeNull();
  });
  it('accepts bounded inert JSON and rejects executable, oversized, deeply nested and unsafe values', () => {
    const valid = { v: 1, components: { dialog: false, choices: ['card', 2, null] } };
    expect(parseCommentViewState(valid)).toEqual(valid);
    for (const value of [undefined, () => {}, Infinity, new Date(), 'x'.repeat(33000), JSON.parse('{"__proto__":true}')]) {
      expect(parseCommentViewState({ v: 1, components: { state: value } })).toBeNull();
    }
    let deep: unknown = false; for (let i = 0; i < 20; i++) deep = { deep };
    expect(parseCommentViewState({ v: 1, components: { deep } })).toBeNull();
  });
});
