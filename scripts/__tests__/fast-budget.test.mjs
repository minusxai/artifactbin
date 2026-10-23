import { describe, expect, it } from 'vitest';
import { assessFastBudget } from '../lib/fast-budget.mjs';
const startedAt = '2026-01-01T00:00:00Z';
const start = Date.parse(startedAt);
describe('complete fast validation clock', () => {
  it('includes scheduler and setup time before the test process starts', () => {
    expect(assessFastBudget({startedAt,now:start+119_000,budgetMs:120_000})).toEqual({elapsedMs:119_000,passed:true});
    expect(assessFastBudget({startedAt,now:start+120_000,budgetMs:120_000})).toEqual({elapsedMs:120_000,passed:false});
  });
  it.each([{startedAt:'invalid',now:start,budgetMs:120000},{startedAt,now:start-1,budgetMs:120000},{startedAt,now:start,budgetMs:0}])('fails closed for invalid clock inputs', input => {
    expect(() => assessFastBudget(input)).toThrow(/clock/);
  });
});
