import { describe, expect, it, vi } from 'vitest';
import { parseCommentViewState } from '../../../contracts/src/comment-view-state';
import { clearPendingCommentState, pendingCommentState, registerCommentState, setCommentStateTransaction } from '../story-runtime/comment-state';
import { captureCommentState, restoreCommentState } from '../story-runtime/comment-state-io';

const registry = (owner: object) => ({
  register: (key: string, part: Parameters<typeof registerCommentState>[2]) => registerCommentState(owner, key, part),
  capture: () => captureCommentState(owner),
  restore: (saved: Parameters<typeof restoreCommentState>[1]) => restoreCommentState(owner, saved),
  pending: (key: string) => pendingCommentState(owner, key),
  clearPending: () => clearPendingCommentState(owner),
});

describe('comment state', () => {
  it('captures every registered key including defaults as copies, and restores copies without replaying actions', () => {
    const owner = {}, state = registry(owner);
    let screen = 'checkout', payment = { tab: 'card', error: false }, attempts = 0;
    state.register('screen', { get: () => screen, set: value => { screen = String(value); } });
    state.register('aBcD:payment', { get: () => payment, set: value => { payment = value as typeof payment; } });
    const saved = state.capture()!;
    screen = 'plans'; payment.tab = 'wallet'; payment.error = true; attempts++;
    registry(owner).restore(saved);
    expect(screen).toBe('checkout'); expect(payment).toEqual({ tab: 'card', error: false }); expect(attempts).toBe(1);
    payment.error = true;
    expect(saved).toEqual({ v: 2, state: { screen: 'checkout', 'aBcD:payment': { tab: 'card', error: false } } });
    expect(state.pending('aBcD:payment')).toEqual({ tab: 'card', error: false });
    expect(registry({}).capture()).toBeNull();
  });
  it('ignores keys the page no longer has, keeps the restore pending for keys registered later, and clears it', () => {
    const state = registry({}); let screen = 'plans'; let tab = 'summary';
    const remove = state.register('screen', { get: () => screen, set: value => { screen = String(value); } });
    state.restore({ v: 2, state: { screen: 'checkout', 'eFgH:tab': 'billing', removed: true } });
    expect(screen).toBe('checkout');
    expect(state.pending('eFgH:tab')).toBe('billing'); expect(state.pending('other')).toBeUndefined();
    state.register('eFgH:tab', { get: () => tab, set: value => { tab = String(value); } });
    expect(tab).toBe('billing');
    state.clearPending(); tab = 'summary';
    state.register('iJkL:tab', { get: () => tab, set: value => { tab = String(value); } });
    expect(tab).toBe('summary');
    remove(); expect(state.capture()).toEqual({ v: 2, state: { 'eFgH:tab': 'summary', 'iJkL:tab': 'summary' } });
  });
  it('lets the last registration win on a duplicate key, skips values that are not plain JSON, and runs sets in one transaction', () => {
    const owner = {}, state = registry(owner); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    let first = 'a', second = 'b';
    state.register('open', { get: () => first, set: value => { first = String(value); } });
    state.register('open', { get: () => second, set: value => { second = String(value); } });
    state.register('clock', { get: () => new Date(), set() {} });
    state.register('loop', { get: () => cyclic, set() {} });
    state.register('fn', { get: () => () => 1, set() {} });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('registered twice'));
    expect(state.capture()).toEqual({ v: 2, state: { open: 'b' } });
    const ran: string[] = [];
    setCommentStateTransaction(owner, run => { ran.push('begin'); run(); ran.push('end'); });
    state.restore({ v: 2, state: { open: 'z' } });
    expect([first, second, ran]).toEqual(['a', 'z', ['begin', 'end']]);
    state.register('bad', { get: () => 1, set() { throw new Error('nope'); } });
    expect(() => state.restore({ v: 2, state: { bad: 2, open: 'y' } })).toThrow(/bad/);
    expect(second).toBe('y');
    expect(() => state.register('no space', { get: () => 1, set() {} })).toThrow(/stable key/);
    warn.mockRestore();
  });
  it('accepts bounded inert JSON and rejects executable, oversized, deeply nested, unsafe and earlier-shaped values', () => {
    const valid = { v: 2, state: { $: { region: 'west', step: 2 }, 'aBcD:value': 'billing', dialog: false, choices: ['card', 2, null] } };
    expect(parseCommentViewState(valid)).toEqual(valid);
    for (const value of [undefined, () => {}, Infinity, new Date(), 'x'.repeat(33000), JSON.parse('{"__proto__":true}')]) {
      expect(parseCommentViewState({ v: 2, state: { state: value } })).toBeNull();
    }
    let deep: unknown = false; for (let i = 0; i < 20; i++) deep = { deep };
    expect(parseCommentViewState({ v: 2, state: { deep } })).toBeNull();
    expect(parseCommentViewState({ v: 1, components: { screen: 'plans' } })).toBeNull();
    expect(parseCommentViewState({ v: 2, state: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, i])) })).toBeNull();
  });
});
